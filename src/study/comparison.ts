import { MarkdownRenderer, type App, type Component } from "obsidian";
import { comparison_texts } from "./comparison-text";
import { diff_preview } from "./diff";
import { safe_math_markdown } from "./safe-markdown";

export function render_comparison(AppValue: App, Root: HTMLElement, Before: string | null, After: string, Path: string, Render: Component, Range?: { From: number; To: number }): void
{
	const Text = comparison_texts(Before, After, Range);
	const Diff = Root.createEl("details", { cls: "codex-comparison" }); Diff.open = true;
	Diff.createEl("summary", { text: "修改对照 (公式排版)" });
	if(Text.Expanded) { Diff.createDiv({ cls: "codex-message-context", text: "为完整显示公式, 对照含未改动的相邻内容; 实际写入范围不变." }); }
	if(Text.RawOnly) { Diff.createDiv({ cls: "codex-message-context", text: "公式或代码边界不完整, 或上下文过长; 此处保留精确源文, 请同时核对原始字符差异." }); }
	const Boxes = ["原文 (修改前)", "拟采用稿 (修改后)"].map((Title, Index) =>
	{
		const Box = Diff.createDiv({ cls: `codex-comparison-side ${Index ? "codex-comparison-after" : "codex-comparison-before"}` });
		Box.createEl("strong", { text: Title }); return Box.createDiv({ cls: "codex-comparison-body" });
	});
	const Raw = Root.createEl("details"); Raw.createEl("summary", { text: "查看原始字符差异 (- 删除 / + 增加)" });
	Raw.createEl("pre", { text: diff_preview(Before, After), cls: "codex-edit-diff" });
	const Status = Diff.createDiv({ cls: "codex-message-context", text: "公式排版中, 可先核对原始字符差异", attr: { role: "status" } });
	let Disposed = false; Render.register(() => { Disposed = true; });
	let Failed = false; const Work: Promise<unknown>[] = [];
	for(const [Index, Value] of [Text.Before, Text.After].entries())
	{
		const Box = Boxes[Index];
		if(Text.RawOnly || !safe_math_markdown(Value)) { Box.createEl("pre", { text: Value, cls: "codex-edit-diff" }); continue; }
		// Rendering never delays confirmation controls or changes either source string.
		Work.push(Promise.resolve().then(() => Disposed ? undefined : MarkdownRenderer.render(AppValue, Value || (Index ? "(删除此范围)" : "(空内容 / 新建文件)"), Box, Path, Render)).catch(ErrorValue =>
		{
			Failed = true;
			if(!Disposed) { Box.createEl("pre", { text: Value, cls: "codex-edit-diff" }); Box.createDiv({ text: `排版未完成, 请核对源文: ${String(ErrorValue)}` }); }
		}));
	}
	void Promise.all(Work).then(() => { if(!Disposed) { Status.hidden = !Failed; if(Failed) { Status.setText("部分排版失败, 源文和原始差异已保留"); } } });
}
