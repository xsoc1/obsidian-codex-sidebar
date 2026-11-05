import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply_conflict_resolution, assert_resolution_fresh, effective_conflict_resolutions, merge_conflict_resolutions, pending_conflicts, prepare_conflict_resolution, preserve_durable_resolved_messages, require_conflict_finalization, resolution_set_signature, verify_conflict_resolutions } from "../src/sync/conflicts";
import { canonical_json, SyncCapabilities, type SyncConflict } from "../src/sync/types";
import { SyncServerStore } from "../src/sync/server-store";
import { DeltaSyncClient } from "../src/sync/client";
import { load_state_file, write_state_file } from "../src/runtime/state-store";

const Conflict: SyncConflict = { Key: '["s","a"]', Reason: "Original competing arguments", Local: { Id: "a", Role: "assistant", Text: "Original local $x=1$" }, Remote: { Id: "a", Role: "assistant", Text: "Original remote $x=2$" } };
function state(Scope: string)
{
	return { Settings: {}, ActiveId: "s", Sessions: [{ Id: "s", Title: "Original", ThreadId: null, Messages: [structuredClone(Conflict.Local) as any] }], Sync: { SchemaVersion: 1 as const, Scope, Revision: 0, Versions: {}, Operations: [], Conflicts: [Conflict], Resolutions: [] as Awaited<ReturnType<typeof prepare_conflict_resolution>>[] } };
}
async function decisions(Scope = "scope", C = Conflict)
{
	const A = await prepare_conflict_resolution(Scope, C, "local"), B = await prepare_conflict_resolution(Scope, C, "remote");
	const Final = await prepare_conflict_resolution(Scope, C, "remote", [A, B]); return { A, B, Final };
}
function fixture()
{
	const Root = mkdtempSync(join(tmpdir(), "codex-owned-causal-")); let Store = new SyncServerStore(Root, "original-client"), InfoEnabled = true, Writes = 0;
	const Http = async (Path: string, Method: string, Body?: any) =>
	{
		const Url = new URL(Path, "http://original.test"); if(Method === "POST") { Writes++; }
		if(Url.pathname === "/info") { return { dataIdentity: Store.Data.Identity, client: Store.Data.Client, capabilities: InfoEnabled ? SyncCapabilities : { incrementalSync: 1 } }; }
		if(Url.pathname === "/sync/blob") { return Method === "GET" ? Store.blob_part_async(Url.searchParams.get("id")!, Number(Url.searchParams.get("index"))) : Store.put_part(Body); }
		if(Url.pathname === "/sync/delta") { return Store.delta(Body); }
		if(Url.pathname === "/operations") { return { operations: [], next: null, snapshot: "original-operations" }; }
		if(Url.pathname === "/sync/catalog" || Url.pathname === "/sync/history") { return { ...Store.page(Url.pathname.endsWith("catalog") ? "catalog" : "history", Url.searchParams.has("revision") ? Number(Url.searchParams.get("revision")) : null, Number(Url.searchParams.get("offset") ?? 0), Url.searchParams.get("session") ?? undefined), cursor: 0 }; }
		throw Error("unexpected fixture path");
	};
	return { Root, Http, get Store() { return Store; }, get Writes() { return Writes; }, disableCapability() { InfoEnabled = false; }, async restart() { await Store.close(); Store = new SyncServerStore(Root, "original-client"); }, async close() { await Store.close(); rmSync(Root, { recursive: true, force: true }); } };
}

test("T07 exact causal heads converge independent of order; an uncovered concurrent decision reopens conflict", async () =>
{
	const { A, B, Final } = await decisions(); assert.deepEqual(Final.Supersedes, [A.Id, B.Id].sort());
	for(const Values of [[A, B, Final], [Final, B, A], [B, Final, A]])
	{
		await verify_conflict_resolutions("scope", Values); assert.deepEqual(effective_conflict_resolutions(Values).map(R => R.Id), [Final.Id]); assert.equal(pending_conflicts([], Values).length, 0);
	}
	const New = await prepare_conflict_resolution("scope", Conflict, "local"); assert.equal(pending_conflicts([], [A, B, Final, New]).length, 1);
	const Again = await prepare_conflict_resolution("scope", Conflict, "local", [A, B, Final, New]); assert.deepEqual(Again.Supersedes, [Final.Id, New.Id].sort()); assert.equal(pending_conflicts([], [A, B, Final, New, Again]).length, 0);
	assert.equal(A.SchemaVersion, 1); assert.equal(A.Supersedes, undefined);
});

test("T07 duplicate ID disagreement, missing/wrong parent, cycles, foreign scopes and forged digest all reject", async () =>
{
	const { A, B, Final } = await decisions();
	assert.equal(merge_conflict_resolutions("scope", [A, A]).length, 1);
	for(const Values of [[A, { ...A, Choice: "remote" as const }], [A, B, { ...Final, Supersedes: ["missing"] }], [A, B, { ...Final, Supersedes: [Final.Id] }], [A, B, { ...Final, Id: "cycle-a", Supersedes: ["cycle-b"] }, { ...Final, Id: "cycle-b", Supersedes: ["cycle-a"] }], [A, { ...B, Scope: "foreign" }], [{ ...A, Supersedes: [] }]])
	{
		assert.throws(() => merge_conflict_resolutions("scope", Values)); assert.throws(() => pending_conflicts([Conflict], Values));
	}
	const Other = await prepare_conflict_resolution("scope", { ...Conflict, Local: { ...(Conflict.Local as any), Text: "Other version" } }, "local");
	assert.throws(() => merge_conflict_resolutions("scope", [A, B, Other, { ...Final, Supersedes: [Other.Id] }]), /父|证据/);
	await assert.rejects(verify_conflict_resolutions("scope", [A, { ...B, ConflictId: "f".repeat(64) }]), /摘要/);
});

test("T07 confirmation stamp and save-time application reject new decisions, new bodies and tombstones", async () =>
{
	const { A, B, Final } = await decisions(), S = state("scope"); S.Sync.Resolutions = [A, B];
	const Signature = resolution_set_signature("scope", Conflict, [A, B]), Stamp = canonical_json(S.Sessions[0].Messages[0]);
	assert.equal(resolution_set_signature("scope", Conflict, [B, A]), Signature);
	const Next = apply_conflict_resolution(S, Final, Signature, Stamp); assert.equal(Next.Sync.Conflicts.length, 0); assert.equal(Next.Sessions[0].Messages[0].Text, (Conflict.Remote as any).Text); assert.equal(S.Sync.Resolutions.length, 2);
	const New = await prepare_conflict_resolution("scope", Conflict, "local"); S.Sync.Resolutions.push(New);
	assert.throws(() => assert_resolution_fresh("scope", Conflict, S.Sync.Resolutions, Signature), /变化/);
	assert.throws(() => apply_conflict_resolution(S, Final, resolution_set_signature("scope", Conflict, S.Sync.Resolutions), Stamp), /覆盖/);
	S.Sync.Resolutions = [A, B]; S.Sessions[0].Messages[0].Text = "New original body"; assert.throws(() => apply_conflict_resolution(S, Final, Signature, Stamp), /消息/);
	const Deleted = { ...state("scope"), DeletedMessages: [{ SessionId: "s", MessageId: "a" }] }; Deleted.Sync.Resolutions = [A, B]; assert.throws(() => apply_conflict_resolution(Deleted, Final, Signature, Stamp), /删除/);
});

test("T07 chosen body, final decision and conflict state commit together; stale queues preserve it", async () =>
{
	const { A, B, Final } = await decisions(), S = state("scope"); S.Sync.Resolutions = [A, B];
	const Next = apply_conflict_resolution(S, Final, resolution_set_signature("scope", Conflict, [A, B]), canonical_json(S.Sessions[0].Messages[0]));
	const Data = new Map<string, string>(); let Fail = false;
	const Files = { exists: async (P: string) => Data.has(P), read: async (P: string) => Data.get(P)!, write: async (P: string, T: string) => { if(Fail && P.endsWith("stage.json")) { throw Error("original staging failure"); } Data.set(P, T); } };
	await write_state_file(Files, "original.json", S); Fail = true; await assert.rejects(write_state_file(Files, "original.json", Next), /failure/);
	const Before = await load_state_file(Files, "original.json", "legacy.json"); assert.equal(Before.Sync.Resolutions.length, 2); assert.equal(Before.Sync.Conflicts.length, 1); assert.equal(Before.Sessions[0].Messages[0].Text, (Conflict.Local as any).Text);
	Fail = false; await write_state_file(Files, "original.json", Next); const Durable = await load_state_file(Files, "original.json", "legacy.json");
	assert.deepEqual(Durable.Sync.Resolutions, Next.Sync.Resolutions); assert.equal(Durable.Sync.Conflicts.length, 0); assert.equal(Durable.Sessions[0].Messages[0].Text, (Conflict.Remote as any).Text);
	const Queued = structuredClone(S); preserve_durable_resolved_messages(Queued, Durable); assert.equal(Queued.Sessions[0].Messages[0].Text, (Conflict.Remote as any).Text);
});

for(const Choice of ["local", "remote"] as const)
{
	test(`T07 ${Choice} final survives actual store sync/restart without rewriting server input; new decision reopens`, async () =>
	{
		const F = fixture();
		try
		{
			const Initial = state(F.Store.Scope); Initial.Sync.Conflicts = []; Initial.Sessions[0].Messages = [structuredClone(Conflict.Remote)]; F.Store.legacy_write(Initial);
			const Client = new DeltaSyncClient(F.Http, F.Store.Scope); let S: ReturnType<typeof state> = (await Client.restore({ ...Initial, Sessions: [] })).State;
			S.Sessions[0].Messages[0].Text = (Conflict.Local as any).Text; S = (await Client.restore(S)).State; const C = S.Sync.Conflicts[0];
			const { A, B } = await decisions(F.Store.Scope, C); S.Sync.Resolutions = [A, B]; await Client.sync(S); S = (await Client.restore(S)).State; assert.equal(S.Sync.Conflicts.length, 1);
			const R = await prepare_conflict_resolution(F.Store.Scope, C, Choice, S.Sync.Resolutions); S = apply_conflict_resolution(S, R, resolution_set_signature(F.Store.Scope, C, S.Sync.Resolutions), canonical_json(S.Sessions[0].Messages[0]));
			await Client.sync(S); await F.restart();
			const Fresh = new DeltaSyncClient(F.Http, F.Store.Scope); S = (await Fresh.restore(JSON.parse(JSON.stringify(S)))).State;
			assert.equal(S.Sync.Conflicts.length, 0); assert.equal(S.Sessions[0].Messages[0].Text, (Choice === "local" ? C.Local : C.Remote as any).Text); assert.equal(S.Sync.Resolutions.length, 3);
			assert.equal(F.Store.materialize().Sessions[0].Messages[0].Text, (Conflict.Remote as any).Text);
			const New = await prepare_conflict_resolution(F.Store.Scope, C, Choice === "local" ? "remote" : "local"); S.Sync.Resolutions.push(New); await Fresh.sync(S);
			assert.equal((await Fresh.restore(S)).State.Sync.Conflicts.length, 1); assert.equal(F.Store.materialize().ConflictResolutions.length, 4);
		}
		finally { await F.close(); }
	});
}

test("T07 old bridge refuses causal write before any POST; server journal failure publishes no final", async () =>
{
	const F = fixture();
	try
	{
		const S = state(F.Store.Scope), { A, B, Final } = await decisions(F.Store.Scope); S.Sync.Resolutions = [A, B, Final];
		F.Store.legacy_write(state(F.Store.Scope)); F.disableCapability(); const Client = new DeltaSyncClient(F.Http, F.Store.Scope);
		await assert.rejects(Client.sync(S), /conflictFinalization/); assert.equal(F.Writes, 0); assert.throws(() => require_conflict_finalization({ incrementalSync: 1 }), /conflictFinalization/);
	}
	finally { await F.close(); }
	const G = fixture();
	try
	{
		G.Store.legacy_write(state(G.Store.Scope)); const Client = new DeltaSyncClient(G.Http, G.Store.Scope); let S = (await Client.restore({ ...state(G.Store.Scope), Sessions: [] })).State;
		const { A, B, Final } = await decisions(G.Store.Scope); S.Sync.Resolutions = [A, B, Final]; const Before = readFileSync(join(G.Root, "original-client-sync-v2.json"), "utf8");
		(G.Store as any).save = () => { throw Error("original journal failure"); }; await assert.rejects(Client.sync(S), /journal failure/);
		assert.equal(readFileSync(join(G.Root, "original-client-sync-v2.json"), "utf8"), Before); assert.equal(G.Store.materialize().ConflictResolutions, undefined);
		await G.restart(); assert.equal(G.Store.materialize().ConflictResolutions, undefined);
	}
	finally { await G.close(); }
});
