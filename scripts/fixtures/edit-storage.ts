import { EditStore } from "../../src/edit/store";
import { open_edit_store } from "../../src/edit/database";
import { ChatEdits } from "../../src/edit/controller";
import { version_of } from "../../src/edit/document";
import type { ContextSnapshot } from "../../src/prompt";

function check(Condition: unknown, Message: string): asserts Condition { if(!Condition) { throw new Error(Message); } }
function canonical(Value: unknown): string { return JSON.stringify(Value, (_Key, Entry) => Entry && typeof Entry === "object" && !Array.isArray(Entry) ? Object.fromEntries(Object.entries(Entry).sort(([A], [B]) => A.localeCompare(B))) : Entry); }

export async function run_storage_case()
{
	const Scope = "original-browser-fixture", Before = "# Original\n" + "original prose.\n".repeat(8000) + "\n$x=1$\n", Old = "$x=1$", From = Before.indexOf(Old);
	const Source: ContextSnapshot = { Path: "Original.md", Mode: "编辑", Kind: "选区", Mapping: "源文本", Text: Old, SelectedText: Old, Selection: { From, To: From + Old.length }, LineStart: 0, LineEnd: 0, Heading: "Original", CapturedAt: "original-time", Truncated: false, Version: await version_of(Before) };
	let Current = Before, Writes = 0;
	const Host = { read_current: async () => Current, compare_write: async (_Path: string, Expected: string | null, After: string) => { check(Current === Expected, "Wrong write baseline"); Writes++; Current = After; }, protected_source: () => false, send: async () => true, changed: () => {} };
	const Output = JSON.stringify({ schemaVersion: 1, kind: "note-edit", status: "proposal", markdown: "$x=2$", rationale: "Original browser fixture" });
	const Legacy = new EditStore(localStorage, Scope), LegacyController = new ChatEdits(Legacy, Host);
	for(let Index = 0; Index < 3; Index++) { await LegacyController.request("Original correction", Source, "captured", "auto"); await LegacyController.accept_result(Legacy.Data.Records.at(-1)!.Spec.Id, Output, true); }
	const LegacyRaw = localStorage.getItem(Legacy.Key);
	const Store = await open_edit_store(localStorage, Scope), Controller = new ChatEdits(Store, Host);
	check(canonical(Store.Data) === canonical(Legacy.Data), "Migration changed legacy history");
	for(let Index = 3; Index < 8; Index++) { await Controller.request("Original correction", Source, "captured", "auto"); await Controller.accept_result(Store.Data.Records.at(-1)!.Spec.Id, Output, true); }
	check(Store.export_records().length > 2000000 && Store.Data.Records.length === 8, "Old capacity symptom survived");
	check(Writes === 0 && localStorage.getItem(Legacy.Key) === LegacyRaw, "Generation wrote a note or changed rollback data");
	const PlanId = Store.Data.Writes[0].Id;
	await Promise.all([Controller.confirm(PlanId), Controller.confirm(PlanId)]); check(Number(Writes) === 1, "Duplicate confirm wrote twice");
	await Controller.undo(PlanId); check(Current === Before, "Safe undo failed");
	const LastGood = Store.export_records(), OriginalTransaction = IDBDatabase.prototype.transaction;
	IDBDatabase.prototype.transaction = function(...Args: Parameters<typeof OriginalTransaction>)
	{
		const Transaction = OriginalTransaction.apply(this, Args);
		if(Args[1] === "readwrite") { queueMicrotask(() => Transaction.abort()); }
		return Transaction;
	};
	let Refused = false;
	try { await Store.change(Data => { Data.DeviceId = "must-not-commit"; }); } catch { Refused = true; }
	finally { IDBDatabase.prototype.transaction = OriginalTransaction; }
	check(Refused && Store.export_records() === LastGood, "Aborted transaction advanced memory");
	await Store.close();
	const Restored = await open_edit_store(localStorage, Scope);
	check(canonical(Restored.Data) === canonical(JSON.parse(LastGood)), "Aborted transaction changed persisted data");
	localStorage.setItem("original-storage-probe-expected", LastGood);
	const ExpandedChars = JSON.stringify(Restored.Data).length;
	await Restored.close();
	const Database = await new Promise<IDBDatabase>((Resolve, Reject) => { const Request = indexedDB.open("codex-sidebar-edits-v3"); Request.onsuccess = () => Resolve(Request.result); Request.onerror = () => Reject(Request.error); });
	const Size = await new Promise<{ RootChars: number; TextChars: number }>(Resolve =>
	{
		const Transaction = Database.transaction(["roots", "texts"], "readonly"), Root = Transaction.objectStore("roots").get(Scope), Texts = Transaction.objectStore("texts").index("scope").getAll(Scope);
		Transaction.oncomplete = () => Resolve({ RootChars: JSON.stringify(Root.result).length, TextChars: Texts.result.reduce((Sum, Value) => Sum + Value.Text.length, 0) });
	});
	Database.close();
	check(Size.RootChars + Size.TextChars < ExpandedChars / 5, "Snapshot deduplication ineffective");
	return { migration: true, legacyUnchanged: true, expandedChars: ExpandedChars, compactChars: Size.RootChars + Size.TextChars, records: 8, writes: 8, abortedAtomic: true, confirmedOnce: true, safeUndo: true };
}

export async function reopen_storage_case()
{
	const Store = await open_edit_store(localStorage, "original-browser-fixture");
	check(canonical(Store.Data) === canonical(JSON.parse(localStorage.getItem("original-storage-probe-expected")!)), "Browser reload changed records");
	check(Store.Data.Writes[0].State === "undone", "Browser reload lost write state");
	await Store.close(); return { reloadRestored: true };
}
