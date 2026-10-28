import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { RemoteBridge, token_hash } from "../src/bridge";
import type { RpcMessage } from "../src/rpc";
import { create_send_operation } from "../src/sync/operations";
import { CheckpointPolicy } from "../src/runtime/checkpoints";

const Delay = (Ms: number) => new Promise<void>(Resolve => setTimeout(Resolve, Ms));
async function eventually(Check: () => boolean): Promise<void>
{
	const Deadline = Date.now() + 4 * CheckpointPolicy.intervalMs;
	while(!Check() && Date.now() < Deadline) { await Delay(10); }
	assert.ok(Check(), "The actual bridge timer must retry its pending checkpoint");
}

async function fixture()
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-bridge-checkpoint-failure-")), StateDir = join(Directory, "state");
	mkdirSync(StateDir); const Client = "original-fault-client", Token = "original-fixture-token-".repeat(3), Skill = join(Directory, "SKILL.md");
	writeFileSync(Skill, "Original fixture skill");
	const User = { Id: "q", Role: "user", Text: "Explain the original example", Prompt: "Original immutable prompt", Context: { Path: "Original.md", Text: "Original definition: $[x,x]=0$.", CapturedAt: "original", Mapping: "source" }, Quote: { Text: "original quotation", SourceText: "Original complete source" } };
	writeFileSync(join(StateDir, Client + ".json"), JSON.stringify({ Settings: {}, ActiveId: "s", Sessions: [{ Id: "s", Title: "Original fixture", Messages: [User] }] }));
	let Emit: (Message: RpcMessage) => void = () => {}, Submits = 0, Closed = 0;
	const Config = { Port: 0, Cli: "mock", Cwd: Directory, Vault: "original-fixture", ObsidianCli: "mock", StateDir, Clients: [{ Id: Client, Hash: token_hash(Token) }] };
	const Factory: ConstructorParameters<typeof RemoteBridge>[1] = (_Cli, _Cwd, OnMessage) =>
	{
		Emit = OnMessage;
		return {
			async request(Method)
			{
				if(Method === "model/list") { return { data: [{ model: "original", supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" }], nextCursor: null }; }
				if(Method === "skills/list") { return { data: [{ cwd: Directory, skills: [{ name: "math-writing", path: Skill, enabled: true }] }] }; }
				if(Method === "thread/start") { return { model: "original", thread: { id: "thread", ephemeral: true, path: null, turns: [] } }; }
				if(Method === "turn/start") { Submits++; return { turn: { id: "turn", status: "inProgress" } }; }
				return {};
			}, send() {}, close() { Closed++; }
		};
	};
	let Bridge = new RemoteBridge(Config, Factory), Port = await Bridge.listen(), Open = true;
	const Http = async (Path: string, Body?: unknown): Promise<any> =>
	{
		const Response = await fetch(`http://127.0.0.1:${Port}${Path}`, { method: Body ? "POST" : "GET", headers: { Authorization: "Bearer " + Token }, ...(Body ? { body: JSON.stringify(Body) } : {}) });
		const Value = await Response.json() as any; assert.equal(Response.status, 200, Value.error); return Value;
	};
	const Rpc = (Method: string, Params: unknown) => Http("/rpc", { id: crypto.randomUUID(), method: Method, params: Params });
	const close = async () => { if(Open) { Open = false; await Bridge.close(); } };
	try
	{
		await Http("/info"); const Agent = (Bridge as any).Agents.get(Client), Store = Agent.Store;
		await Rpc("thread/start", { clientSessionId: "s", model: "original", config: { model_reasoning_effort: "low" } });
		const Input = { Prompt: User.Prompt, Context: User.Context, Quote: User.Quote }, Operation = await create_send_operation(Store.Scope, "s", User.Id, Input);
		const Request = { threadId: "thread", model: "original", effort: "low", input: [{ type: "text", text: User.Prompt }, { type: "skill", name: "math-writing", path: "fixture-only" }] };
		const Submission = { operation: { ...Operation, Input: undefined, InputBlob: Store.store_value(Input) }, requestBlob: Store.store_value(Request) };
		assert.equal((await Http("/operations", Submission)).operation.Status, "running");
		const OriginalSave = Store.save.bind(Store); let ShouldFail: () => boolean = () => false, Attempts = 0;
		Store.save = () => { Attempts++; if(ShouldFail()) { throw Error("Original injected disk failure"); } OriginalSave(); };
		return {
			Agent, Store, User, Input, Request, Operation, Submission, Http, Rpc,
			get Submits() { return Submits; }, get Attempts() { return Attempts; }, get Closed() { return Closed; },
			journal: () => readFileSync(join(StateDir, Client + "-sync-v2.json"), "utf8"),
			fail: (Predicate: () => boolean) => { ShouldFail = Predicate; },
			emit: (Message: RpcMessage) => Emit(Message),
			delta: (Text: string) => Emit({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "a", delta: Text } }),
			complete: (Text: string) =>
			{
				Emit({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { id: "a", type: "agentMessage", phase: "final_answer", text: Text } } });
				Emit({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
			},
			close,
			restart: async () => { await close(); Bridge = new RemoteBridge(Config, Factory); Port = await Bridge.listen(); Open = true; },
			cleanup: async () => { await close(); assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); }
		};
	}
	catch(E) { await close(); assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); throw E; }
}

test("actual bridge withholds raw terminal events during failed storage and retries final body without inference", async () =>
{
	const F = await fixture();
	try
	{
		const Before = F.journal(), Final = "Original final formula: $[x,x]=0$.\n\n" + "x".repeat(33_000);
		F.fail(() => true); F.delta(Final); F.complete(Final);
		assert.ok(F.Attempts >= 3); assert.equal(F.journal(), Before);
		for(const Protocol of [1, 2])
		{
			const Events = (await F.Http(`/events?after=0&protocol=${Protocol}`)).events.map((E: any) => E.message.method);
			assert.ok(Events.includes("bridge/storage-error"));
			assert.ok(!Events.includes("item/completed") && !Events.includes("turn/completed"));
			assert.ok(!Events.includes("bridge/message-ref"));
		}
		assert.equal((await F.Http("/operations?id=" + F.Operation.Id)).operation.Status, "running");
		assert.equal((await F.Rpc("bridge/resume", { threadId: "thread" })).thread.turns[0].status, "inProgress");
		F.fail(() => false);
		await eventually(() => F.Agent.events(0, 2).events.some((E: any) => E.message.method === "turn/completed"));
		const Events = (await F.Http("/events?after=0&protocol=2")).events;
		assert.equal(Events.filter((E: any) => E.message.method === "item/completed").length, 1);
		assert.equal(Events.filter((E: any) => E.message.method === "turn/completed").length, 1);
		const Reference = Events.find((E: any) => E.message.method === "bridge/message-ref" && E.message.params.messageId === "a");
		assert.ok(Reference); assert.ok(Reference.seq < Events.find((E: any) => E.message.method === "item/completed").seq);
		const Messages = (await F.Http("/state")).state.Sessions[0].Messages;
		assert.equal(Messages.find((M: any) => M.Id === "a").Text, Final);
		assert.equal(Messages.find((M: any) => M.Id === "a").CompletionStatus, "completed");
		for(const Key of ["Text", "Prompt", "Context", "Quote"] as const) { assert.deepEqual(Messages.find((M: any) => M.Id === "q")[Key], F.User[Key]); }
		assert.deepEqual(F.Store.operation(F.Operation.Id).Input, F.Input); assert.deepEqual(F.Store.operation(F.Operation.Id).Request, F.Request);
		assert.equal((await F.Http("/operations?id=" + F.Operation.Id)).operation.Status, "completed");
		assert.equal((await F.Http("/operations", F.Submission)).operation.Status, "completed"); assert.equal(F.Submits, 1);
		await F.restart();
		const Recovered = (await F.Http("/state")).state.Sessions[0].Messages;
		assert.deepEqual(Recovered, Messages);
		assert.equal((await F.Http("/operations?id=" + F.Operation.Id)).operation.Status, "completed");
		assert.equal(F.Submits, 1);
	}
	finally { await F.cleanup(); }
});

test("actual bridge withholds turn completion if operation persistence fails after the final body is durable", async () =>
{
	const F = await fixture();
	try
	{
		F.fail(() => F.Store.operation(F.Operation.Id)?.Status === "completed");
		F.delta("Original partial"); F.complete("Original final $x=1$");
		const Events = (await F.Http("/events?after=0&protocol=2")).events.map((E: any) => E.message.method);
		assert.ok(Events.includes("item/completed")); assert.ok(!Events.includes("turn/completed"));
		assert.equal((await F.Http("/operations?id=" + F.Operation.Id)).operation.Status, "running");
		assert.equal((await F.Rpc("bridge/resume", { threadId: "thread" })).thread.turns[0].status, "inProgress");
		F.fail(() => false);
		await eventually(() => F.Agent.events(0, 2).events.some((E: any) => E.message.method === "turn/completed"));
		assert.equal((await F.Http("/operations?id=" + F.Operation.Id)).operation.Status, "completed");
		assert.deepEqual(F.Store.operation(F.Operation.Id).Input, F.Input); assert.equal(F.Submits, 1);
	}
	finally { await F.cleanup(); }
});

test("closing the actual bridge cancels failed checkpoint retry timers without resubmitting a turn", async () =>
{
	const F = await fixture();
	try
	{
		F.fail(() => true); F.delta("Original failed tail"); F.complete("Original final tail");
		assert.ok(F.Attempts >= 2); await F.close(); const Attempts = F.Attempts;
		assert.equal(F.Closed, 1); assert.equal(F.Agent.Checkpoints.Pending.size, 0);
		await Delay(CheckpointPolicy.intervalMs + 100);
		assert.equal(F.Attempts, Attempts); assert.equal(F.Submits, 1);
		assert.ok(!F.Agent.events(0, 2).events.some((E: any) => E.message.method === "turn/completed"));
	}
	finally { await F.cleanup(); }
});

test("a delayed saved terminal cannot replace the bridge's newer running turn", async () =>
{
	const F = await fixture();
	try
	{
		F.fail(() => true); F.delta("Original body"); F.complete("Original completed body");
		F.emit({ method: "turn/started", params: { threadId: "thread", turn: { id: "newer-turn", status: "inProgress" } } });
		F.fail(() => false);
		await eventually(() => F.Agent.events(0, 2).events.some((E: any) => E.message.method === "turn/completed"));
		const Turn = (await F.Rpc("bridge/resume", { threadId: "thread" })).thread.turns[0];
		assert.equal(Turn.id, "newer-turn"); assert.equal(Turn.status, "inProgress"); assert.equal(F.Submits, 1);
	}
	finally { await F.cleanup(); }
});
