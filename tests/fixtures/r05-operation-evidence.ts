import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { RemoteBridge, token_hash } from "../../src/bridge";
import { RemoteConnection } from "../../src/remote";
import { create_send_operation } from "../../src/sync/operations";
import { SyncServerStore } from "../../src/sync/server-store";
import { client_sync, content_digest } from "../../src/sync/types";
import { load_state_file, write_state_file } from "../../src/runtime/state-store";

export async function operation_evidence_fixture(Options: { WithoutResult?: boolean; WithoutRequest?: boolean } = {})
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-r05-owned-")), Token = "r05-original-".repeat(4), Client = "r05-original-device";
	const StateDir = join(Directory, "bridge-state"), Store = new SyncServerStore(StateDir, Client);
	const Input = { Prompt: "Original proof: if x=2, explain x^2=4.", Context: { Path: "Original.md", Text: "$x=2$", CapturedAt: "original-capture" } };
	const Operation = await create_send_operation(Store.Scope, "r05-session", "r05-question", Input, "r05-operation");
	const Request = { threadId: "r05-thread", model: "original-model", input: [{ type: "text", text: Input.Prompt }] };
	Object.assign(Operation, { Status: "submission-unknown", Attempted: true, Request, RequestDigest: await content_digest(Request) });
	const Result = { turn: { id: "r05-turn", status: "inProgress" }, receipt: { id: "r05-original-receipt" } };
	const Local: any = { Settings: { Model: "original-model" }, ActiveId: Operation.SessionId, Sessions: [{ Id: Operation.SessionId, Title: "Original evidence", ThreadId: "r05-thread", Messages: [{ Id: Operation.MessageId, Role: "user", Text: Input.Prompt, Prompt: Input.Prompt, Context: Input.Context }, { Id: "r05-answer", Role: "assistant", Text: "Original saved answer: $2^2=4$.", TurnId: "r05-turn" }] }], Sync: { ...client_sync(Store.Scope), Operations: [Operation] } };
	Store.legacy_write(Local);
	const Remote = { ...structuredClone(Operation), Status: "completed" as const, ThreadId: "r05-thread", TurnId: "r05-turn", ...(Options.WithoutResult ? {} : { Result }) };
	if(Options.WithoutRequest) { delete Remote.Request; delete Remote.RequestDigest; }
	Store.put_operation(Remote);
	const ResultBlob = Store.store_value(Result), InputBlob = Store.store_value(Input), RequestBlob = Store.store_value(Request);
	const Config = { Port: 0, Cli: "unused-original-fixture", Cwd: Directory, Vault: "Original", ObsidianCli: "unused", StateDir, Clients: [{ Id: Client, Hash: token_hash(Token) }] };
	let InferenceCalls = 0, InferencePosts = 0, ResultReads = 0, StatusReads = 0, FailResult = false, CorruptResult = false;
	const Skill = join(Directory, "SKILL.md"); writeFileSync(Skill, "Original test-only math-writing fixture");
	const Peer = () => ({ request: async (Method: string) =>
	{
		if(Method === "initialize") { return {}; }
		if(Method === "account/read") { return { account: { type: "chatgpt" } }; }
		if(Method === "model/list") { return { data: [{ model: "original-model" }], nextCursor: null }; }
		if(Method === "skills/list") { return { data: [{ cwd: Directory, skills: [{ name: "math-writing", path: Skill, enabled: true }] }] }; }
		InferenceCalls++; throw Error("R05 recovery must never launch inference");
	}, send() {}, close() {} });
	let Bridge = new RemoteBridge(Config, Peer), Port = await Bridge.listen();
	const Http = async (Path: string, Method: string, Body?: unknown) =>
	{
		if(Method === "POST" && Path === "/operations") { InferencePosts++; throw Error("R05 recovery must never POST inference"); }
		if(Method === "GET" && Path.startsWith("/operations?id=")) { StatusReads++; }
		const ReadingResult = Method === "GET" && Path.startsWith("/sync/blob?id=" + ResultBlob);
		if(ReadingResult) { ResultReads++; if(FailResult) { throw Error("original result download failed"); } }
		const Response = await fetch(`http://127.0.0.1:${Port}${Path}`, { method: Method, headers: { Authorization: "Bearer " + Token }, ...(Body === undefined ? {} : { body: JSON.stringify(Body) }) });
		const Value: any = await Response.json(); if(!Response.ok) { throw Error(Value.error); }
		if(ReadingResult && CorruptResult) { Value.data = Buffer.from(JSON.stringify({ receipt: "original corrupt payload" })).toString("base64"); Value.bytes = Buffer.byteLength(Buffer.from(Value.data, "base64")); }
		return Value;
	};
	const Files = { exists: async (Path: string) => { try { await access(Path); return true; } catch { return false; } }, read: (Path: string) => readFile(Path, "utf8"), write: (Path: string, Text: string) => writeFile(Path, Text, "utf8") };
	const Path = join(Directory, "local-state-v2.json"), LegacyPath = join(Directory, "local-state-legacy.json");
	const connection = () => new RemoteConnection(Http, { Enabled: true, Url: "http://127.0.0.1:" + Port, Token: "fixture-in-memory", Cursor: 0, Server: "", CacheId: "r05-local" }, () => {}, () => {}, () => {});
	await write_state_file(Files, Path, Local);
	return { Directory, Http, Local, Operation, Result, ResultBlob, InputBlob, RequestBlob, Files, Path, LegacyPath, connection, store_value: (Value: unknown) => Store.store_value(Value),
		save: (State: any) => write_state_file(Files, Path, State), load: () => load_state_file(Files, Path, LegacyPath),
		fail_result: (Value: boolean) => { FailResult = Value; }, corrupt_result: (Value: boolean) => { CorruptResult = Value; },
		counts: () => ({ InferenceCalls, InferencePosts, ResultReads, StatusReads }),
		restart_bridge: async () => { await Bridge.close(); Bridge = new RemoteBridge(Config, Peer); Port = await Bridge.listen(); },
		close: async () => { await Bridge.close(); assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); }
	};
}
