// Build as an explicitly named temporary plugin. Never replace the daily plugin.
import { Plugin, MarkdownView, Component, Platform } from "obsidian";
import { ContextCapture } from "../src/context";
import { ObsidianWriteHost } from "../src/study/obsidian-host";
import { ChatEdits } from "../src/edit/controller";
import { EditStore } from "../src/edit/store";
import { render_edit } from "../src/edit/panel";

function check(Value: unknown, Message: string): asserts Value
{
	if(!Value) { throw new Error(Message); }
}
export default class EditProbe extends Plugin
{
	async run(Input: { before: string; output: string }): Promise<object>
	{
		const Path = `Codex-edit-scratch-${crypto.randomUUID()}.md`, Previous = this.app.workspace.activeLeaf;
		const File = await this.app.vault.create(Path, Input.before), Leaf = this.app.workspace.getLeaf("tab");
		const Root = document.body.createDiv(); Root.style.display = "none"; const Render = new Component(); Render.load();
		let Writes = 0;
		try
		{
			await Leaf.openFile(File, { active: false, state: { mode: "source" } });
			const View = Leaf.view; check(View instanceof MarkdownView, "Scratch did not open in MarkdownView");
			const Editor = View.editor, Paragraph = Input.before.split("\n\n").find(Value => Value.startsWith("证明:"))!;
			const Original = Input.before + "\n原生编辑器中的新草稿";
			Editor.setValue(Original);
			const DiskBefore = await this.app.vault.read(File);
			const From = Original.indexOf(Paragraph); Editor.setSelection(Editor.offsetToPos(From), Editor.offsetToPos(From + Paragraph.length));
			const Capture = new ContextCapture(this.app), Source = await Capture.capture("选区", View);
			check(Source?.Selection?.From === From, "Native selection offsets missing");
			const Host = new ObsidianWriteHost(this.app), Local = new Map<string, string>();
			const Store = new EditStore({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => Local.set(Key, Value) }, "native-original-probe");
			const Controller = new ChatEdits(Store, { read_current: Value => Host.read_current(Value), compare_write: async (...Args) => { Writes++; await Host.compare_write(...Args); }, protected_source: () => false, changed: () => {}, send: async Task => { await Controller.accept_result(Task.Id, Input.output, true); return true; } });
			await Controller.request("修正这段系数错误, 最小修改", Source, "captured", "complete-answer");
			const Task = Store.Data.Records[0].Spec, Plan = Store.Data.Writes[0];
			check(Plan && Writes === 0 && Editor.getValue() === Original, "Preview changed source");
			await render_edit(this.app, Root, Controller, Task, Render, () => {});
			check(!Root.querySelector("[aria-label],[title]"), "Owned hover descriptions appeared");
			const Click = async (Label: string, State: string, Id: string) =>
			{
				const Button = [...Root.querySelectorAll("button")].find(Value => Value.textContent === Label); check(Button, `Missing ${Label}`); Button.click(); Button.click();
				for(let Index = 0; Index < 100 && Store.Data.Writes.find(Value => Value.Id === Id)?.State !== State; Index++) { await new Promise(Resolve => setTimeout(Resolve, 20)); }
				check(Store.Data.Writes.find(Value => Value.Id === Id)?.State === State, `Button did not reach ${State}`);
			};
			await Click("确认写入此文件", "applied", Plan.Id);
			check(Number(Writes) === 1 && Editor.getValue() === Plan.After && Plan.After.endsWith("原生编辑器中的新草稿"), "Native confirmed write lost editor content");
			Editor.undo(); check(Editor.getValue() === Original, "Native editor undo history lost");
			Editor.redo(); check(Editor.getValue() === Plan.After, "Native redo failed");
			Root.empty(); await render_edit(this.app, Root, Controller, Task, Render, () => {}); await Click("安全撤销本次修改", "undone", Plan.Id);
			check(Editor.getValue() === Original, "Safe undo did not restore baseline");
			Editor.setSelection(Editor.offsetToPos(From), Editor.offsetToPos(From + Paragraph.length));
			const Fresh = await Capture.capture("选区", View); check(Fresh, "Fresh capture missing");
			await Controller.request("修正", Fresh, "captured", "complete-answer");
			const Next = Store.Data.Writes.at(-1)!, NextTask = Store.Data.Records.at(-1)!.Spec;
			Editor.setValue(Original + "\n后续编辑, 不可覆盖"); const Current = Editor.getValue();
			Root.empty(); await render_edit(this.app, Root, Controller, NextTask, Render, () => {}); await Click("确认写入此文件", "conflict", Next.Id);
			check(Editor.getValue() === Current && Number(Writes) === 2, "Stale preview overwrote subsequent edits");
			Capture.close();
			return { passed: ["native SDK source capture", "preview zero writes", "actual confirmation button", "duplicate click", "editor content retained", "native undo/redo", "safe undo button", "stale conflict button", "no owned hover labels"], unsavedAtCapture: DiskBefore !== Original, mobile: Platform.isMobileApp };
		}
		finally
		{
			Render.unload(); Root.remove(); Leaf.detach();
			if(Previous) { this.app.workspace.setActiveLeaf(Previous, { focus: false }); }
			// Closing a dirty scratch editor can schedule its final save.
			await new Promise(Resolve => setTimeout(Resolve, 1200));
			const Remaining = this.app.vault.getFileByPath(Path); if(Remaining) { await this.app.vault.delete(Remaining); }
		}
	}
}
