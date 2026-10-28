// Original fixtures only. Actual pinned/current state-store and bridge code, no model process.
import assert from "node:assert/strict";
import * as FS from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";
import { SnapshotQueue, StreamCheckpoints } from "../src/runtime/checkpoints";

const Require = createRequire(import.meta.url), Baseline = "4cc440be3e77dcd16d893ff6d9d7bcf1eee90b6a";
const Bytes = (Text: string) => Buffer.byteLength(Text), Delay = () => new Promise(R => setTimeout(R, 2));
const EmptyStats = () => ({ readBytes: 0, writtenBytes: 0, reads: 0, writes: 0, saves: 0, peakQueued: 0 });
async function memory_case(Api: any, Coalesce: boolean, Large: boolean)
{
	const Values = new Map<string, string>(), Stats = EmptyStats();
	const Host = { exists: async (P: string) => Values.has(P), read: async (P: string) => { const Text = Values.get(P)!; Stats.reads++; Stats.readBytes += Bytes(Text); return Text; }, write: async (P: string, Text: string) => { await Delay(); Stats.writes++; Stats.writtenBytes += Bytes(Text); Values.set(P, Text); } };
	const State: any = { SchemaVersion: 2, Settings: { Original: "unchanged" }, ActiveId: "original", Sessions: [{ Id: "original", Messages: [{ Id: "q", Role: "user", Text: "Original question", Prompt: "Original immutable prompt", Context: { Text: "$x=1$", CapturedAt: "original" } }, { Id: "a", Role: "assistant", Text: Large ? "x".repeat(6_000_000) : "" }] }], Sync: { SchemaVersion: 1, Scope: "original-scope", Revision: 0, Versions: {}, Conflicts: [], Operations: [{ Id: "unknown-original", Status: "submission-unknown", Attempted: true, Input: { Prompt: "Original unknown input" }, RequestDigest: "original-request-evidence", TurnId: "unknown-turn" }] } };
	await Api.write_state_file(Host, "state.json", State); Object.assign(Stats, EmptyStats());
	const Queue = new SnapshotQueue(), Pending: Promise<void>[] = []; let Serial = Promise.resolve(), Queued = 0;
	const Save = (Value: any, Key?: string) =>
	{
		const Work = async () => { await Api.write_state_file(Host, "state.json", Value); Stats.saves++; };
		if(Coalesce) { Pending.push(Queue.enqueue(Work, Key)); Stats.peakQueued = Math.max(Stats.peakQueued, Queue.pending); }
		else { Queued++; Stats.peakQueued = Math.max(Stats.peakQueued, Queued); Serial = Serial.then(Work).finally(() => { Queued--; }); Pending.push(Serial); }
	};
	const Iterations = Large ? 1 : 100;
	for(let I = 0; I < Iterations; I++)
	{
		State.Sessions[0].Messages[1].Text += Large ? "1234567890abcdef" : "x".repeat(1600);
		Save(structuredClone(State), "original-scope:original:turn:a");
		if(!Large && I === 49) { Save(structuredClone(State)); }
	}
	if(!Large) { State.Sessions[0].Messages[1].CompletionStatus = "completed"; Save(structuredClone(State)); }
	await Promise.all(Pending);
	const Restored = await Api.load_state_file(Host, "state.json", "legacy.json");
	assert.deepEqual(Restored, State); assert.equal(Restored.Sync.Operations[0].Status, "submission-unknown");
	return { ...Stats, queue: Coalesce ? { ...Queue.Stats } : null, finalChars: Restored.Sessions[0].Messages[1].Text.length, finalExact: true, unknownEvidencePreserved: true, fixture: Large ? "6 MB plus 16 ASCII characters; checked memory adapter" : "100 growing checkpoints plus midway critical barrier and final; 2 ms per write" };
}
async function bridge_case(Api: any, Directory: string)
{
	FS.mkdirSync(Directory); const StateDir = join(Directory, "state"); FS.mkdirSync(StateDir);
	const Client = "original-cost-client", Skill = join(Directory, "SKILL.md"), Token = "original-test-token-".repeat(3); FS.writeFileSync(Skill, "Original fixture skill");
	const Original = { Settings: { Model: "original" }, ActiveId: "original", Sessions: [{ Id: "original", Title: "Original", Messages: [{ Id: "q", Role: "user", Text: "Original question", Prompt: "Original immutable prompt", Context: { Path: "Original.md", Text: "$x=1$", CapturedAt: "original" } }] }] };
	FS.writeFileSync(join(StateDir, Client + ".json"), JSON.stringify(Original));
	let Emit: (Message: any) => void = () => {}; let Submits = 0;
	const Config = { Port: 0, Cli: "mock", Cwd: Directory, Vault: "original-fixture", ObsidianCli: "mock", StateDir, Clients: [{ Id: Client, Hash: Api.token_hash(Token) }] };
	const Factory = (_Cli: string, _Cwd: string, OnMessage: (Message: any) => void) =>
	{
		Emit = OnMessage;
		return { async request(Method: string)
		{
			if(Method === "model/list") { return { data: [{ model: "original", supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" }], nextCursor: null }; }
			if(Method === "skills/list") { return { data: [{ cwd: Directory, skills: [{ name: "math-writing", path: Skill, enabled: true }] }] }; }
			if(Method === "thread/start") { return { model: "original", thread: { id: "original-thread", ephemeral: true, path: null, turns: [] } }; }
			if(Method === "turn/start") { Submits++; return { turn: { id: "original-turn", status: "inProgress" } }; }
			return {};
		}, send() {}, close() {} };
	};
	let Bridge = new Api.RemoteBridge(Config, Factory), Port = await Bridge.listen();
	const Http = async (Path: string, Body?: unknown) =>
	{
		const Response = await fetch(`http://127.0.0.1:${Port}${Path}`, { method: Body ? "POST" : "GET", headers: { Authorization: "Bearer " + Token }, ...(Body ? { body: JSON.stringify(Body) } : {}) });
		const Value: any = await Response.json(); if(!Response.ok) { throw Error(Value.error); } return Value;
	};
	const Rpc = (Method: string, Params: unknown) => Http("/rpc", { id: crypto.randomUUID(), method: Method, params: Params });
	try
	{
		await Http("/info"); const Agent = Bridge.Agents.get(Client), Store = Agent.Store;
		const Unknown = await Api.create_send_operation(Store.Scope, "original", "q", { Prompt: "Original unknown input" }); Unknown.Attempted = true; Unknown.Status = "submission-unknown"; Unknown.ThreadId = "unknown-thread"; Unknown.TurnId = "unknown-turn"; Store.put_operation(Unknown);
		await Rpc("thread/start", { clientSessionId: "original", model: "original", config: { model_reasoning_effort: "low" } });
		await Rpc("turn/start", { threadId: "original-thread", model: "original", effort: "low", input: [{ type: "text", text: "Original immutable prompt" }, { type: "skill", name: "math-writing", path: "fixture" }] });
		const BlobDir = join(StateDir, Client + "-blobs"), Inventory = () => { const Files = FS.readdirSync(BlobDir); return { count: Files.length, bytes: Files.reduce((N, File) => N + FS.statSync(join(BlobDir, File)).size, 0) }; }, Before = Inventory();
		let Text = ""; const Start = performance.now();
		for(let I = 0; I < 100; I++) { const Delta = "x".repeat(1600); Text += Delta; Emit({ method: "item/agentMessage/delta", params: { threadId: "original-thread", turnId: "original-turn", itemId: "answer", delta: Delta } }); }
		Emit({ method: "item/completed", params: { threadId: "original-thread", turnId: "original-turn", item: { id: "answer", type: "agentMessage", phase: "final_answer", text: Text } } });
		Emit({ method: "turn/completed", params: { threadId: "original-thread", turn: { id: "original-turn", status: "completed" } } });
		const Duration = performance.now() - Start, After = Inventory(), Data = (await Http("/state")).state;
		assert.equal(Data.Sessions[0].Messages.find((M: any) => M.Id === "answer").Text, Text);
		assert.equal(Data.Sessions[0].Messages[0].Prompt, Original.Sessions[0].Messages[0].Prompt);
		assert.deepEqual(Store.operation(Unknown.Id).Input, Unknown.Input); assert.equal(Store.operation(Unknown.Id).Status, "submission-unknown");
		const Checkpoints = Agent.Checkpoints ? { ...Agent.Checkpoints.Stats } : null;
		await Bridge.close(); Bridge = new Api.RemoteBridge(Config, Factory); Port = await Bridge.listen();
		const Recovered = (await Http("/state")).state; assert.equal(Recovered.Sessions[0].Messages.find((M: any) => M.Id === "answer").Text, Text); assert.equal(Bridge.Agents.get(Client).Store.operation(Unknown.Id).Status, "submission-unknown"); assert.equal(Submits, 1);
		return { finalChars: Text.length, blobFilesAdded: After.count - Before.count, blobBytesAdded: After.bytes - Before.bytes, durationMs: Duration, checkpoints: Checkpoints, finalExactAfterRestart: true, originalPromptAndSourcePreserved: true, unknownEvidencePreserved: true, mockSubmits: Submits, newSubmitsOnRestart: 0, fixture: "actual RemoteBridge loopback + controlled RPC peer; 100 ASCII deltas of 1600 bytes, completed item and turn" };
	}
	finally { await Bridge.close(); }
}
async function full_checkpoint_case(Api: any, Directory: string, Coalesce: boolean)
{
	FS.mkdirSync(Directory); const Legacy = join(Directory, "original-client.json");
	FS.writeFileSync(Legacy, JSON.stringify({ Settings: {}, ActiveId: "s", Sessions: [{ Id: "s", Messages: [] }] }));
	const Store = new Api.SyncServerStore(Directory, "original-client", Legacy), BlobDir = join(Directory, "original-client-blobs");
	const Size = () => FS.readdirSync(BlobDir).reduce((N, F) => N + FS.statSync(join(BlobDir, F)).size, 0), Before = Size(), Checkpoints = new StreamCheckpoints();
	let Text = "", Writes = 0;
	const Save = () => { Store.observe_message("s", { Id: "a", Role: "assistant", TurnId: "turn", Text }); Writes++; };
	for(let I = 0; I < 100; I++) { Text += "x".repeat(1600); if(Coalesce) { Checkpoints.offer("scope:s:turn:a", 1600, Save); } else { Save(); } }
	if(Coalesce) { Checkpoints.flush(); } Checkpoints.close();
	assert.equal(Store.materialize().Sessions[0].Messages[0].Text, Text);
	return { finalChars: Text.length, saves: Writes, blobBytesAdded: Size() - Before, finalExact: true, fixture: "100 complete growing source snapshots through actual SyncServerStore; candidate uses actual StreamCheckpoints byte/time policy" };
}
async function main()
{
	const Directory = FS.mkdtempSync(join(tmpdir(), "codex-checkpoint-cost-")), Apis: any[] = [];
	for(const Old of [true, false])
	{
		const File = join(Directory, Old ? "baseline.cjs" : "candidate.cjs");
		await build({ stdin: { contents: 'export { RemoteBridge, token_hash } from "./bridge"; export { load_state_file, write_state_file } from "./runtime/state-store"; export { create_send_operation } from "./sync/operations"; export { SyncServerStore } from "./sync/server-store";', resolveDir: join(process.cwd(), "src"), loader: "ts" }, plugins: Old ? [{ name: "pinned-checkpoint-baseline", setup(B)
		{
			B.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, Args => ({ contents: execFileSync("git", ["show", Baseline + ":" + relative(process.cwd(), Args.path).replaceAll("\\", "/")], { encoding: "utf8" }), loader: "ts" }));
		} }] : [], bundle: true, platform: "node", format: "cjs", outfile: File });
		Apis.push(Require(File));
	}
	const Rows = [];
	for(const [I, Api] of Apis.entries()) { Rows.push({ implementation: I ? "candidate" : Baseline, singleLargeSave: await memory_case(Api, !!I, true), slowQueue: await memory_case(Api, !!I, false), fullSnapshots: await full_checkpoint_case(Api, join(Directory, I ? "candidate-full" : "baseline-full"), !!I), bridge: await bridge_case(Api, join(Directory, I ? "candidate-bridge" : "baseline-bridge")) }); }
	assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); const Report = { tier: "original memory-adapter counts, actual temp disk blobs and controlled HTTP/RPC; not disk throughput/device/inference acceptance", cases: Rows };
	FS.writeFileSync(join(Directory, "report.json"), JSON.stringify(Report, null, 2)); console.log(JSON.stringify({ directory: Directory, ...Report }));
	assert.ok(Rows[1].slowQueue.saves < Rows[0].slowQueue.saves); assert.ok(Rows[1].slowQueue.peakQueued <= 5);
	assert.ok(Rows[1].fullSnapshots.blobBytesAdded < Rows[0].fullSnapshots.blobBytesAdded / 4);
	assert.ok(Rows[1].bridge.blobBytesAdded < Rows[0].bridge.blobBytesAdded, "beta.1 already checkpoints every 16 events; compare actual event policy separately");
}
void main().catch(E => { console.error(E); process.exitCode = 1; });
