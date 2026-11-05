import type { ContextSnapshot } from "./prompt";
import { context_completeness } from "./composer-material";

export function explanation_preview(Root: HTMLElement, Snapshot: ContextSnapshot): void
{
	const Details = Root.createEl("details", { cls: "codex-explanation-background" });
	Details.createEl("summary", { text: "解释背景 (实际附带内容)" });
	const Background = Snapshot.Explanation;
	if(!Background) { Details.createDiv({ text: "未附解释背景; 不代表已读取相邻条件或完整原文" }); return; }
	Details.createDiv({ text: `${Snapshot.Path}:${Background.LineStart + 1}–${Background.LineEnd + 1} · Markdown [${Background.From}, ${Background.To})${Snapshot.Version ? " · 版本 " + Snapshot.Version : " · 版本未记录"}` });
	Details.createDiv({ text: `${Background.Closed ? "源块闭合" : "源块未完整闭合"} · ${Background.Truncated ? "背景不完整" : "背景完整"}${Background.Missing.length ? " · 缺失范围 " + Background.Missing.map(R => `[${R.From}, ${R.To})`).join(", ") : ""}` });
	Details.createEl("pre", { text: Background.Text, cls: "codex-selection-text" });
}

export class SelectionPreview
{
	readonly Element: HTMLDetailsElement;
	private Caption: HTMLElement;
	private Preview: HTMLElement;
	private Source: HTMLDetailsElement;
	private Raw: HTMLElement;
	private Identity = "";
	constructor(Root: HTMLElement, Clear: () => void)
	{
		this.Element = Root.createEl("details", { cls: "codex-note-selection" }); this.Element.hidden = true;
		this.Element.createEl("summary", { text: "笔记选中内容" });
		this.Caption = this.Element.createDiv({ cls: "codex-message-context" });
		this.Preview = this.Element.createEl("pre", { cls: "codex-selection-text" });
		this.Source = this.Element.createEl("details"); this.Source.createEl("summary", { text: "查看映射的来源原文" });
		this.Raw = this.Source.createEl("pre", { cls: "codex-selection-text" });
		const Button = this.Element.createEl("button", { text: "清除选区上下文", attr: { type: "button" } }); Button.addEventListener("click", Clear);
	}
	update(Snapshot: ContextSnapshot | null, Attached: boolean): void
	{
		this.Element.hidden = !Snapshot || Snapshot.Kind !== "选区" || !Snapshot.SelectedText || !!Snapshot.Pdf || !!Snapshot.PdfTarget;
		if(this.Element.hidden || !Snapshot) { this.Identity = ""; return; }
		const Identity = JSON.stringify([Snapshot.Path, Snapshot.Mapping, Snapshot.SelectedText, Snapshot.Text, Snapshot.Explanation, Snapshot.SelectedTruncated, Snapshot.ContextTruncated]);
		if(Identity !== this.Identity)
		{
			this.Element.open = true; this.Source.open = false; this.Preview.setText(Snapshot.SelectedText); this.Raw.setText(Snapshot.Text); this.Identity = Identity;
		}
		this.Source.hidden = !Snapshot.Text || Snapshot.Mapping === "源文本" && !!Snapshot.Selection;
		const Completeness = context_completeness(Snapshot);
		this.Caption.setText(`${Snapshot.Path} · ${Snapshot.Mapping} · ${Attached ? "将附带到提问" : "未附带到提问"} · ${Completeness.Selection} · ${Completeness.Background} · ${Snapshot.CapturedAt}`);
	}
}

export function selection_in_source(Container: HTMLElement | undefined, DocumentValue: Document, Target?: EventTarget | null): boolean
{
	if(!Container?.isConnected) { return false; }
	const NodeType = DocumentValue.defaultView!.Node;
	if(Target) { return Target instanceof NodeType && Container.contains(Target); }
	return Container.contains(DocumentValue.defaultView?.getSelection()?.anchorNode ?? null) || Container.contains(DocumentValue.activeElement);
}
