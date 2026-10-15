import type { ContextSnapshot } from "./prompt";

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
		this.Element.hidden = !Snapshot || Snapshot.Kind !== "选区" || !Snapshot.SelectedText;
		if(this.Element.hidden || !Snapshot) { this.Identity = ""; return; }
		const Identity = JSON.stringify([Snapshot.Path, Snapshot.Mapping, Snapshot.SelectedText, Snapshot.Text]);
		if(Identity !== this.Identity)
		{
			this.Element.open = true; this.Source.open = false; this.Preview.setText(Snapshot.SelectedText); this.Raw.setText(Snapshot.Text); this.Identity = Identity;
		}
		this.Source.hidden = Snapshot.Mapping === "源文本" && !!Snapshot.Selection;
		this.Caption.setText(`${Snapshot.Path} · ${Snapshot.Mapping} · ${Attached ? "将附带到提问" : "未附带到提问"}${Snapshot.Truncated ? " · 已截断" : ""} · ${Snapshot.CapturedAt}`);
	}
}

export function selection_in_source(Container: HTMLElement | undefined, DocumentValue: Document, Target?: EventTarget | null): boolean
{
	if(!Container?.isConnected) { return false; }
	const NodeType = DocumentValue.defaultView!.Node;
	if(Target) { return Target instanceof NodeType && Container.contains(Target); }
	return Container.contains(DocumentValue.defaultView?.getSelection()?.anchorNode ?? null) || Container.contains(DocumentValue.activeElement);
}
