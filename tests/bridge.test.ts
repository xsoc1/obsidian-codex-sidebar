import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { RemoteBridge, token_hash } from "../src/bridge";
import type { RpcMessage } from "../src/rpc";

test("private bridge isolates devices, clamps permissions, replaces skill paths, and deduplicates requests", async () =>
{
	const Dir = mkdtempSync(join(tmpdir(), "codex-bridge-test-"));
	const Skill = join(Dir, "SKILL.md"); writeFileSync(Skill, "test skill");
	const Tokens = ["a".repeat(48), "b".repeat(48)];
	const Peers: { calls: any[]; emit: (Value: RpcMessage) => void; closed: boolean }[] = [];
	const Bridge = new RemoteBridge({ Port: 0, Cli: "mock", Cwd: Dir, Vault: "test", ObsidianCli: "mock", StateDir: join(Dir, "state"), Clients: Tokens.map((Token, Index) => ({ Id: `client-${Index}`, Hash: token_hash(Token) })) }, (_Cli, _Cwd, Emit) =>
	{
		const Peer = { calls: [] as any[], emit: Emit, closed: false }; Peers.push(Peer);
		const Index = Peers.length;
		return {
			async request(Method, Params: any)
			{
				Peer.calls.push({ Method, Params });
				if(Method === "model/list")
				{
					return { data: [{ model: "model-a", displayName: "A", defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Unused description" }], serviceTiers: [{ id: "priority", name: "Fast", description: "Unused description" }], additionalSpeedTiers: ["fast"], isDefault: true, description: "Unused description".repeat(100), upgradeInfo: { model: "unused" } }], nextCursor: null };
				}
				if(Method === "skills/list")
				{
					return { data: [{ cwd: Dir, skills: [{ name: "math-writing", path: Skill, enabled: true }] }] };
				}
				if(Method === "thread/start")
				{
					return { model: "model-a", reasoningEffort: "low", thread: { id: `thread-${Index}`, ephemeral: true, path: null, turns: [] } };
				}
				if(Method === "turn/start")
				{
					return { turn: { id: `turn-${Index}` } };
				}
				return {};
			},
			send()
			{
			}, close()
			{
				Peer.closed = true;
			}
		};
	});
	const Port = await Bridge.listen();
	const Http = async (Device: number, Path: string, Body?: any) =>
	{
		const Response = await fetch(`http://127.0.0.1:${Port}${Path}`, { headers: { Authorization: `Bearer ${Tokens[Device]}` }, ...(Body ? { method: "POST", body: JSON.stringify(Body) } : {}) });
		return { status: Response.status, body: await Response.json() as any };
	};
	const Rpc = (Device: number, Method: string, Params: any, Id: string = crypto.randomUUID()) => Http(Device, "/rpc", { id: Id, method: Method, params: Params });
	try
	{
		const Preflight = await fetch(`http://127.0.0.1:${Port}/rpc`, { method: "OPTIONS", headers: { Origin: "app://obsidian.md", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
		assert.equal(Preflight.status, 204);
		assert.equal(Preflight.headers.get("Access-Control-Allow-Origin"), "*");
		assert.equal(Preflight.headers.get("Access-Control-Allow-Credentials"), null);
		assert.match(Preflight.headers.get("Access-Control-Allow-Headers")!, /Authorization/);
		assert.equal(Peers.length, 0);
		const Unauthenticated = await fetch(`http://127.0.0.1:${Port}/info`);
		assert.equal(Unauthenticated.status, 401); assert.equal(Peers.length, 0);
		assert.equal(Unauthenticated.headers.get("Access-Control-Allow-Origin"), "*");
		await Http(0, "/info"); await Http(1, "/info"); assert.equal(Peers.length, 2);
		const Catalog = (await Rpc(0, "model/list", {})).body;
		assert.deepEqual(Catalog.data[0], { model: "model-a", displayName: "A", defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }], serviceTiers: [{ id: "priority", name: "Fast", description: "" }], additionalSpeedTiers: ["fast"], isDefault: true });
		assert.equal(Catalog.nextCursor, null);
		assert.ok(JSON.stringify(Catalog).length < 512);
		const State = { Settings: { Model: "model-a" }, Sessions: [{ Id: "session-a", Messages: [{ Id: "q", Role: "user", Text: "private", Prompt: "question", Task: { Id: "task-source", Source: { Path: "client-only.md", Text: "$x$", Mapping: "源块", CapturedAt: "original" } } }] }], ActiveId: "session-a" };
		const Saved = await Http(0, "/state", { state: State, cursor: 0 });
		assert.equal(Saved.status, 200);
		assert.deepEqual(Saved.body, { cursor: 0 });
		assert.ok(JSON.stringify(Saved.body).length < 64);
		const StartParams = { clientSessionId: "session-a", model: "model-a", cwd: "outside", sandbox: "danger-full-access", config: { model_reasoning_effort: "low" } };
		const [Thread, SameSession] = await Promise.all([Rpc(0, "thread/start", StartParams), Rpc(0, "thread/start", StartParams)]);
		assert.equal(Thread.status, 200);
		assert.equal(SameSession.body.thread.id, Thread.body.thread.id);
		assert.equal(Peers[0].calls.filter(Value => Value.Method === "thread/start").length, 1);
		const Started = Peers[0].calls.find(Value => Value.Method === "thread/start").Params;
		assert.equal(Started.cwd, Dir); assert.equal(Started.sandbox, "read-only"); assert.equal(Started.approvalPolicy, "never"); assert.equal(Started.ephemeral, true);
		const Params = { threadId: Thread.body.thread.id, model: "model-a", effort: "low", serviceTier: "default", input: [{ type: "text", text: "question" }, { type: "skill", name: "math-writing", path: "/arbitrary/secret" }] };
		assert.equal((await Rpc(1, "turn/start", Params)).status, 400);
		assert.equal((await Http(1, "/state")).body.state, null);
		const Id = "deduplicated-request";
		await Rpc(0, "turn/start", Params, Id); await Rpc(0, "turn/start", Params, Id);
		const Turns = Peers[0].calls.filter(Value => Value.Method === "turn/start");
		assert.equal(Turns.length, 1); assert.equal(Turns[0].Params.input[1].path, Skill);
		assert.equal((await Http(0, "/state")).body.state.Sessions[0].Messages[0].TurnId, "turn-1");
		const Resumed = await Rpc(0, "bridge/resume", { threadId: Thread.body.thread.id });
		assert.equal(Resumed.body.thread.turns[0].status, "inProgress");
		assert.ok(!Peers[0].calls.some(Value => Value.Method === "thread/read"));
		assert.equal((await Rpc(0, "turn/start", { ...Params, effort: "high" }, Id)).status, 400);
		for(const Method of ["config/write", "command/exec", "thread/list", "thread/resume", "thread/archive"])
		{
			assert.equal((await Rpc(0, Method, {})).status, 400);
		}
		await Rpc(0, "bridge/completion/cancel", { job: "cancel-before-arrival" });
		assert.equal((await Rpc(0, "bridge/completion", { job: "cancel-before-arrival" })).status, 400);
		Peers[0].emit({ method: "item/agentMessage/delta", params: { threadId: Thread.body.thread.id, turnId: "turn-1", itemId: "reply", delta: "partial" } });
		Peers[0].emit({ method: "item/completed", params: { threadId: Thread.body.thread.id, turnId: "turn-1", item: { id: "reply", type: "agentMessage", phase: "final_answer", text: "completed while offline" } } });
		Peers[0].emit({ method: "item/reasoning/summaryTextDelta", params: { threadId: Thread.body.thread.id, turnId: "turn-1", itemId: "summary", summaryIndex: 0, delta: "actual summary" } });
		Peers[0].emit({ method: "turn/completed", params: { threadId: Thread.body.thread.id, turn: { id: "turn-1", status: "completed" } } });
		await Http(0, "/state", { state: State, cursor: 0 });
		const Restored = (await Http(0, "/state")).body.state.Sessions[0].Messages;
		assert.equal(Restored.find((Value: any) => Value.Id === "reply").Text, "completed while offline");
		assert.equal(Restored.find((Value: any) => Value.Id === "reply").Phase, "final_answer");
		assert.equal(Restored.find((Value: any) => Value.Id === "reply").CompletionStatus, "completed");
		assert.equal(Restored.find((Value: any) => Value.Id === "q").TurnId, "turn-1");
		assert.equal(Restored.find((Value: any) => Value.Id === "q").Task.Source.Path, "client-only.md");
		assert.equal(Restored.find((Value: any) => Value.Id === "summary").Text, "actual summary");
		assert.equal((await Rpc(0, "bridge/resume", { threadId: Thread.body.thread.id })).body.thread.turns[0].status, "completed");
		assert.equal((await Http(1, "/events?after=0")).body.events.length, 0);
		assert.equal((await Http(0, "/events?after=0")).body.events.length, 4);
	}
	finally
	{
		await Bridge.close();
		assert.ok(Peers.every(Value => Value.closed));
		assert.ok(resolve(Dir).startsWith(resolve(tmpdir()) + sep));
		rmSync(Dir, { recursive: true });
	}
});
