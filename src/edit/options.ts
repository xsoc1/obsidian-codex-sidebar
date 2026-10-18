import type { EditScope } from "./protocol";

export class EditOptions
{
	readonly Scope: HTMLSelectElement;
	constructor(Root: HTMLElement, Changed: () => void)
	{
		const Select = (Parent: HTMLElement, Text: string, Values: string[][]) =>
		{
			const Label = Parent.createEl("label", { cls: "codex-edit-field" }); Label.createSpan({ text: Text });
			const Value = Label.createEl("select"); for(const [Key, Name] of Values) { Value.createEl("option", { value: Key, text: Name }); }
			Value.addEventListener("change", Changed); return Value;
		};
		const Details = Root.createEl("details", { cls: "codex-edit-options" }); Details.createEl("summary", { text: "修改范围" });
		this.Scope = Select(Details, "修改范围", [["ai", "AI 自选当前笔记中的修改范围"], ["captured", "严格只改选区 / 捕获的 Markdown 块"], ["note", "当前整篇笔记 (最多 24000 字符)"]]);
	}
	values(): { Scope: EditScope; Role: "auto" }
	{
		return { Scope: this.Scope.value as EditScope, Role: "auto" };
	}
}
