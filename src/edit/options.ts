import { edit_intent, type EditRole, type EditScope } from "./protocol";

export class EditOptions
{
	readonly Mode: HTMLSelectElement;
	readonly Scope: HTMLSelectElement;
	readonly Role: HTMLSelectElement;
	private Hint: HTMLElement;
	constructor(Root: HTMLElement, Changed: () => void)
	{
		this.Hint = Root.createDiv({ cls: "codex-edit-intent", attr: { "aria-live": "polite" } });
		this.Hint.hidden = true;
		const Select = (Parent: HTMLElement, Text: string, Values: string[][]) =>
		{
			const Label = Parent.createEl("label", { cls: "codex-edit-field" }); Label.createSpan({ text: Text });
			const Value = Label.createEl("select"); for(const [Key, Name] of Values) { Value.createEl("option", { value: Key, text: Name }); }
			Value.addEventListener("change", Changed); return Value;
		};
		this.Mode = Select(Root, "本轮方式", [["auto", "自动判断问答或修改"], ["question", "仅问答, 不生成写回"], ["edit", "生成修改预览"]]);
		const Details = Root.createEl("details", { cls: "codex-edit-options" }); Details.createEl("summary", { text: "修改范围与原文类型" });
		this.Scope = Select(Details, "修改范围", [["ai", "AI 自选当前笔记中的修改范围"], ["captured", "严格只改选区 / 捕获的 Markdown 块"], ["note", "当前整篇笔记 (最多 24000 字符)"]]);
		this.Role = Select(Details, "原文类型", [["auto", "自动辨认, 默认最小改动"], ["note", "普通笔记"], ["complete-answer", "完整答案 (最小修补)"], ["outline", "解题思路 (沿原路线)"], ["problem", "用户题面"], ["lecture", "讲义"], ["source-excerpt", "源书摘录 (只读)"], ["teacher-problem", "教师原题 (只读)"]]);
	}
	values(): { Mode: "auto" | "question" | "edit"; Scope: EditScope; Role: EditRole }
	{
		return { Mode: this.Mode.value as "auto" | "question" | "edit", Scope: this.Scope.value as EditScope, Role: this.Role.value as EditRole };
	}
	refresh(Text: string, Quoted: boolean, Path?: string): boolean
	{
		const Edit = this.Mode.value === "edit" || (this.Mode.value === "auto" && !Quoted && edit_intent(Text));
		this.Hint.hidden = !Text.trim();
		this.Hint.setText(Edit ? `将生成修改预览 · ${Path ?? "发送时捕获当前 Markdown"} · ${this.Scope.value === "ai" ? "AI 自选范围 (同一笔记, 最多提供 24000 字符)" : this.Scope.value === "note" ? "整篇笔记" : "严格选区 / 捕获块"}. 确认后才写入.` : `本轮为问答. 要采用改稿, 请将本轮方式切为“生成修改预览”. 修改范围只在预览模式生效. 当前来源: ${Path ?? "尚未捕获 Markdown"}.`);
		return Edit;
	}
}
