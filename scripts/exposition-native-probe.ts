// Temporary native component; replay only original model output, never replace the daily plugin.
import { Plugin, MarkdownView, Component, Platform } from "obsidian";
import { ContextCapture } from "../src/context";
import { ObsidianWriteHost } from "../src/edit/obsidian-host";
import { ChatEdits } from "../src/edit/controller";
import { EditStore } from "../src/edit/store";
import { render_edit } from "../src/edit/panel";

function check(Value: unknown, Message: string): asserts Value
{
	if(!Value) { throw new Error(Message); }
}

export default class ExpositionProbe extends Plugin
{
	async run(Input: { before: string; output: string; request: string }): Promise<object>
	{
		const Path = `Codex-exposition-scratch-${crypto.randomUUID()}.md`, Previous = this.app.workspace.activeLeaf;
		const Daily = (this.app as any).plugins.plugins["codex-sidebar"];
		const OriginalIds = new Set<string>(Daily?.State.Sessions.map((Value: any) => Value.Id) ?? []);
		const Cleanup = { scratchRemoved: false, ownedEmptySessionsRemoved: 0 };
		const File = await this.app.vault.create(Path, Input.before), Leaf = this.app.workspace.getLeaf("tab");
		const Root = document.body.createDiv();
		Root.style.cssText = "position:fixed;left:-10000px;top:0;width:700px;height:800px;overflow:auto";
		const Render = new Component(); Render.load();
		const Capture = new ContextCapture(this.app);
		let Writes = 0;
		try
		{
			await Leaf.openFile(File, { active: false, state: { mode: "source" } });
			const View = Leaf.view; check(View instanceof MarkdownView, "Expected original scratch editor");
			const Editor = View.editor, Original = Input.before + "\n\n原生编辑器未落盘尾稿";
			Editor.setValue(Original); Editor.setSelection(Editor.offsetToPos(0), Editor.offsetToPos(Input.before.length));
			const Source = await Capture.capture("选区", View); check(Source, "Native source capture failed");
			const Host = new ObsidianWriteHost(this.app), Local = new Map<string, string>();
			const Store = new EditStore({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => Local.set(Key, Value) }, "original-exposition-probe");
			const Controller = new ChatEdits(Store, {
				read_current: Value => Host.read_current(Value), compare_write: async (...Args) => { Writes++; await Host.compare_write(...Args); },
				protected_source: () => false, changed: () => {}, send: async Task => { await Controller.accept_result(Task.Id, Input.output, true); return true; }
			});
			await Controller.request(Input.request, Source, "captured", "complete-answer");
			const Plan = Store.Data.Writes[0], Task = Store.Data.Records[0].Spec;
			check(Plan && Writes === 0 && Editor.getValue() === Original, "Preview changed the editor");
			await render_edit(this.app, Root, Controller, Task, Render, () => {});
			for(let Index = 0; Index < 120 && Root.querySelectorAll("mjx-container").length < 2; Index++) { await new Promise(Resolve => setTimeout(Resolve, 50)); }
			const Widths: object[] = [];
			for(const Width of [700, 320])
			{
				Root.style.width = Width + "px";
				await new Promise(Resolve => setTimeout(Resolve, 50));
				Widths.push({ width: Width, math: Root.querySelectorAll("mjx-container").length, errors: Root.querySelectorAll("mjx-merror,.math-error").length });
			}
			check(Root.querySelectorAll("mjx-container").length >= 2 && !Root.querySelector("mjx-merror,.math-error"), "Native math rendering failed");
			const Click = async (Label: string, State: string, Id: string) =>
			{
				const Button = [...Root.querySelectorAll("button")].find(Value => Value.textContent === Label); check(Button, `Missing button ${Label}`);
				Button.click(); Button.click();
				for(let Index = 0; Index < 150 && Store.Data.Writes.find(Value => Value.Id === Id)?.State !== State; Index++) { await new Promise(Resolve => setTimeout(Resolve, 20)); }
				check(Store.Data.Writes.find(Value => Value.Id === Id)?.State === State, `Expected state ${State}`);
			};
			await Click("确认写入此文件", "applied", Plan.Id);
			check(Number(Writes) === 1 && Editor.getValue() === Plan.After && Plan.After.endsWith("原生编辑器未落盘尾稿"), "Confirmation or duplicate guard failed");
			Editor.undo(); check(Editor.getValue() === Original, "Native undo did not preserve history");
			Editor.redo(); check(Editor.getValue() === Plan.After, "Native redo failed");
			Root.empty(); await render_edit(this.app, Root, Controller, Task, Render, () => {});
			await Click("安全撤销本次修改", "undone", Plan.Id); check(Editor.getValue() === Original, "Safe undo failed");
			Editor.setSelection(Editor.offsetToPos(0), Editor.offsetToPos(Input.before.length));
			const Fresh = await Capture.capture("选区", View); check(Fresh, "Fresh snapshot missing");
			await Controller.request(Input.request, Fresh, "captured", "complete-answer");
			const Next = Store.Data.Writes.at(-1)!, NextTask = Store.Data.Records.at(-1)!.Spec;
			Editor.setValue(Original + "\n后续编辑不可覆盖"); const Current = Editor.getValue();
			Root.empty(); await render_edit(this.app, Root, Controller, NextTask, Render, () => {});
			await Click("确认写入此文件", "conflict", Next.Id); check(Editor.getValue() === Current, "Stale output overwrote subsequent edits");
			return { tier: "Windows native APIs and offscreen DOM; replayed real original output; no native inference", widths: Widths, passed: ["source capture", "zero preview writes", "confirmation", "duplicate click", "unsaved tail preserved", "native undo/redo", "safe undo", "stale conflict"], mobile: Platform.isMobileApp, theme: document.body.classList.contains("theme-dark") ? "dark" : "light", cleanup: Cleanup };
		}
		finally
		{
			const Restore = this.app.workspace.activeLeaf === Leaf;
			Capture.close(); Render.unload(); Root.remove(); Leaf.detach();
			if(Previous && Restore) { this.app.workspace.setActiveLeaf(Previous, { focus: false }); }
			await new Promise(Resolve => setTimeout(Resolve, 1200));
			const Remaining = this.app.vault.getFileByPath(Path); if(Remaining) { await this.app.vault.delete(Remaining); }
			Cleanup.scratchRemoved = !this.app.vault.getFileByPath(Path);
			if(Daily)
			{
				await Daily.NoteSessions?.flush();
				const Owned = Daily.State.Sessions.filter((Value: any) => !OriginalIds.has(Value.Id) && Value.Title === Path.slice(0, -3) && !Value.Messages.length && !Value.ThreadId && Value.Id !== Daily.State.ActiveId && !Daily.NoteSessions?.Data.Links.some((Link: any) => Link.SessionId === Value.Id));
				if(Owned.length)
				{
					check(!Daily.Busy && !Daily.ChatPreparing && !Daily.NoteSessions?.Switching, "Daily work started; preserve the empty owned session for explicit cleanup");
					Daily.State.Sessions = Daily.State.Sessions.filter((Value: any) => !Owned.includes(Value));
					await Daily.persist(); Daily.refresh(); Cleanup.ownedEmptySessionsRemoved = Owned.length;
				}
			}
		}
	}
}
