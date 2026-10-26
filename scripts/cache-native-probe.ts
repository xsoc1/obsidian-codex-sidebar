// Native UI components with an original in-memory note; never writes vault files or daily stores.
import { Component, type App } from "obsidian";
import { ChatEdits } from "../src/edit/controller";
import { EditStore } from "../src/edit/store";
import { render_edit } from "../src/edit/panel";
import { version_of } from "../src/edit/document";
import type { ContextSnapshot } from "../src/prompt";

export async function run_cache_probe(AppValue: App): Promise<Record<string, unknown>>
{
	const Before = "# Original\n\n$x=1$\n", From = Before.indexOf("$"), Version = await version_of(Before), Values = new Map<string, string>(), Turns = ["generation"];
	let Current = Before, Writes = 0;
	const Store = new EditStore({ getItem: K => Values.get(K) ?? null, setItem: (K, V) => { Values.set(K, V); } }, "original-native-cache");
	const Edits = new ChatEdits(Store, { read_current: async () => Current, compare_write: async (_Path, Expected, Text) => { if(Current !== Expected) { throw Error("Memory note conflict"); } Current = Text; Writes++; }, protected_source: () => false, changed() {}, send: async () => true, cache_context: () => ({ Key: "original-native-session", Turns: [...Turns] }) });
	const Source: ContextSnapshot = { Path: "Original.md", Text: Before, SelectedText: "$x=1$", Selection: { From, To: From + 5 }, Mode: "编辑", Kind: "选区", Mapping: "源文本", CapturedAt: "original-time", Heading: "Original", LineStart: 2, LineEnd: 2, Truncated: false, Version };
	const Root = document.createElement("div"), Render = new Component(); Render.load();
	const Wait = async (State: string) => { for(let I = 0; I < 100 && Store.Data.Writes[0]?.State !== State; I++) { await new Promise(R => setTimeout(R, 20)); } if(Store.Data.Writes[0]?.State !== State) { throw Error("Native button did not complete " + State); } };
	try
	{
		await Edits.request("Original local correction", Source, "captured", "auto"); const Task = structuredClone(Store.Data.Records[0].Spec);
		await Edits.accept_result(Task.Id, JSON.stringify({ schemaVersion: 1, kind: "note-edit", status: "proposal", markdown: "$x=2$", rationale: "Original correction" }), true);
		const Draw = async () => { Root.empty(); await render_edit(AppValue, Root, Edits, Task, Render, () => {}); };
		const Click = (Label: string) => { const B = [...Root.querySelectorAll("button")].find(E => E.textContent === Label); if(!B) { throw Error("Missing native action " + Label); } B.click(); };
		await Draw(); if(Writes) { throw Error("Preview wrote before confirmation"); } Click("确认写入此文件"); await Wait("applied");
		await Draw(); const MathNodes = Root.querySelectorAll("mjx-container").length; Click("安全撤销本次修改"); await Wait("undone");
		if(Current !== Before || Writes !== 2) { throw Error("Memory apply/undo mismatch"); }
		Turns.push("next-complete-dialogue"); Edits.Cache.poll(); await Edits.Cache.flush(); await Draw();
		if(Store.Data.Records.length || Store.Data.Writes.length || Root.querySelector(".codex-edit-actions") || !Root.textContent?.includes("已按保留轮数自动清理")) { throw Error("Expired native proposal still offers apply/undo"); }
		return { tier: "native Obsidian edit components, original memory write host; not installed daily feature or iPad", previewZeroWrites: true, nativeApplyButton: true, nativeUndoButton: true, nextDialogueExpiresActions: true, sourceTaskUnchanged: Task.Source?.Text === Before, mathContainers: MathNodes, vaultWrites: 0, dailyStoreWrites: 0 };
	}
	finally { Root.remove(); Render.unload(); await Store.close(); }
}
