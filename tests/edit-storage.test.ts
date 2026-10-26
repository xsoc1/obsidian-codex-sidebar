import { test } from "node:test";
import assert from "node:assert/strict";
import { EditStore } from "../src/edit/store";
import { ChatEdits } from "../src/edit/controller";
import { version_of } from "../src/edit/document";
import type { ContextSnapshot } from "../src/prompt";
import { IDBFactory, IDBDatabase } from "fake-indexeddb";
import { open_edit_store } from "../src/edit/database";
import { pack_edits, unpack_edits } from "../src/edit/codec";

export async function storage_fixture(Size = 120000)
{
	const Before = "# Original\n" + "original text.\n".repeat(Math.ceil(Size / 15)) + "\n$x=1$\n", Old = "$x=1$";
	const From = Before.indexOf(Old), Version = await version_of(Before);
	const Source: ContextSnapshot = { Path: "Original.md", Mode: "编辑", Kind: "选区", Mapping: "源文本", Text: Old, SelectedText: Old, Selection: { From, To: From + Old.length }, LineStart: 0, LineEnd: 0, Heading: "Original", CapturedAt: "original-time", Truncated: false, Version };
	const Values = new Map<string, string>(), Store = new EditStore({ getItem: Key => Values.get(Key) ?? null, setItem: (Key, Value) => Values.set(Key, Value) }, "original");
	const Host = { read_current: async () => Before, compare_write: async () => { throw new Error("No file writes in storage fixture"); }, protected_source: () => false, send: async () => true, changed: () => {} };
	return { Before, Source, Values, Store, Host, Controller: new ChatEdits(Store, Host), Output: JSON.stringify({ schemaVersion: 1, kind: "note-edit", status: "proposal", markdown: "$x=2$", rationale: "Original fixture" }) };
}

test("complete edit proposals survive the former two-million-character boundary without removing history", async () =>
{
	const F = await storage_fixture();
	for(let Index = 0; Index < 8; Index++)
	{
		await F.Controller.request("Original correction", F.Source, "captured", "auto");
		await F.Controller.accept_result(F.Store.Data.Records.at(-1)!.Spec.Id, F.Output, true);
	}
	assert.ok(JSON.stringify(F.Store.Data).length > 2000000);
	assert.equal(F.Store.Data.Records.length, 8); assert.equal(F.Store.Data.Writes.length, 8);
	const Reopened = new EditStore({ getItem: Key => F.Values.get(Key) ?? null, setItem: () => { throw new Error("Read only"); } }, "original");
	assert.deepEqual(Reopened.Data, F.Store.Data);
});

test("more than fifty edit records are retained rather than silently evicted", async () =>
{
	const F = await storage_fixture(10);
	for(let Index = 0; Index < 52; Index++) { await F.Controller.request("Original correction", F.Source, "captured", "auto"); }
	assert.equal(F.Store.Data.Records.length, 52);
});

test("compact snapshots round-trip formulas, exact targets, errors and every write state without repeated full files", async () =>
{
	const F = await storage_fixture();
	for(let Index = 0; Index < 6; Index++)
	{
		await F.Controller.request("Original correction", F.Source, "captured", "auto");
		await F.Controller.accept_result(F.Store.Data.Records.at(-1)!.Spec.Id, F.Output, true);
	}
	F.Store.change(Data => Data.Writes.forEach((Plan, Index) => { Plan.State = ["preview", "pending", "applied", "undone", "conflict", "preview"][Index] as typeof Plan.State; }));
	const Packed = await pack_edits(F.Store.Data), Expanded = await unpack_edits(Packed.Data, Packed.Texts);
	assert.deepEqual(JSON.parse(JSON.stringify(Expanded)), JSON.parse(F.Store.export_records()));
	const CompactChars = JSON.stringify(Packed.Data).length + [...Packed.Texts.values()].reduce((Sum, Value) => Sum + Value.length, 0);
	assert.ok(CompactChars < JSON.stringify(F.Store.Data).length / 5);
	const Missing = new Map(Packed.Texts); Missing.delete(Packed.Data.Refs[0]);
	await assert.rejects(unpack_edits(Packed.Data, Missing), /缺失或校验失败/);
	Packed.Texts.set(Packed.Data.Refs[0], "corrupted text");
	await assert.rejects(unpack_edits(Packed.Data, Packed.Texts), /校验失败/);
});

test("v1 and v2 migrate once with readback, retain legacy bytes and device identity, and restart without remote-state merging", async () =>
{
	for(const Version of [1, 2])
	{
		const F = await storage_fixture(120), Factory = new IDBFactory();
		await F.Controller.request("Original correction", F.Source, "captured", "note");
		await F.Controller.accept_result(F.Store.Data.Records[0].Spec.Id, F.Output, true);
		if(Version === 1) { F.Store.change(Data => { delete Data.Records[0].Spec.EditRoleMode; }); }
		const Original = JSON.parse(F.Store.export_records()); Original.schemaVersion = Version;
		const Raw = JSON.stringify(Original), Key = `codex-sidebar-edits:v${Version}:original`, Values = new Map([[Key, Raw]]);
		const Local = { getItem: (Name: string) => Values.get(Name) ?? null, setItem: (Name: string, Value: string) => Values.set(Name, Value) };
		const Store = await open_edit_store(Local, "original", Factory);
		assert.deepEqual(JSON.parse(Store.export_records()), JSON.parse(F.Store.export_records())); assert.equal(Values.get(Key), Raw);
		await Store.change(Data => { Data.Writes[0].State = "applied"; });
		await Store.close();
		Values.set(Key, "invalid old data should not replace migrated state");
		const Reopened = await open_edit_store(Local, "original", Factory);
		assert.equal(Reopened.Data.Writes[0].State, "applied"); assert.equal(Reopened.Data.DeviceId, F.Store.Data.DeviceId);
		assert.deepEqual(Reopened.Data.Records[0].Spec, Store.Data.Records[0].Spec); await Reopened.close();
	}
});

test("snapshot deduplication preserves UTF-16 text exactly, including split surrogate selections", async () =>
{
	const F = await storage_fixture(120); await F.Controller.request("Original correction", F.Source, "captured", "auto");
	F.Store.change(Data => { Data.Records[0].Spec.Source!.Text = "\ud800"; Data.Records[0].Spec.Source!.SelectedText = "\udc00"; });
	const Packed = await pack_edits(F.Store.Data), Restored = await unpack_edits(Packed.Data, Packed.Texts);
	assert.equal(Restored.Records[0].Spec.Source!.Text, "\ud800"); assert.equal(Restored.Records[0].Spec.Source!.SelectedText, "\udc00");
});

test("IndexedDB grows beyond old capacity and record limits, serializes updates, and survives reopening", async () =>
{
	const F = await storage_fixture(), Factory = new IDBFactory(), Local = { getItem: (Key: string) => F.Values.get(Key) ?? null, setItem: (Key: string, Value: string) => F.Values.set(Key, Value) };
	const Store = await open_edit_store(Local, "original", Factory), Controller = new ChatEdits(Store, F.Host);
	for(let Index = 0; Index < 8; Index++) { await Controller.request("Original correction", F.Source, "captured", "auto"); await Controller.accept_result(Store.Data.Records.at(-1)!.Spec.Id, F.Output, true); }
	assert.ok(Store.export_records().length > 2000000);
	await Promise.all(Array.from({ length: 44 }, () => Controller.request("Original correction", F.Source, "captured", "auto")));
	assert.equal(Store.Data.Records.length, 52);
	const Expected = Store.export_records(); await Store.close();
	const Restored = await open_edit_store(Local, "original", Factory);
	assert.deepEqual(JSON.parse(Restored.export_records()), JSON.parse(Expected)); await Restored.close();
});

test("aborted migration and journal updates preserve old bytes and prevent note writes", async () =>
{
	const F = await storage_fixture(120), Factory = new IDBFactory();
	await F.Controller.request("Original correction", F.Source, "captured", "note"); await F.Controller.accept_result(F.Store.Data.Records[0].Spec.Id, F.Output, true);
	const Raw = F.Values.get(F.Store.Key), Local = { getItem: (Key: string) => F.Values.get(Key) ?? null, setItem: (Key: string, Value: string) => F.Values.set(Key, Value) };
	const OriginalTransaction = IDBDatabase.prototype.transaction;
	let Abort = true;
	IDBDatabase.prototype.transaction = function(...Args: Parameters<typeof OriginalTransaction>)
	{
		const Transaction = OriginalTransaction.apply(this, Args);
		if(Abort && Args[1] === "readwrite") { queueMicrotask(() => Transaction.abort()); }
		return Transaction;
	};
	try
	{
		await assert.rejects(open_edit_store(Local, "original", Factory), /已有记录保留/); assert.equal(F.Values.get(F.Store.Key), Raw);
		Abort = false;
		const Store = await open_edit_store(Local, "original", Factory), Controller = new ChatEdits(Store, F.Host), Before = Store.export_records();
		Abort = true;
		await assert.rejects(Controller.confirm(Store.Data.Writes[0].Id), /已有记录保留/);
		assert.equal(Store.export_records(), Before); assert.equal(F.Values.get(F.Store.Key), Raw);
		Abort = false; await Store.close();
		const Restored = await open_edit_store(Local, "original", Factory); assert.equal(Restored.export_records(), Before); await Restored.close();
	}
	finally { IDBDatabase.prototype.transaction = OriginalTransaction; }
});

test("durable pending journal precedes the note write and restart recovery cannot write twice", async () =>
{
	const F = await storage_fixture(120), Factory = new IDBFactory(), Local = { getItem: () => null, setItem: () => {} };
	const Store = await open_edit_store(Local, "original", Factory); let Current = F.Before, Writes = 0;
	const Controller = new ChatEdits(Store, { ...F.Host, read_current: async () => Current, compare_write: async (_Path, Before, After) =>
	{
		assert.equal(Current, Before);
		const Readback = await open_edit_store(Local, "original", Factory); assert.equal(Readback.Data.Writes[0].State, "pending"); await Readback.close();
		Writes++; Current = After;
	} });
	await Controller.request("Original correction", F.Source, "captured", "auto"); await Controller.accept_result(Store.Data.Records[0].Spec.Id, F.Output, true);
	assert.equal(Writes, 0);
	await Promise.all([Controller.confirm(Store.Data.Writes[0].Id), Controller.confirm(Store.Data.Writes[0].Id)]); assert.equal(Writes, 1);
	await Store.change(Data => { Data.Writes[0].State = "pending"; }); await Store.close();
	const Restored = await open_edit_store(Local, "original", Factory), Recovered = new ChatEdits(Restored, { ...F.Host, read_current: async () => Current, compare_write: async () => { Writes++; } });
	await Recovered.confirm(Restored.Data.Writes[0].Id); assert.equal(Writes, 1); assert.equal(Restored.Data.Writes[0].State, "applied");
	Current += "later edit"; await assert.rejects(Recovered.undo(Restored.Data.Writes[0].Id), /安全撤销/); await Restored.close();
});

test("other scopes and stale windows cannot overwrite device records; explicit clearing does not resurrect legacy data", async () =>
{
	const F = await storage_fixture(120), Factory = new IDBFactory(), Values = new Map<string, string>(), Local = { getItem: (Key: string) => Values.get(Key) ?? null, setItem: (Key: string, Value: string) => Values.set(Key, Value) };
	const First = await open_edit_store(Local, "original", Factory), Stale = await open_edit_store(Local, "original", Factory), Other = await open_edit_store(Local, "other", Factory);
	const Controller = new ChatEdits(First, F.Host); await Controller.request("Original correction", F.Source, "captured", "auto");
	assert.equal(Other.Data.Records.length, 0); assert.notEqual(First.Data.DeviceId, Other.Data.DeviceId);
	await assert.rejects(Stale.change(Data => { Data.DeviceId = "stale"; }) as Promise<void>, /另一个窗口/);
	assert.notEqual(Stale.Data.DeviceId, "stale");
	Values.set(First.Key, F.Store.export_records()); await First.clear(); assert.equal(Values.get(First.Key), "");
	await Promise.all([First.close(), Stale.close(), Other.close()]);
	const Reopened = await open_edit_store(Local, "original", Factory); assert.equal(Reopened.Data.Records.length, 0); await Reopened.close();
	assert.throws(() => Reopened.change(() => {}), /已关闭/);
});

test("a completed reply rejected by legacy capacity recovers a preview with original baseline and error history, without inference or writes", async () =>
{
	const F = await storage_fixture(120); await F.Controller.request("Original correction", F.Source, "captured", "auto");
	const Task = structuredClone(F.Store.Data.Records[0].Spec), Error = "Error: 本设备修改记录已满, 请先导出并清除旧记录";
	F.Store.change(Data => { Data.Records[0].Status = "rejected"; Data.Records[0].Error = Error; });
	const Messages = [{ Id: "user", Role: "user" as const, Text: "Original correction", TurnId: "original-turn", Task }, { Id: "reply", Role: "assistant" as const, Text: F.Output, TurnId: "original-turn", Phase: "final_answer" as const, CompletionStatus: "completed" as const }];
	await F.Controller.retry_result(Task.Id, Messages);
	assert.equal(F.Store.Data.Records[0].Status, "complete"); assert.deepEqual(F.Store.Data.Records[0].ErrorHistory, [Error]);
	assert.deepEqual(F.Store.Data.Records[0].Spec, Task); assert.equal(F.Store.Data.Writes[0].State, "preview");
	assert.equal(F.Store.Data.Writes[0].Target.Before, F.Before); await assert.rejects(F.Controller.retry_result(Task.Id, Messages), /不属于/);
});

test("a post-write commit failure keeps recovery journals for both apply and undo without repeating either file operation", async () =>
{
	const F = await storage_fixture(120); await F.Controller.request("Original correction", F.Source, "captured", "auto"); await F.Controller.accept_result(F.Store.Data.Records[0].Spec.Id, F.Output, true);
	let Saved = structuredClone(F.Store.Data), Calls = 0, FailAt = 2, Writes = 0, Current = F.Before;
	const Persistence = { save: async (Data: typeof Saved) => { if(++Calls === FailAt) { throw new DOMException("Original quota fixture", "QuotaExceededError"); } Saved = structuredClone(Data); }, close: () => {} };
	const Local = { getItem: () => null, setItem: () => {} }, Host = { ...F.Host, read_current: async () => Current, compare_write: async (_Path: string, Before: string | null, After: string) => { assert.equal(Current, Before); Writes++; Current = After; } };
	const Store = new EditStore(Local, "original", Saved, Persistence), Controller = new ChatEdits(Store, Host), Id = Saved.Writes[0].Id;
	await assert.rejects(Controller.confirm(Id), /笔记已写入/); assert.equal(Writes, 1); assert.equal(Saved.Writes[0].State, "pending");
	await Store.close(); FailAt = -1;
	const Restored = new EditStore(Local, "original", Saved, Persistence), Recovered = new ChatEdits(Restored, Host);
	await Recovered.confirm(Id); assert.equal(Writes, 1); assert.equal(Saved.Writes[0].State, "applied");
	Calls = 0; FailAt = 2;
	await assert.rejects(Recovered.undo(Id), /Original quota/); assert.equal(Writes, 2); assert.equal(Current, F.Before); assert.equal(Saved.Writes[0].UndoPending, true);
	await Restored.close(); FailAt = -1;
	const UndoStore = new EditStore(Local, "original", Saved, Persistence), UndoController = new ChatEdits(UndoStore, Host);
	await UndoStore.clear(); assert.equal(UndoStore.Data.Writes.length, 1, "clear must retain an unresolved undo journal");
	await UndoController.undo(Id); assert.equal(Writes, 2); assert.equal(Saved.Writes[0].State, "undone"); assert.equal(Saved.Writes[0].UndoPending, undefined);
	await UndoStore.close();
});

test("restoring an interrupted or missing legacy response cannot advance the failed record", async () =>
{
	const F = await storage_fixture(120); await F.Controller.request("Original correction", F.Source, "captured", "auto");
	const Task = F.Store.Data.Records[0].Spec;
	F.Store.change(Data => { Data.Records[0].Status = "rejected"; Data.Records[0].Error = "本设备修改记录已满"; });
	const Before = F.Store.export_records();
	await assert.rejects(F.Controller.retry_result(Task.Id, [{ Id: "user", Role: "user", Text: "Original correction", Task, TurnId: "original" }, { Id: "reply", Role: "assistant", Text: F.Output, TurnId: "original", CompletionStatus: "interrupted" }]), /完整原始回复/);
	assert.equal(F.Store.export_records(), Before);
});
