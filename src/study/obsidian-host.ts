import { MarkdownView, type App } from "obsidian";
import type { WriteHost } from "./writer";
import { note_path } from "./document";

export class ObsidianWriteHost implements WriteHost
{
	constructor(private App: App)
	{
	}
	private views(Path: string): MarkdownView[]
	{
		return this.App.workspace.getLeavesOfType("markdown").map(Leaf => Leaf.view).filter((View): View is MarkdownView => View instanceof MarkdownView && View.file?.path === Path);
	}
	private editor(Path: string): MarkdownView | null
	{
		const Views = this.views(Path).filter(View => View.getMode() === "source");
		if(Views.some(View => View.editor.getValue() !== Views[0].editor.getValue()))
		{
			throw new Error("同一文件的多个编辑器内容不一致");
		}
		return Views[0] ?? null;
	}
	async read_current(Path: string): Promise<string | null>
	{
		note_path(Path);
		const View = this.editor(Path);
		if(View)
		{
			return View.editor.getValue();
		}
		const File = this.App.vault.getFileByPath(Path);
		return File ? this.App.vault.read(File) : null;
	}
	async compare_write(Path: string, Before: string | null, After: string): Promise<void>
	{
		note_path(Path);
		if(Before === null)
		{
			if(this.App.vault.getAbstractFileByPath(Path))
			{
				throw new Error("新文件名被占用");
			}
			// Existing parent only. No implicit directory creation or overwrite.
			await this.App.vault.create(Path, After); return;
		}
		const View = this.editor(Path);
		if(View)
		{
			if(View.editor.getValue() !== Before)
			{
				throw new Error("编辑器内容已变化");
			}
			const Other = this.views(Path).filter(Value => Value !== View && Value.getMode() === "source");
			if(Other.length)
			{
				throw new Error("请保留一个编辑器后再采用, 避免多窗覆盖");
			}
			let From = 0;
			while(From < Before.length && From < After.length && Before[From] === After[From])
			{
				From++;
			}
			let Tail = 0;
			while(Tail < Before.length - From && Tail < After.length - From && Before[Before.length - Tail - 1] === After[After.length - Tail - 1])
			{
				Tail++;
			}
			View.editor.transaction({ changes: [{ from: View.editor.offsetToPos(From), to: View.editor.offsetToPos(Before.length - Tail), text: After.slice(From, After.length - Tail) }] }, "codex-study");
			return;
		}
		const File = this.App.vault.getFileByPath(Path);
		if(!File)
		{
			throw new Error("目标文件已移除");
		}
		await this.App.vault.process(File, Current =>
		{
			if(this.editor(Path) || Current !== Before)
			{
				throw new Error("文件或编辑器已变化, 拒绝覆盖");
			}
			return After;
		});
	}
}
