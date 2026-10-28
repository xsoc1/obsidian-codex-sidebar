import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DeltaSyncClient } from "../src/sync/client";
import { SyncServerStore } from "../src/sync/server-store";
import { prepare_conflict_resolution, pending_conflicts, merge_conflict_resolutions, verify_conflict_resolutions } from "../src/sync/conflicts";
import { merge_sync_metadata } from "../src/sync/metadata";
import { restore_sessions } from "../src/sessions";
import { create_send_operation } from "../src/sync/operations";
import { BlobCache } from "../src/sync/blob-cache";
import { content_digest, entity_key } from "../src/sync/types";
import { load_state_file, write_state_file } from "../src/runtime/state-store";

function fixture()
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-round2-sync-")), Store = new SyncServerStore(Directory, "original-client");
	let Requests = 0, ReadBytes = 0;
	const Http = async (Path: string, Method: string, Body?: any) =>
	{
		Requests++; const Url = new URL(Path, "http://original.test"); let Value: any;
		if(Url.pathname === "/sync/catalog" || Url.pathname === "/sync/history") { Value = { ...Store.page(Url.pathname.endsWith("catalog") ? "catalog" : "history", Url.searchParams.has("revision") ? Number(Url.searchParams.get("revision")) : null, Number(Url.searchParams.get("offset") ?? 0), Url.searchParams.get("session") ?? undefined), cursor: 0 }; }
		else if(Url.pathname === "/sync/blob") { Value = Method === "GET" ? Store.blob_part(Url.searchParams.get("id")!, Number(Url.searchParams.get("index"))) : Store.put_part(Body); }
		else if(Url.pathname === "/sync/delta") { Value = Store.delta(Body); }
		else if(Url.pathname === "/operations") { Value = { operations: [], next: null, snapshot: "original-snapshot" }; }
		else { throw Error("unexpected " + Path); }
		ReadBytes += Buffer.byteLength(JSON.stringify(Value)); return structuredClone(Value);
	};
	return { Directory, Store, Http, metrics: () => ({ Requests, ReadBytes }), reset: () => { Requests = 0; ReadBytes = 0; }, close: () => { assert.ok(resolve(Directory).startsWith(resolve(tmpdir()) + sep)); rmSync(Directory, { recursive: true }); } };
}
function state(Count = 1)
{
	return { Settings: { Model: "original" }, ActiveId: "s0", Sessions: Array.from({ length: Count }, (_, I) => ({ Id: "s" + I, Title: "Original " + I, ThreadId: null, Messages: [{ Id: "a" + I, Role: "assistant" as const, Text: "原创正文".repeat(10000) + I }] })) };
}

test("round2 cold restore reads active history without downloading inactive bodies", async () =>
{
	const F = fixture();
	try
	{
		F.Store.legacy_write(state(16)); const C = new DeltaSyncClient(F.Http, F.Store.Scope), Local: ReturnType<typeof state> = { ...state(), Sessions: [] };
		const Result = await C.restore(Local); const Metrics = F.metrics();
		assert.equal(Result.State.Sessions.find(S => S.Id === "s0")!.Messages[0].Text, state().Sessions[0].Messages[0].Text);
		assert.equal(Result.State.Sessions.find(S => S.Id === "s15")!.Messages.length, 0, "inactive history must stay explicitly unloaded");
		assert.ok(Metrics.ReadBytes < 500000, "cold active restore must not download 16 large bodies");
	}
	finally { F.close(); }
});

test("round2 removing a pending conflict cannot resurrect it through client cache after a persisted decision", async () =>
{
	const F = fixture();
	try
	{
		F.Store.legacy_write(state()); const C = new DeltaSyncClient(F.Http, F.Store.Scope), Local: any = { ...state(), Sessions: [] };
		const S: any = (await C.restore(Local)).State;
		const Conflict = { Key: '["s0","a0"]', Reason: "original conflict", Local: { Id: "a0", Role: "assistant", Text: "original local" }, Remote: S.Sessions[0].Messages[0] };
		C.Conflicts.push(Conflict); S.Sync.Conflicts.push(Conflict); S.ResolvedConflicts = [{ ...structuredClone(Conflict), Choice: "remote" }]; S.Sync.Conflicts = [];
		await C.sync(S); assert.equal(S.Sync.Conflicts.length, 0, "durable old-style decisions must suppress the identical cached evidence");
	}
	finally { F.close(); }
});

for(const Choice of ["local", "remote"] as const)
{
	test(`round2 ${Choice} conflict decision survives sync, stale metadata, reconnect and restart`, async () =>
	{
		const F = fixture();
		try
		{
			const Original = state(); Original.Sessions[0].Messages[0].Text = "Original remote proof"; F.Store.legacy_write(Original);
			const C = new DeltaSyncClient(F.Http, F.Store.Scope); let S: any = (await C.restore({ ...Original, Sessions: [] })).State;
			S.Sessions[0].Messages[0].Text = "Original local proof";
			S = (await C.restore(S)).State; assert.equal(S.Sync.Conflicts.length, 1);
			const Before = structuredClone(S), Conflict = S.Sync.Conflicts[0], Resolution = await prepare_conflict_resolution(F.Store.Scope, Conflict, Choice);
			S.Sync.Resolutions = [Resolution]; S.Sessions[0].Messages[0] = structuredClone(Choice === "local" ? Conflict.Local : Conflict.Remote); S.Sync.Conflicts = pending_conflicts(S.Sync.Conflicts, S.Sync.Resolutions);
			S = JSON.parse(JSON.stringify(S)); await C.sync(S); assert.equal(S.Sync.Conflicts.length, 0);
			S.Sync = merge_sync_metadata(S.Sync, Before.Sync); assert.equal(S.Sync.Conflicts.length, 0);
			S = (await C.restore(S)).State; assert.equal(S.Sync.Conflicts.length, 0); assert.equal(S.Sessions[0].Messages[0].Text, `Original ${Choice} proof`);
			const D = new DeltaSyncClient(F.Http, F.Store.Scope); S = (await D.restore(JSON.parse(JSON.stringify(S)))).State;
			assert.equal(S.Sync.Conflicts.length, 0); assert.equal(S.Sessions[0].Messages[0].Text, `Original ${Choice} proof`);
			const EmptyPeer: any = (await new DeltaSyncClient(F.Http, F.Store.Scope).restore({ ...Original, Sessions: [] })).State;
			assert.equal(EmptyPeer.Sessions[0].Messages[0].Text, `Original ${Choice} proof`);
			assert.equal(F.Store.materialize().Sessions[0].Messages[0].Text, "Original remote proof", "local choice is a retained view, not a server answer rewrite");
			assert.equal(JSON.parse(JSON.stringify(S.Sync.Resolutions))[0].Conflict.Local.Text, "Original local proof");
			F.Store.observe_message("s0", { Id: "a0", Role: "assistant", Text: "Original new remote version" });
			const Newer: any = (await D.restore(S)).State;
			assert.equal(Newer.Sync.Conflicts.length, 1, "a new conflicting remote version requires a new decision");
		}
		finally { F.close(); }
	});
}

test("round2 different decisions remain evidence and failed save does not publish a resolution", async () =>
{
	const F = fixture();
	try
	{
		const Original = state(); Original.Sessions[0].Messages[0].Text = "Original remote"; F.Store.legacy_write(Original);
		const C = new DeltaSyncClient(F.Http, F.Store.Scope); let S: any = (await C.restore({ ...Original, Sessions: [] })).State;
		S.Sessions[0].Messages[0].Text = "Original local"; S = (await C.restore(S)).State;
		const Conflict = S.Sync.Conflicts[0], Local = await prepare_conflict_resolution(F.Store.Scope, Conflict, "local"), Remote = await prepare_conflict_resolution(F.Store.Scope, Conflict, "remote");
		const Draft = structuredClone(S); Draft.Sync.Resolutions = [Local]; Draft.Sync.Conflicts = pending_conflicts(Draft.Sync.Conflicts, Draft.Sync.Resolutions);
		const Data = new Map<string, string>(); let Fail = false;
		const Files = { exists: async (P: string) => Data.has(P), read: async (P: string) => Data.get(P)!, write: async (P: string, T: string) => { if(Fail && P.endsWith(".save.stage.json")) { throw Error("original disk full"); } Data.set(P, T); } };
		await write_state_file(Files, "original.json", S); Fail = true; await assert.rejects(write_state_file(Files, "original.json", Draft), /disk full/);
		const Reopened = await load_state_file(Files, "original.json", "legacy.json"); assert.equal(Reopened.Sync.Resolutions.length, 0); assert.equal(Reopened.Sync.Conflicts.length, 1);
		assert.equal((await C.restore(Reopened)).State.Sync!.Conflicts.length, 1); assert.equal(S.Sync.Resolutions.length, 0);
		const Both = merge_conflict_resolutions(F.Store.Scope, [Local], [Remote]); assert.equal(Both.length, 2); assert.equal(pending_conflicts([], Both).length, 1);
		assert.throws(() => merge_conflict_resolutions("another-scope", [Local]), /作用域/);
	}
	finally { F.close(); }
});

test("round2 partial history survives sync, lazy hydrate, message deletion and complete export", async () =>
{
	const F = fixture();
	try
	{
		const Original = state(8); F.Store.legacy_write(Original); const C = new DeltaSyncClient(F.Http, F.Store.Scope);
		let S: any = (await C.restore({ ...Original, Sessions: [] })).State; assert.equal(S.Sync.History.s7.Status, "unloaded");
		S.Sessions[0].Messages.push({ Id: "new-local", Role: "user", Text: "Original unsent", Prompt: "Original exact prompt", Context: { Text: "$x=1$" } });
		await C.sync(S); assert.equal(F.Store.materialize().Sessions.find((X: any) => X.Id === "s7").Messages[0].Text, Original.Sessions[7].Messages[0].Text);
		S = await C.hydrate_session(S, "s7"); assert.equal(S.Sync.History.s7.Status, "loaded"); assert.equal(S.Sessions.find((X: any) => X.Id === "s7").Messages[0].Text, Original.Sessions[7].Messages[0].Text);
		assert.equal(S.Sessions[0].Messages.at(-1).Prompt, "Original exact prompt");
		S.DeletedMessages = [{ SessionId: "s3", MessageId: "a3" }]; await C.sync(S);
		const Complete: any = await new DeltaSyncClient(F.Http, F.Store.Scope).hydrate_all(JSON.parse(JSON.stringify(S)));
		assert.equal(Complete.Sessions.reduce((N: number, X: any) => N + X.Messages.length, 0), 8);
		assert.equal(Complete.Sessions.find((X: any) => X.Id === "s3").Messages.length, 0);
		assert.ok(Complete.Sessions.every((X: any) => Complete.Sync.History[X.Id].Status === "loaded"));
		await assert.rejects(C.hydrate_session({ ...Complete, Sync: { ...Complete.Sync, Scope: "other" } }, "s1"), /作用域/);
	}
	finally { F.close(); }
});

test("round2 verified blob LRU stays byte-bounded without evicting records or changing values", () =>
{
	const C = new BlobCache(100); C.put("a", { Text: "original-a" }, 40); C.put("b", { Text: "original-b" }, 40); assert.deepEqual(C.get("a"), { Text: "original-a" });
	C.put("c", { Text: "original-c" }, 40); assert.equal(C.get("b"), undefined); assert.deepEqual(C.get("a"), { Text: "original-a" });
	C.put("huge", { Text: "original-large" }, 101); assert.equal(C.get("huge"), undefined); assert.equal(C.stats().PeakUtf8Bytes, 80);
});

test("round2 delta rejection and restore agree on exact versioned conflict identity", async () =>
{
	const F = fixture();
	try
	{
		const Original: any = state(); Original.Sessions[0].Messages = [{ Id: "q", Role: "user", Text: "Original request", Prompt: "Original immutable prompt" }]; F.Store.legacy_write(Original);
		const C = new DeltaSyncClient(F.Http, F.Store.Scope); let S: any = (await C.restore({ ...Original, Sessions: [] })).State;
		S.Sessions[0].Messages[0].Prompt = "Original local modified input"; await assert.rejects(C.sync(S), /冲突/); assert.equal(S.Sync.Conflicts.length, 1);
		const C1 = S.Sync.Conflicts[0]; S = (await C.restore(S)).State; assert.equal(S.Sync.Conflicts.length, 1);
		const R = await prepare_conflict_resolution(F.Store.Scope, C1, "local"); S.Sync.Resolutions = [R]; S.Sync.Conflicts = pending_conflicts(S.Sync.Conflicts, [R]); await C.sync(S);
		S = (await new DeltaSyncClient(F.Http, F.Store.Scope).restore(JSON.parse(JSON.stringify(S)))).State; assert.equal(S.Sync.Conflicts.length, 0); assert.equal(S.Sessions[0].Messages[0].Prompt, "Original local modified input");
		assert.equal(F.Store.materialize().Sessions[0].Messages[0].Prompt, "Original immutable prompt");
		await assert.rejects(verify_conflict_resolutions(F.Store.Scope, [{ ...R, ConflictId: "f".repeat(64) }]), /摘要/);
		await assert.rejects(C.restore({ ...S, Sync: { ...S.Sync, Resolutions: [{ ...R, ConflictId: "f".repeat(64) }] } }), /摘要/);
	}
	finally { F.close(); }
});

test("round2 completed operation bodies are lazy while unknown receipts remain fully recoverable", async () =>
{
	const F = fixture();
	try
	{
		F.Store.legacy_write(state());
		const Operations = await Promise.all(["completed", "submission-unknown"].map(async (Status, I) =>
		{
			const O = await create_send_operation(F.Store.Scope, "s0", "q" + I, { Prompt: "Original evidence " + I + "x".repeat(80000) }, "operation-" + I); O.Status = Status as any; O.Attempted = true; O.Request = { input: O.Input }; O.RequestDigest = await content_digest(O.Request); return O;
		}));
		const Metas = Operations.map(O => { const { Input, Request, ...Meta } = O; return { ...Meta, InputBlob: F.Store.store_value(Input), RequestBlob: F.Store.store_value(Request) }; });
		let BodyReads = 0; const Http = async (P: string, M: string, B?: unknown) =>
		{
			if(P.startsWith("/operations")) { const U = new URL(P, "http://original.test"); return U.searchParams.has("id") ? { operation: Metas.find(O => O.Id === U.searchParams.get("id")) } : { operations: Metas, next: null, snapshot: "operation-snapshot" }; }
			if(M === "GET" && P.startsWith("/sync/blob?id=" + Metas[0].InputBlob)) { BodyReads++; } return F.Http(P, M, B);
		};
		const C = new DeltaSyncClient(Http, F.Store.Scope); const S: any = (await C.restore({ ...state(), Sessions: [] })).State;
		assert.equal(BodyReads, 0); assert.equal(S.Sync.Operations[0].Evidence.State, "metadata"); assert.equal(S.Sync.Operations[1].Input.Prompt, (Operations[1].Input as any).Prompt);
		const Full = await C.operation_status(Operations[0].Id); assert.equal((Full!.Input as any).Prompt, (Operations[0].Input as any).Prompt); assert.equal(Full!.Evidence, undefined); assert.ok(BodyReads > 0);
		const Complete: any = await C.hydrate_all(S); assert.ok(Complete.Sync.Operations.every((O: any) => !O.Evidence && O.Input));
	}
	finally { F.close(); }
});

test("round2 GC dry-run protects snapshot, backup, external evidence and fails closed on unknown roots", () =>
{
	const F = fixture();
	try
	{
		F.Store.legacy_write(state()); const Snapshot = F.Store.page("catalog", null, 0), Old = F.Store.page("history", Snapshot.revision, 0, "s0").rows[0].Blob;
		F.Store.observe_message("s0", { Id: "a0", Role: "assistant", Text: "Original final" });
		const External = F.Store.store_value({ Text: "Original retained event" }), Orphan = F.Store.store_value({ Text: "Original unreferenced fixture" });
		const Before = readdirSync(join(F.Directory, "original-client-blobs")).sort();
		const Unproved = F.Store.storage_report(); assert.equal(Unproved.CompleteRoots, false); assert.deepEqual(Unproved.Candidates, []);
		const Report = F.Store.storage_report({ SchemaVersion: 1, Complete: true, Revision: F.Store.Data.Revision, Blobs: [External] });
		assert.equal(Report.CompleteRoots, true); assert.equal(Report.AutomaticGc, false); assert.ok(Report.Candidates.some((V: any) => V.Id === Orphan)); assert.ok(!Report.Candidates.some((V: any) => [Old, External].includes(V.Id)));
		assert.deepEqual(readdirSync(join(F.Directory, "original-client-blobs")).sort(), Before, "dry-run writes or deletes nothing");
		const Journal = join(F.Directory, "original-client-sync-v2.json.last-committed"), Raw = readFileSync(Journal, "utf8"); writeFileSync(Journal, JSON.stringify({ SchemaVersion: 999 }));
		const Unknown = F.Store.storage_report({ SchemaVersion: 1, Complete: true, Revision: F.Store.Data.Revision, Blobs: [] }); assert.equal(Unknown.CompleteRoots, false); assert.deepEqual(Unknown.Candidates, []); writeFileSync(Journal, Raw);
		writeFileSync(join(F.Directory, "original-client-blobs", Orphan + ".json"), "broken"); assert.equal(F.Store.storage_report({ SchemaVersion: 1, Complete: true, Revision: F.Store.Data.Revision, Blobs: [] }).CompleteRoots, false);
	}
	finally { F.close(); }
});

test("round2 a failed or expired lazy read retains the incomplete state and newer local deletions win", async () =>
{
	const F = fixture();
	try
	{
		F.Store.legacy_write(state(4)); let Fail = false;
		const C = new DeltaSyncClient(async (P, M, B) => { if(Fail && P.startsWith("/sync/history?session=s3")) { throw Error("original read failed"); } return F.Http(P, M, B); }, F.Store.Scope);
		let S: any = (await C.restore({ ...state(), Sessions: [] })).State;
		Fail = true; await assert.rejects(C.hydrate_session(S, "s3"), /read failed/); assert.equal(S.Sync.History.s3.Status, "unloaded"); assert.equal(S.Sessions.find((X: any) => X.Id === "s3").Messages.length, 0); Fail = false;
		for(let I = 0; I < 9; I++) { F.Store.observe_message("s0", { Id: "new" + I, Role: "assistant", Text: "Original newer " + I }); F.Store.page("catalog", null, 0); }
		S = await C.hydrate_session(S, "s3"); assert.equal(S.Sync.History.s3.Status, "loaded");
		const Stale = structuredClone(S); S.DeletedSessionIds = ["s3"]; S.Sessions = S.Sessions.filter((X: any) => X.Id !== "s3"); await C.sync(S);
		const Deleted: any = (await C.restore(Stale)).State; assert.equal(Deleted.Sync.History.s3.Status, "deleted"); assert.ok(!Deleted.Sessions.some((X: any) => X.Id === "s3"));
		await assert.rejects(C.hydrate_session(Deleted, "s3"), /删除/); assert.ok(C.cache_stats().PeakConcurrentReads <= 3);
	}
	finally { F.close(); }
});

test("round2 two clients retain opposing decisions without timestamp overwrite or inference", async () =>
{
	const F = fixture();
	try
	{
		const Original = state(); Original.Sessions[0].Messages[0].Text = "Original remote"; F.Store.legacy_write(Original);
		const A = new DeltaSyncClient(F.Http, F.Store.Scope), B = new DeltaSyncClient(F.Http, F.Store.Scope);
		let SA: any = (await A.restore({ ...Original, Sessions: [] })).State; SA.Sessions[0].Messages[0].Text = "Original local"; SA = (await A.restore(SA)).State;
		let SB: any = (await B.restore(structuredClone(SA))).State; const C = SA.Sync.Conflicts[0];
		for(const [S, Choice] of [[SA, "local"], [SB, "remote"]] as const) { S.Sync.Resolutions = [await prepare_conflict_resolution(F.Store.Scope, C, Choice)]; S.Sync.Conflicts = pending_conflicts(S.Sync.Conflicts, S.Sync.Resolutions); S.Sessions[0].Messages[0] = structuredClone(Choice === "local" ? C.Local : C.Remote); }
		await A.sync(SA); await assert.rejects(B.sync(SB), /冲突/);
		SB = (await B.restore(SB)).State; assert.equal(SB.Sync.Resolutions.length, 2); assert.ok(SB.Sync.Conflicts.some((X: any) => /不同决议/.test(X.Reason)));
		await B.sync(SB); SA = (await A.restore(SA)).State; assert.equal(SA.Sync.Resolutions.length, 2); assert.ok(SA.Sync.Conflicts.some((X: any) => /不同决议/.test(X.Reason)));
		assert.equal(F.Store.materialize().Sessions[0].Messages[0].Text, "Original remote");
		const Root = F.Store.Data.Rows.find(R => R.Kind === "root")!;
		const MissingDecisions = F.Store.store_value({ ActiveId: "s0" });
		F.Store.delta({ scope: F.Store.Scope, id: "original-older-client-root", baseRevision: F.Store.Data.Revision, mutations: [{ Kind: "root", Key: entity_key("root"), Blob: MissingDecisions, Expected: Root.Revision }] });
		assert.equal(F.Store.materialize().ConflictResolutions.length, 2, "an older client cannot erase accepted decisions by omitting the new field");
	}
	finally { F.close(); }
});

test("round2 optional inline catalog validates digest and falls back to old blob catalogs", async () =>
{
	const F = fixture();
	try
	{
		F.Store.legacy_write(state(4)); let Tamper = false;
		const C = new DeltaSyncClient(async (P, M, B) =>
		{
			const V = await F.Http(P, M, B); if(P.startsWith("/sync/catalog")) { for(const R of V.rows) { if(R.Inline !== undefined) { if(Tamper) { R.Inline.Title = "Original corrupt metadata"; } else { delete R.Inline; } } } } return V;
		}, F.Store.Scope);
		assert.equal((await C.restore({ ...state(), Sessions: [] })).State.Sessions.length, 4);
		Tamper = true; await assert.rejects(C.restore({ ...state(), Sessions: [] }), /目录摘要/);
	}
	finally { F.close(); }
});

test("round2 failed server journal write never advertises an uncommitted message or operation revision", async () =>
{
	const F = fixture();
	try
	{
		F.Store.legacy_write(state()); const Before = structuredClone(F.Store.Data), Save = (F.Store as any).save;
		(F.Store as any).save = () => { throw Error("original journal failure"); };
		assert.throws(() => F.Store.observe_message("s0", { Id: "a0", Role: "assistant", Text: "Original new checkpoint" }), /journal failure/);
		assert.deepEqual(F.Store.Data, Before); assert.equal(F.Store.materialize().Sessions[0].Messages[0].Text, state().Sessions[0].Messages[0].Text);
		const O = await create_send_operation(F.Store.Scope, "s0", "q", { Prompt: "Original input" });
		assert.throws(() => F.Store.put_operation(O), /journal failure/); assert.deepEqual(F.Store.Data, Before); assert.equal(F.Store.operation(O.Id), null);
		(F.Store as any).save = Save; F.Store.observe_message("s0", { Id: "a0", Role: "assistant", Text: "Original new checkpoint" });
		assert.equal(F.Store.materialize().Sessions[0].Messages[0].Text, "Original new checkpoint"); F.Store.put_operation(O);
		const Saved = structuredClone(F.Store.Data); (F.Store as any).save = () => { throw Error("original journal failure"); };
		assert.throws(() => F.Store.put_operation({ ...O, Status: "submission-unknown", Attempted: true }), /journal failure/); assert.deepEqual(F.Store.Data, Saved);
		(F.Store as any).save = Save;
	}
	finally { F.close(); }
});
