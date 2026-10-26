import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { RemoteBridge, token_hash } from "../src/bridge";
import { RemoteConnection } from "../src/remote";
import { create_send_operation } from "../src/sync/operations";
import { SyncServerStore } from "../src/sync/server-store";
import { ProductVersion } from "../src/version";
import { load_state_file, write_state_file } from "../src/runtime/state-store";
import { entity_key } from "../src/sync/types";

async function fixture(Seed?: (Config: any) => Promise<void>)
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-sync-original-")), Skill = join(Directory, "SKILL.md"); writeFileSync(Skill, "Original acceptance skill");
	const Tokens = ["a".repeat(48), "b".repeat(48)], Peers: any[] = []; let Submits = 0, Crash = false;
	const Config = { Port: 0, Cli: "mock", Cwd: Directory, Vault: "Original", ObsidianCli: "mock", StateDir: join(Directory, "state"), Clients: Tokens.map((Token, I) => ({ Id: "client-original-" + I, Hash: token_hash(Token) })) };
	const Create = (_Cli: string, _Cwd: string, Emit: any) =>
	{
		const Peer: any = { emit: Emit, count: Peers.length, closed: false }; Peers.push(Peer);
		return { async request(Method: string, Params: any)
		{
			if(Method === "model/list") { return { data: [{ model: "original-model", displayName: "Original", supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" }], nextCursor: null }; }
			if(Method === "skills/list") { return { data: [{ cwd: Directory, skills: [{ name: "math-writing", path: Skill, enabled: true }] }] }; }
			if(Method === "thread/start") { return { model: "original-model", thread: { id: "thread-" + Peer.count, ephemeral: true, path: null, turns: [] } }; }
			if(Method === "turn/start") { Submits++; if(Crash) { throw new Error("Original crash after possible submission"); } return { turn: { id: "turn-" + Submits, status: "inProgress" } }; }
			return {};
		}, send() {}, close() { Peer.closed = true; } };
	};
	await Seed?.(Config);
	let Bridge = new RemoteBridge(Config, Create), Port = await Bridge.listen(), MaxPost = 0;
	const Http = (Device = 0) => async (Path: string, Method: string, Body?: unknown) =>
	{
		if(Body) { MaxPost = Math.max(MaxPost, Buffer.byteLength(JSON.stringify(Body))); }
		const Response = await fetch(`http://127.0.0.1:${Port}${Path}`, { method: Method, headers: { Authorization: "Bearer " + Tokens[Device] }, ...(Body ? { body: JSON.stringify(Body) } : {}) });
		const Result: any = await Response.json(); if(!Response.ok) { throw new Error(Result.error); } return Result;
	};
	const connection = (Device = 0, Override?: any, Message: (M: any) => void = () => {}) => new RemoteConnection(Override ?? Http(Device), { Enabled: true, Url: "https://original.test", Token: "fixture", Cursor: 0, Server: "", CacheId: "local-original" }, Message, () => {}, () => {});
	return { Directory, Config, Peers, Http, connection, submissions: () => Submits, crash: () => { Crash = true; }, max_post: () => MaxPost, restart: async () => { await Bridge.close(); Bridge = new RemoteBridge(Config, Create); Port = await Bridge.listen(); }, close: async () => { await Bridge.close(); assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); } };
}
function state(Messages: any[] = []) { return { Settings: { Model: "original-model", Effort: "low", Instructions: "Original" }, Sessions: [{ Id: "original-session", Title: "Original", ThreadId: null, Messages }], ActiveId: "original-session" }; }

test("protocol2 syncs history larger than one HTTP budget by content pages and rejects stale legacy writes", async () =>
{
	const F = await fixture(), C = F.connection();
	try
	{
		await C.connect(); assert.equal(C.Info.bridgeVersion, ProductVersion); assert.equal(C.Info.protocolVersion, 2); assert.equal(C.Info.capabilities.operationStatus, 1);
		const Local = state(Array.from({ length: 44 }, (_, I) => ({ Id: "message-" + I, Role: "user", Text: "原创公式".repeat(14000) + I, Prompt: "Original prompt " + I, Context: { Path: "Original.md", Text: "$x=1$", CapturedAt: "original" } })));
		assert.ok(Buffer.byteLength(JSON.stringify(Local)) > 4 * 1024 * 1024); await C.sync_state(Local);
		assert.ok(F.max_post() < 4 * 1024 * 1024);
		const Restored = await C.restore_state(state()); assert.equal(Restored.Sessions[0].Messages.length, 44); assert.equal(Restored.Sessions[0].Messages.at(-1)!.Text, Local.Sessions[0].Messages.at(-1)!.Text);
		await assert.rejects(F.Http()("/state", "POST", { state: state([]), cursor: 0 }), /旧版整份.*拒绝/);
		await F.restart(); const D = F.connection(); await D.connect(); assert.equal(D.scope(), C.scope()); const Again = await D.restore_state(state()); assert.equal(Again.Sessions[0].Messages.length, 44); D.close();
	}
	finally { C.close(); await F.close(); }
});

test("lost operation receipt and bridge restart never submit inference twice", async () =>
{
	const F = await fixture(), Ordinary = F.Http(); let Lose = true;
	const C = F.connection(0, async (Path: string, Method: string, Body?: unknown) => { const Result = await Ordinary(Path, Method, Body); if(Path === "/operations" && Method === "POST" && Lose) { Lose = false; throw Error("Original lost response"); } return Result; });
	try
	{
		await C.connect(); const S = state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original prompt" }]); await C.sync_state(S);
		const Thread = await C.request("thread/start", { clientSessionId: "original-session", model: "original-model", config: { model_reasoning_effort: "low" } }), Params = { threadId: Thread.thread.id, model: "original-model", effort: "low", input: [{ type: "text", text: "Original prompt" }, { type: "skill", name: "math-writing", path: "/client/path" }] };
		const O = await create_send_operation(C.scope(), "original-session", "q", { Prompt: "Original prompt" }); let Saved: any;
		await assert.rejects(C.request_operation(O, Params, async () => { Saved = structuredClone(O); }), /待核对/); assert.equal(Saved.Attempted, true); assert.equal(Saved.Status, "submission-unknown"); assert.equal(F.submissions(), 1);
		const Running = await C.operation_status(O.Id); assert.equal(Running!.Status, "running");
		await F.restart(); const D = F.connection(); await D.connect(); const Receipt = await D.operation_status(O.Id); assert.equal(Receipt!.TurnId, "turn-1"); assert.equal(Receipt!.Status, "submission-unknown");
		const Recovered = await D.restore_state({ ...S, Sync: { SchemaVersion: 1 as const, Scope: D.scope(), Revision: 0, Versions: {}, Operations: [Running!], Conflicts: [] } }); assert.equal(Recovered.Sync!.Operations[0].Status, "submission-unknown");
		const Result = await D.request_operation(Saved, Params); assert.equal(Result.operation.Id, O.Id); assert.equal(F.submissions(), 1);
		const Other = F.connection(1); await Other.connect(); assert.equal(await Other.operation_status(O.Id), null); Other.close(); D.close();
	}
	finally { C.close(); await F.close(); }
});

test("a CLI submission crash persists an unknown operation with both request digests and refuses changed input", async () =>
{
	const F = await fixture(), C = F.connection();
	try
	{
		await C.connect(); await C.sync_state(state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original prompt" }]));
		const Thread = await C.request("thread/start", { clientSessionId: "original-session", model: "original-model", config: { model_reasoning_effort: "low" } }), Params = { threadId: Thread.thread.id, model: "original-model", effort: "low", input: [{ type: "text", text: "Original prompt" }, { type: "skill", name: "math-writing", path: "original" }] };
		const O = await create_send_operation(C.scope(), "original-session", "q", { Prompt: "Original prompt" }); F.crash(); await assert.rejects(C.request_operation(O, Params, async () => {}), /待核对/);
		await F.restart(); const D = F.connection(); await D.connect(); const Status = await D.operation_status(O.Id); assert.equal(Status!.Status, "submission-unknown"); assert.match(Status!.HostRequestDigest!, /^[a-f0-9]{64}$/); assert.equal(F.submissions(), 1);
		await assert.rejects(D.request_operation({ ...O, Attempted: false, Input: { Prompt: "changed" }, Digest: "f".repeat(64) }, Params), /摘要|不可变|待核对/); assert.equal(F.submissions(), 1); D.close();
	}
	finally { C.close(); await F.close(); }
});

test("migration keeps legacy bytes, pinned pages remain consistent during mutations and deletion survives old snapshots", async () =>
{
	const Dir = mkdtempSync(join(tmpdir(), "codex-sync-migration-")), File = join(Dir, "client-original.json"), Old = state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original prompt" }]);
	writeFileSync(File, JSON.stringify(Old));
	try
	{
		const Store = new SyncServerStore(Dir, "client-original", File); assert.equal(readFileSync(File, "utf8"), JSON.stringify(Old)); assert.equal(readFileSync(File + ".before-sync-v2", "utf8"), JSON.stringify(Old));
		const Page = Store.page("catalog", null, 0), Before = Store.page("history", Page.revision, 0, "original-session");
		Store.observe_message("original-session", { Id: "new", Role: "assistant", Text: "Original new response" }); const Pinned = Store.page("history", Page.revision, 0, "original-session"); assert.deepEqual(Pinned, Before);
		const Key = JSON.stringify(["session-delete", "original-session", ""]), Delete = Store.delta({ scope: Store.Scope, id: "delete-original", baseRevision: Store.Data.Revision, mutations: [{ Key, Kind: "session-delete", SessionId: "original-session", Expected: 0 }] }); assert.equal(Delete.ok, true);
		Store.observe_message("original-session", { Id: "late", Role: "assistant", Text: "Original late" }); assert.equal(Store.materialize().Sessions.length, 0);
		const Reopened = new SyncServerStore(Dir, "client-original", File); assert.equal(Reopened.materialize().Sessions.length, 0); assert.throws(() => Reopened.legacy_write(Old), /拒绝/); assert.ok(existsSync(File));
	}
	finally { assert.ok(resolve(Dir).startsWith(resolve(tmpdir()) + sep)); rmSync(Dir, { recursive: true }); }
});

test("failed message upload followed by real reconnect, persistence and another restart preserves local m2", async () =>
{
	const F = await fixture(), Values = new Map<string, string>(), Files = { exists: async (P: string) => Values.has(P), read: async (P: string) => Values.get(P)!, write: async (P: string, V: string) => { Values.set(P, V); } };
	const Http = F.Http(); let Offline = false;
	const C = F.connection(0, (P: string, M: string, B?: unknown) => { if(Offline && P === "/sync/delta") { throw Error("Original offline upload"); } return Http(P, M, B); });
	try
	{
		await C.connect(); const Local: any = state([{ Id: "m1", Role: "user", Text: "Original one", Prompt: "Original one" }]); await C.sync_state(Local);
		Local.Sessions[0].Messages.push({ Id: "m2", Role: "user", Text: "Original offline two", Prompt: "Original offline two", Context: { Text: "$x=2$" } });
		await write_state_file(Files, "state.json", Local); Offline = true; await assert.rejects(C.sync_state(Local), /offline/); C.close(); Offline = false;
		const D = F.connection(); await D.connect(); const Restored = await D.restore_state(await load_state_file(Files, "state.json", "legacy.json"));
		assert.deepEqual(Restored.Sessions[0].Messages.map((M: any) => M.Id), ["m1", "m2"]); await write_state_file(Files, "state.json", Restored); D.close();
		await F.restart(); const E = F.connection(); await E.connect(); const Restarted = await E.restore_state(await load_state_file(Files, "state.json", "legacy.json"));
		assert.equal(Restarted.Sessions[0].Messages[1].Context!.Text, "$x=2$"); await E.sync_state(Restarted); await write_state_file(Files, "state.json", Restarted);
		assert.equal((await load_state_file(Files, "state.json", "legacy.json")).Sessions[0].Messages.length, 2); E.close();
	}
	finally { C.close(); await F.close(); }
});

test("unchanged device preferences never overwrite shared settings and offline edits retain both conflict values", async () =>
{
	const F = await fixture(), A = F.connection(), B = F.connection();
	try
	{
		await A.connect(); const SA: any = state(); await A.sync_state(SA); await B.connect();
		const Device: any = state(); Device.Settings.Instructions = "Original local device preference";
		let SB: any = await B.restore_state(Device); await B.sync_state(SB);
		let Remote = await F.Http()("/state", "GET"); assert.equal(Remote.state.Settings.Instructions, "Original");
		SA.Settings.Effort = "original-new-effort"; await A.sync_state(SA);
		SB.Settings.Instructions = "Original offline deliberate change"; SB = await B.restore_state(SB);
		await assert.rejects(B.sync_state(SB), /冲突/);
		const Conflict = SB.Sync.Conflicts.find((C: any) => C.Key === entity_key("settings"));
		assert.equal(Conflict.Local.Instructions, "Original offline deliberate change"); assert.equal(Conflict.Remote.Effort, "original-new-effort");
		Remote = await F.Http()("/state", "GET"); assert.equal(Remote.state.Settings.Instructions, "Original");
		SB.Settings.Instructions = "Original new explicit choice after conflict"; await B.sync_state(SB);
		Remote = await F.Http()("/state", "GET"); assert.equal(Remote.state.Settings.Instructions, SB.Settings.Instructions); assert.equal(SB.Sync.Conflicts.length, 1);
	}
	finally { A.close(); B.close(); await F.close(); }
});

test("preparation metadata preserves immutable input while same-ID input changes retain concrete conflict evidence", async () =>
{
	const F = await fixture(), C = F.connection();
	try
	{
		await C.connect(); const S: any = state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original prompt" }]); await C.sync_state(S);
		S.Sessions[0].Messages[0].InputLedger = { Version: 1, Original: true }; await C.sync_state(S);
		S.Sessions[0].Messages[0].Prompt = "Original changed input"; await assert.rejects(C.sync_state(S), /冲突/);
		assert.equal(S.Sync.Conflicts[0].Local.Prompt, "Original changed input"); assert.equal(S.Sync.Conflicts[0].Remote.Prompt, "Original prompt");
		assert.equal((await F.Http()("/state", "GET")).state.Sessions[0].Messages[0].Prompt, "Original prompt");
	}
	finally { C.close(); await F.close(); }
});

test("cancellation during chunk preparation stops remaining upload and performs no inference POST", async () =>
{
	const F = await fixture(), Http = F.Http(), Controller = new AbortController(); let Armed = false, Parts = 0;
	const C = F.connection(0, async (P: string, M: string, B?: unknown) => { if(Armed && P === "/sync/blob" && M === "POST") { Parts++; Controller.abort(); } return Http(P, M, B); });
	try
	{
		await C.connect(); const O = await create_send_operation(C.scope(), "original-session", "q", { Prompt: "Original".repeat(50000) }); Armed = true;
		await assert.rejects(C.request_operation(O, { input: [{ type: "text", text: "Original" }] }, async () => { throw Error("Must not reach inference boundary"); }, Controller.signal), /取消/);
		assert.equal(Parts, 1); assert.equal(O.Attempted, false); assert.equal(O.Status, "local"); assert.equal(F.submissions(), 0);
	}
	finally { C.close(); await F.close(); }
});

test("reply checkpoints occurring after a pinned snapshot are hydrated once without replaying text deltas", async () =>
{
	const F = await fixture(), Http = F.Http(), Messages: any[] = []; let EmitDuringHistory = false, Done!: () => void;
	const Complete = new Promise<void>(Resolve => { Done = Resolve; });
	const C = F.connection(0, async (P: string, M: string, B?: unknown) =>
	{
		if(EmitDuringHistory && P.startsWith("/sync/history"))
		{
			EmitDuringHistory = false; const Peer = F.Peers[0], Common = { threadId: "thread-0", turnId: "turn-1", itemId: "original-answer" };
			Peer.emit({ method: "turn/started", params: { threadId: Common.threadId, turn: { id: Common.turnId, status: "inProgress" } } });
			for(let I = 0; I < 20; I++) { Peer.emit({ method: "item/agentMessage/delta", params: { ...Common, delta: "原创" } }); }
			Peer.emit({ method: "item/completed", params: { ...Common, item: { id: Common.itemId, type: "agentMessage", text: "原创".repeat(20), phase: "final_answer" } } });
			Peer.emit({ method: "turn/completed", params: { threadId: Common.threadId, turn: { id: Common.turnId, status: "completed" } } });
		}
		return Http(P, M, B);
	}, Message => { Messages.push(Message); if(Message.method === "turn/completed") { C.close(); Done(); } });
	try
	{
		await C.connect(); const Local: any = state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original prompt" }]); await C.sync_state(Local);
		const Thread = await C.request("thread/start", { clientSessionId: "original-session", model: "original-model", config: { model_reasoning_effort: "low" } }), O = await create_send_operation(C.scope(), "original-session", "q", { Prompt: "Original prompt" });
		await C.request_operation(O, { threadId: Thread.thread.id, model: "original-model", effort: "low", input: [{ type: "text", text: "Original prompt" }, { type: "skill", name: "math-writing", path: "original" }] }, async () => {});
		EmitDuringHistory = true; const Restored = await C.restore_state(Local); assert.equal(Restored.Sessions[0].Messages.filter((M: any) => M.Role === "assistant").length, 0); C.start();
		const Timeout = setTimeout(() => Done(), 3000); await Complete; clearTimeout(Timeout);
		const Updates = Messages.filter(M => M.method === "bridge/message-updated"); assert.ok(Updates.length >= 1); assert.equal(Updates.at(-1).params.message.Text, "原创".repeat(20));
		assert.equal(Messages.filter(M => M.method === "item/agentMessage/delta").length, 0); assert.equal(Messages.filter(M => M.method === "turn/completed").length, 1);
	}
	finally { C.close(); await F.close(); }
});

test("an older restore snapshot cannot roll back a concurrent successful delta acknowledgement", async () =>
{
	const F = await fixture(), Http = F.Http(); let Hold = false, Reached!: () => void, Release!: () => void;
	const Gate = new Promise<void>(Resolve => { Release = Resolve; }), Paused = new Promise<void>(Resolve => { Reached = Resolve; });
	const C = F.connection(0, async (P: string, M: string, B?: unknown) => { const Value = await Http(P, M, B); if(Hold && P.startsWith("/operations?offset=")) { Hold = false; Reached(); await Gate; } return Value; });
	try
	{
		await C.connect(); const S: any = state([{ Id: "m1", Role: "user", Text: "Original one", Prompt: "Original one" }]); await C.sync_state(S);
		Hold = true; const Restoring = C.restore_state(structuredClone(S)); await Paused;
		S.Sessions[0].Messages.push({ Id: "m2", Role: "user", Text: "Original two", Prompt: "Original two" }); S.Settings.Instructions = "Original new choice"; await C.sync_state(S);
		const Version = S.Sync.Versions[entity_key("message", "original-session", "m2")]; Release(); const Earlier = await Restoring;
		assert.deepEqual(Earlier.Sync!.Versions[entity_key("message", "original-session", "m2")], Version);
		S.Settings.Instructions = "Original next explicit choice"; await C.sync_state(S); assert.equal((await F.Http()("/state", "GET")).state.Settings.Instructions, S.Settings.Instructions);
	}
	finally { Release(); C.close(); await F.close(); }
});

test("another client with the same pairing triggers read-only state recovery while a different pairing stays isolated", async () =>
{
	const F = await fixture(), A = F.connection(), B = F.connection(), Isolated = F.connection(1); let Recovered: any, Done!: () => void;
	const Complete = new Promise<void>(Resolve => { Done = Resolve; });
	try
	{
		await A.connect(); const S = state([{ Id: "m1", Role: "user", Text: "Original one", Prompt: "Original one" }]); await A.sync_state(S);
		await B.connect(); let Local = await B.restore_state(state()); await Isolated.connect(); assert.notEqual(Isolated.scope(), A.scope());
		B.set_recovery(async () => { Local = await B.restore_state(Local); Recovered = Local; B.close(); Done(); });
		S.Sessions[0].Messages.push({ Id: "m2", Role: "user", Text: "Original shared two", Prompt: "Original shared two" }); await A.sync_state(S); B.start();
		const Timeout = setTimeout(() => Done(), 3000); await Complete; clearTimeout(Timeout);
		assert.equal(Recovered.Sessions[0].Messages.length, 2); assert.equal((await Isolated.restore_state(state())).Sessions[0].Messages.length, 0); assert.equal(F.submissions(), 0);
	}
	finally { A.close(); B.close(); Isolated.close(); await F.close(); }
});

test("operation recovery uses bounded snapshot pages instead of returning every logical input in one response", async () =>
{
	const F = await fixture(async Config =>
	{
		const Store = new SyncServerStore(Config.StateDir, Config.Clients[0].Id), Messages = Array.from({ length: 70 }, (_, I) => ({ Id: "q-" + I, Role: "user", Text: "Original " + I, Prompt: "Original prompt " + I }));
		Store.legacy_write(state(Messages));
		for(const M of Messages) { Store.put_operation(await create_send_operation(Store.Scope, "original-session", M.Id, { Prompt: M.Prompt }, "original-operation-" + M.Id)); }
	}), Http = F.Http(); let Pages = 0;
	const C = F.connection(0, async (P: string, M: string, B?: unknown) => { const Value = await Http(P, M, B); if(P.startsWith("/operations?offset=")) { Pages++; assert.ok(Buffer.byteLength(JSON.stringify(Value)) <= 128 * 1024); assert.ok(Value.operations.length <= 64); } return Value; });
	try
	{
		await C.connect(); const Restored: any = await C.restore_state(state()); assert.equal(Restored.Sync!.Operations.length, 70); assert.ok(Pages >= 2); assert.equal((Restored.Sync!.Operations.at(-1)!.Input as any).Prompt, "Original prompt 69"); assert.equal(F.submissions(), 0);
	}
	finally { C.close(); await F.close(); }
});

test("message deletion survives stale snapshots, late server observation, legacy import and bridge restart without deleting its branch", async () =>
{
	const F = await fixture(), C = F.connection();
	try
	{
		await C.connect(); const S: any = state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original immutable prompt" }, { Id: "answer", Role: "assistant", Text: "Original response", TurnId: "original-turn" }]);
		S.Sessions.push({ ...structuredClone(S.Sessions[0]), Id: "original-branch", ParentId: "original-session" }); await C.sync_state(S); const Stale = structuredClone(S);
		S.DeletedMessages = [{ SessionId: "original-session", MessageId: "answer" }]; await C.sync_state(S);
		const Restored = await C.restore_state(Stale); assert.deepEqual(Restored.DeletedMessages, S.DeletedMessages); assert.equal(Restored.Sessions[0].Messages.length, 1); assert.equal(Restored.Sessions[0].Messages[0].Prompt, "Original immutable prompt"); assert.equal(Restored.Sessions[1].Messages.length, 2);
		await F.restart(); const D = F.connection(); await D.connect(); const Again = await D.restore_state(Stale); assert.equal(Again.Sessions[0].Messages.length, 1); assert.equal(Again.Sessions[1].Messages[1].Text, "Original response"); D.close();
	}
	finally { C.close(); await F.close(); }
	const Directory = mkdtempSync(join(tmpdir(), "codex-message-delete-original-"));
	try
	{
		const Store = new SyncServerStore(Directory, "original-client"), Before = state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original immutable prompt" }, { Id: "answer", Role: "assistant", Text: "Original response" }]); Store.legacy_write(Before);
		const Key = entity_key("message-delete", "original-session", "answer"); Store.delta({ scope: Store.Scope, id: "original-delete", baseRevision: Store.Data.Revision, mutations: [{ Key, Kind: "message-delete", SessionId: "original-session", MessageId: "answer", Expected: 0 }] });
		const Revision = Store.Data.Rows.find(R => R.Key === entity_key("message", "original-session", "answer"))!.Revision;
		Store.observe_message("original-session", { Id: "answer", Role: "assistant", Text: "Original late checkpoint" }); Store.import_state(Before);
		assert.equal(Store.Data.Rows.find(R => R.Key === entity_key("message", "original-session", "answer"))!.Revision, Revision); assert.equal(Store.message_version("original-session", "answer"), null); assert.equal(Store.materialize().Sessions[0].Messages.length, 1); assert.deepEqual(Store.materialize().DeletedMessages, [{ SessionId: "original-session", MessageId: "answer" }]);
	}
	finally { assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); }
});

test("legacy-scope operations retain original identity during protocol upgrade and cannot be resent under the new scope", async () =>
{
	const F = await fixture(), C = F.connection();
	try
	{
		const Legacy = await create_send_operation("legacy:client-original-0", "original-session", "q", { Prompt: "Original preserved legacy input" }, "original-legacy-operation"); Legacy.Status = "submission-unknown"; Legacy.Attempted = true;
		const Local: any = state([{ Id: "q", Role: "user", Text: "Original", Prompt: "Original preserved legacy input" }]); Local.Sync = { SchemaVersion: 1, Scope: Legacy.Scope, Revision: 0, Versions: {}, Operations: [Legacy], Conflicts: [] };
		await C.connect(); const Upgraded = await C.restore_state(Local), Saved = Upgraded.Sync!.Operations[0]; assert.equal(Upgraded.Sync!.Scope, C.scope()); assert.equal(Saved.Scope, Legacy.Scope); assert.equal(Saved.Digest, Legacy.Digest); assert.deepEqual(Saved.Input, Legacy.Input);
		assert.equal(await C.operation_status(Saved.Id), null); await assert.rejects(C.request_operation(Saved, {}), /其他连接作用域/); assert.equal(F.submissions(), 0);
	}
	finally { C.close(); await F.close(); }
});
