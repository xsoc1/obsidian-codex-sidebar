import { Modal, type App } from "obsidian";
import { session_stamp, type ChatSession } from "./sessions";

export class DeleteSessionDialog extends Modal
{
	private Stamp: string;
	constructor(AppValue: App, private Session: ChatSession, private Remove: (Id: string, Stamp: string) => Promise<void>, private Closed: () => void)
	{
		super(AppValue); this.Stamp = session_stamp(Session);
	}
	onOpen(): void
	{
		this.contentEl.createEl("h3", { text: "删除会话" });
		this.contentEl.createEl("p", { text: `删除“${this.Session.Title}”及其中 ${this.Session.Messages.length} 条消息?` });
		this.contentEl.createEl("p", { text: "此会话将从列表和笔记关联中移除, 不能在插件中恢复. 其他会话及重发分支保留. 已写入的笔记和本设备修改记录保留." });
		this.contentEl.createEl("p", { text: "若当前笔记启用了自动切换, 删除后会使用新的空会话." });
		const Actions = this.contentEl.createDiv({ cls: "modal-button-container" });
		const Cancel = Actions.createEl("button", { text: "取消", attr: { type: "button" } }); Cancel.addEventListener("click", () => this.close());
		const Confirm = Actions.createEl("button", { text: "确认删除", cls: "mod-warning", attr: { type: "button" } });
		const Status = this.contentEl.createDiv({ attr: { role: "status" } });
		Confirm.addEventListener("click", async () =>
		{
			Confirm.disabled = true; Cancel.disabled = true; Status.setText("正在删除...");
			try { await this.Remove(this.Session.Id, this.Stamp); this.close(); }
			catch(ErrorValue) { Status.setText(ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue)); Confirm.disabled = false; Cancel.disabled = false; }
		});
	}
	onClose(): void { this.Closed(); this.contentEl.empty(); }
}
