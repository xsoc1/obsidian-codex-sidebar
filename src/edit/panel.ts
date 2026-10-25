import { Modal, type App, type Component } from "obsidian";
import type { ChatEdits } from "./controller";
import { render_comparison } from "./comparison";
import type { TaskSpec } from "./task";

export async function render_edit(AppValue: App, Root: HTMLElement, Edits: ChatEdits | null, Task: TaskSpec, Render: Component, Changed: () => void): Promise<void>
{
	Root.dataset.editStructured = "true";
	const Record = Edits?.Store.Data.Records.find(Value => Value.Spec.Id === Task.Id);
	Root.createEl("strong", { text: "笔记修改提案" });
	Root.createDiv({ cls: "codex-message-context", text: `${Task.Source?.Path ?? "未知目标"} · ${Task.EditRoleMode === "auto" ? "原文类型由 AI 辨识" : Task.Role} · 原始快照 ${Task.Source?.CapturedAt ?? "未知"}` });
	if(!Record) { Root.createDiv({ text: "本设备没有这次修改基线, 不能采用远程设备或已清除的提案. 原会话保留, 请明确重新捕获发起新修改." }); return; }
	const Plan = Edits!.Store.Data.Writes.find(Value => Value.TaskId === Task.Id);
	const Target = Plan?.Target ?? Record.Spec.Target!, Range = Target.Range!;
	Root.createDiv({ text: `${Task.EditMode === "ai" ? Plan ? "AI 选择的实际范围" : "AI 可选范围" : "范围"}: 原文字符 ${Range.From + 1}-${Range.To}; 确认前不会修改文件.${Task.EditMode === "ai" && Task.WriteUnit?.Truncated ? " 本轮仅提供当前位置附近的有限窗口." : ""}` });
	Root.createEl("p", { text: Record.Error ?? Record.Output?.rationale ?? (Record.Status === "pending" ? "正在生成修改稿..." : "修改提案已取消") });
	if(Edits?.Error) { Root.createDiv({ text: Edits.Error, attr: { role: "status" } }); }
	if(Record.Output?.status === "needs-decision") { Root.createDiv({ text: "此修改需要你先决定处理路线, 没有生成可写入稿. 请在聊天中明确决定后重新提出修改." }); }
	if(Record.Output?.status === "no-change") { Root.createDiv({ text: "本轮无需写入" }); }
	if(!Plan) { return; }
	if(Task.EditMode === "ai") { const Original = Root.createEl("details"); Original.createEl("summary", { text: "查看 AI 选择的原文" }); Original.createEl("pre", { text: Target.Before!.slice(Range.From, Range.To), cls: "codex-edit-diff" }); }
	Root.createDiv({ text: `状态: ${Plan.State}; ${Plan.Error ?? "格式已校验, 数学正确性仍须审核"}`, attr: { "aria-live": "polite" } });
	render_comparison(AppValue, Root, Target.Before, Plan.After, Target.Path, Render, Range);
	const Actions = Root.createDiv({ cls: "codex-edit-actions" });
	const Button = (Text: string, Action: () => Promise<void> | void) =>
	{
		const Value = Actions.createEl("button", { text: Text, attr: { type: "button" } });
		Value.addEventListener("click", async () =>
		{
			Value.disabled = true;
			try { await Action(); }
			catch(ErrorValue) { Root.createDiv({ text: String(ErrorValue), attr: { role: "status" } }); }
			finally { Value.disabled = false; Changed(); }
		});
	};
	if(["preview", "pending"].includes(Plan.State)) { Button("确认写入此文件", () => Edits!.confirm(Plan.Id)); }
	if(Plan.State === "preview" || Plan.State === "conflict") { Button("取消这次修改", () => Edits!.cancel(Task.Id)); }
	if(Plan.State === "applied") { Button("安全撤销本次修改", () => Edits!.undo(Plan.Id)); }
}

export function export_edits(AppValue: App, Text: string): void
{
	const Dialog = new Modal(AppValue);
	Dialog.contentEl.createEl("h2", { text: "导出本设备修改记录" });
	const Label = Dialog.contentEl.createEl("label"); Label.createSpan({ text: "完整 JSON (包含原文基线, 请自行保管)" });
	const Area = Label.createEl("textarea", { cls: "codex-edit-export" }); Area.readOnly = true; Area.value = Text;
	const Save = Dialog.contentEl.createEl("button", { text: "下载 JSON", attr: { type: "button" } });
	Save.addEventListener("click", () =>
	{
		const Url = URL.createObjectURL(new Blob([Text], { type: "application/json;charset=utf-8" }));
		const Link = Dialog.contentEl.createEl("a", { attr: { href: Url, download: "codex-note-edits.json" } }); Link.click(); Link.remove();
		setTimeout(() => URL.revokeObjectURL(Url), 1000);
	});
	const Close = Dialog.contentEl.createEl("button", { text: "关闭", attr: { type: "button" } }); Close.addEventListener("click", () => Dialog.close()); Dialog.open();
}
