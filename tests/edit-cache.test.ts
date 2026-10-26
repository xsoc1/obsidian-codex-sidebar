import { test } from "node:test";
import assert from "node:assert/strict";
import { EditStore } from "../src/edit/store";
import { ChatEdits } from "../src/edit/controller";
import { version_of } from "../src/edit/document";
import { pack_edits, unpack_edits } from "../src/edit/codec";
import type { ContextSnapshot } from "../src/prompt";
import { IDBFactory } from "fake-indexeddb";
import { open_edit_store } from "../src/edit/database";

async function fixture(Local = new Map<string, string>())
{
	const Storage = { getItem: (K: string) => Local.get(K) ?? null, setItem: (K: string, V: string) => { Local.set(K, V); } }, Store = new EditStore(Storage, "original");
	const Before = "# Original\n\n$x=1$\n", From = Before.indexOf("$"), Version = await version_of(Before);
	const Source: ContextSnapshot = { Path: "Original.md", Text: Before, SelectedText: "$x=1$", Mode: "编辑", Kind: "选区", Mapping: "源文本", CapturedAt: "original-time", LineStart: 2, LineEnd: 2, Heading: "Original", Truncated: false, Selection: { From, To: From + 5 }, Version };
	const Turns = new Map([["desktop:A", ["original-generation"]], ["desktop:B", [] as string[]], ["remote:A", [] as string[]]]);
	let Active = "desktop:A", Current = Before, Writes = 0;
	const Host = { read_current: async () => Current, compare_write: async (_Path: string, Expected: string | null, Next: string) => { assert.equal(Current, Expected); Current = Next; Writes++; }, protected_source: () => false, send: async () => true, changed: () => {}, cache_context: (Key = Active) => Turns.has(Key) ? { Key, Turns: [...Turns.get(Key)!] } : null };
	const Controller = new ChatEdits(Store, Host), Output = JSON.stringify({ schemaVersion: 1, kind: "note-edit", status: "proposal", markdown: "$x=2$", rationale: "Original local correction" });
	const Proposal = async () => { await Controller.request("Original correction", Source, "captured", "auto"); const Task = Store.Data.Records.at(-1)!.Spec; await Controller.accept_result(Task.Id, Output, true); return Task.Id; };
	const Tick = async (Id?: string) => { if(Id) { Turns.get(Active)!.push(Id); } Controller.Cache.poll(); await Controller.Cache.flush(); };
	return { Store, Storage, Local, Source, Host, Controller, Turns, Proposal, Tick, active: (Key: string) => { Active = Key; }, current: () => Current, writes: () => Writes };
}

test("default one-round cleanup excludes generation and other conversations, removes preview cache only", async () =>
{
	const F = await fixture(), Id = await F.Proposal(); assert.equal(F.Controller.Cache.Turns, 1);
	await F.Tick(); assert.equal(F.Store.Data.Records.length, 1);
	F.active("desktop:B"); await F.Tick("other-dialogue"); assert.equal(F.Store.Data.Records.length, 1);
	F.active("desktop:A"); await F.Tick("next-complete-dialogue");
	assert.equal(F.Store.Data.Records.length, 0); assert.equal(F.Store.Data.Writes.length, 0); assert.deepEqual(F.Store.Data.ExpiredIds, [Id]); assert.equal(F.writes(), 0);
	const Saved = F.Store.export_records(); await F.Tick(); assert.equal(F.Store.export_records(), Saved);
});

test("adoption and safe undo restart the configured retention period; duplicate completed turns do not count twice", async () =>
{
	const F = await fixture(); await F.Controller.Cache.set_turns(2); const Id = await F.Proposal(), Plan = F.Store.Data.Writes[0].Id;
	await F.Tick("followup-1"); assert.equal(F.Store.Data.Records[0].Cache!.Remaining, 1);
	await F.Controller.confirm(Plan); assert.match(F.current(), /x=2/); assert.equal(F.Store.Data.Records[0].Cache!.Remaining, 2);
	await F.Tick("followup-2"); await F.Tick("followup-2"); assert.equal(F.Store.Data.Records[0].Cache!.Remaining, 1);
	await F.Controller.undo(Plan); assert.match(F.current(), /x=1/); assert.equal(F.Store.Data.Records[0].Cache!.Remaining, 2);
	await F.Tick("followup-3"); assert.equal(F.Store.Data.Records.length, 1); await F.Tick("followup-4");
	assert.ok(F.Store.Data.ExpiredIds?.includes(Id)); assert.equal(F.writes(), 2);
});

test("never retains caches, changing back starts from known current history without retroactive expiry", async () =>
{
	const F = await fixture(); await F.Controller.Cache.set_turns(0); await F.Proposal();
	await F.Tick("first"); await F.Tick("second"); assert.equal(F.Store.Data.Records.length, 1);
	await F.Controller.Cache.set_turns(1); await F.Tick(); assert.equal(F.Store.Data.Records.length, 1);
	await F.Tick("third"); assert.equal(F.Store.Data.Records.length, 0);
	for(const Bad of [-1, 0.5, 1001, NaN]) { await assert.rejects(F.Controller.Cache.set_turns(Bad)); }
});

test("retention persists and compact storage round-trips while legacy records remain untouched", async () =>
{
	const F = await fixture(); const Legacy = await F.Proposal(); F.Store.change(D => { delete D.Records[0].Cache; });
	await F.Controller.Cache.set_turns(2); const Id = await F.Proposal(); await F.Tick("first");
	const Packed = await pack_edits(F.Store.Data), Restored = await unpack_edits(Packed.Data, Packed.Texts);
	assert.deepEqual(JSON.parse(JSON.stringify(Restored)), JSON.parse(F.Store.export_records()));
	const G = await fixture(F.Local); G.Turns.set("desktop:A", ["original-generation", "first"]); await G.Tick(); assert.equal(G.Store.Data.Records.length, 2);
	await G.Tick("second"); assert.ok(G.Store.Data.ExpiredIds?.includes(Id)); assert.equal(G.Store.Data.Records[0].Spec.Id, Legacy); assert.equal(G.Store.Data.Records[0].Cache, undefined);
});

test("conflicts, apply intents and undo recovery survive expiry and do not churn on idle refresh", async () =>
{
	for(const State of ["pending", "conflict", "undo-recovery"])
	{
		const F = await fixture(); await F.Proposal();
		F.Store.change(D => { D.Writes[0].State = State === "undo-recovery" ? "applied" : State as "pending" | "conflict"; if(State === "undo-recovery") { D.Writes[0].UndoPending = true; } });
		await F.Tick("next"); assert.equal(F.Store.Data.Records.length, 1); const Before = F.Store.export_records();
		await F.Tick(); await F.Tick(); assert.equal(F.Store.export_records(), Before); assert.equal(F.writes(), 0);
	}
});

test("scope isolation and pending tasks prevent wrong-device deletion", async () =>
{
	const F = await fixture(); const A = await F.Proposal(); F.active("remote:A"); const B = await F.Proposal();
	await F.Tick("remote-next"); assert.deepEqual(F.Store.Data.ExpiredIds, [B]); assert.equal(F.Store.Data.Records[0].Spec.Id, A);
	F.active("desktop:A"); await F.Controller.request("Original pending correction", F.Source, "captured", "auto"); const Pending = F.Store.Data.Records.at(-1)!.Spec.Id;
	await F.Tick("local-next"); assert.equal(F.Store.Data.Records.length, 1); assert.equal(F.Store.Data.Records[0].Spec.Id, Pending); assert.equal(F.Store.Data.Records[0].Status, "pending");
});

test("failed cleanup persistence retains cache and does not modify notes or retry continuously", async () =>
{
	const F = await fixture(); await F.Proposal(); let Saves = 0;
	const Persistence = { save: async () => { Saves++; throw new Error("Original storage failure"); }, close() {} };
	const Store = new EditStore(F.Storage, "original", F.Store.Data, Persistence), C = new ChatEdits(Store, F.Host), Before = Store.export_records();
	F.Turns.get("desktop:A")!.push("next"); C.Cache.poll(); await C.Cache.flush(); assert.equal(Store.export_records(), Before); assert.match(C.Cache.Error, /原记录保留/);
	C.Cache.poll(); await C.Cache.flush(); assert.equal(Saves, 1); assert.equal(F.writes(), 0);
});

test("post-write storage failure keeps the recovery intent and arms retention only with the completed write journal", async () =>
{
	const F = await fixture(); await F.Proposal(); let Calls = 0, Saved = structuredClone(F.Store.Data);
	const Store = new EditStore(F.Storage, "original", Saved, { save: async D => { if(++Calls === 2) { throw new Error("Original completion-commit failure"); } Saved = structuredClone(D); }, close() {} }), C = new ChatEdits(Store, F.Host), Id = Store.Data.Writes[0].Id;
	await assert.rejects(C.confirm(Id), /笔记已写入/); assert.equal(Store.Data.Writes[0].State, "pending"); assert.equal(F.writes(), 1);
	F.Turns.get("desktop:A")!.push("while-recovering"); C.Cache.poll(); await C.Cache.flush(); assert.equal(Store.Data.Writes.length, 1);
	await C.confirm(Id); assert.equal(F.writes(), 1); assert.equal(Store.Data.Writes[0].State, "applied"); assert.equal(Store.Data.Records[0].Cache!.Remaining, 1);
	C.Cache.poll(); await C.Cache.flush(); assert.equal(Store.Data.Writes.length, 1);
	F.Turns.get("desktop:A")!.push("after-recovery"); C.Cache.poll(); await C.Cache.flush(); assert.equal(Store.Data.Writes.length, 0);
});

test("IndexedDB cleanup releases unreferenced source blobs and preserves expiry markers on restart", async () =>
{
	const F = await fixture(), Factory = new IDBFactory(), Store = await open_edit_store(F.Storage, "original-cache-idb", Factory), C = new ChatEdits(Store, F.Host);
	await C.request("Original correction", F.Source, "captured", "auto"); const Id = Store.Data.Records[0].Spec.Id;
	await C.accept_result(Id, JSON.stringify({ schemaVersion: 1, kind: "note-edit", status: "proposal", markdown: "$x=2$", rationale: "Original correction" }), true);
	F.Turns.get("desktop:A")!.push("next"); C.Cache.poll(); await C.Cache.flush(); await Store.close();
	const Reopened = await open_edit_store(F.Storage, "original-cache-idb", Factory); assert.equal(Reopened.Data.Records.length, 0); assert.deepEqual(Reopened.Data.ExpiredIds, [Id]); await Reopened.close();
	const Database = await new Promise<IDBDatabase>(R => { const Request = Factory.open("codex-sidebar-edits-v3", 1); Request.onsuccess = () => R(Request.result); });
	const Count = await new Promise<number>(R => { const Request = Database.transaction("texts").objectStore("texts").index("scope").count("original-cache-idb"); Request.onsuccess = () => R(Request.result); });
	assert.equal(Count, 0); Database.close(); assert.equal(F.writes(), 0);
});

test("completed dialogues arriving during an asynchronous save are drained without waiting for another UI event", async () =>
{
	const F = await fixture(); await F.Controller.Cache.set_turns(2); await F.Proposal(); let Release!: () => void, Entered!: () => void;
	const Wait = new Promise<void>(R => Release = R), Started = new Promise<void>(R => Entered = R);
	const Store = new EditStore(F.Storage, "original", F.Store.Data, { save: async () => { Entered(); await Wait; }, close() {} }), C = new ChatEdits(Store, F.Host);
	F.Turns.get("desktop:A")!.push("first"); C.Cache.poll(); await Started;
	F.Turns.get("desktop:A")!.push("second"); C.Cache.poll(); Release();
	for(let I = 0; I < 6 && (C.Cache.Working || Store.Data.Records.length); I++) { await C.Cache.flush(); await new Promise(R => setImmediate(R)); }
	assert.equal(Store.Data.Records.length, 0); assert.equal(F.writes(), 0);
});
