import type { SyncConflict } from "./sync/types";
import type { SessionState } from "./sessions";

export function conflict_target(Key: string): { SessionId: string; MessageId: string } | null
{
	try
	{
		const P = JSON.parse(Key);
		if(Array.isArray(P) && P.every(V => typeof V === "string") && P.length === 2 && P.every(Boolean)) { return { SessionId: P[0], MessageId: P[1] }; }
		if(Array.isArray(P) && P[0] === "message" && P.length === 3 && typeof P[1] === "string" && P[1] && typeof P[2] === "string" && P[2]) { return { SessionId: P[1], MessageId: P[2] }; }
	}
	catch { }
	return null;
}
export function render_sync_conflicts(Root: HTMLElement, Conflicts: readonly SyncConflict[], State: SessionState, Resolve: (Key: string, Choice: "local" | "remote") => Promise<void>): void
{
	Root.empty(); Root.hidden = !Conflicts.length; if(!Conflicts.length) { return; }
	const Details = Root.createEl("details"); Details.createEl("summary", { text: `同步冲突 (${Conflicts.length})` });
	Details.createDiv({ text: "无法自动判断的版本保留双方. 请核对消息与来源后选择; 这只处理聊天记录, 不授权修改笔记." });
	for(const C of Conflicts)
	{
		const Target = conflict_target(C.Key), Session = State.Sessions.find(S => S.Id === Target?.SessionId), Deleted = Target && State.DeletedSessionIds?.includes(Target.SessionId);
		const Card = Details.createEl("details", { cls: "codex-sync-conflict" }); Card.createEl("summary", { text: Target ? `${Session?.Title ?? "原会话不可用"} · 消息 ${Target.MessageId.slice(0, 16)}` : "设置或目录版本冲突" }); Card.createDiv({ text: C.Reason });
		for(const [Label, Value] of [["本机版本", C.Local], ["远端版本", C.Remote]] as const)
		{
			Card.createEl("strong", { text: Label });
			const Text = typeof Value === "string" ? Value : typeof (Value as any)?.Text === "string" ? (Value as any).Text : JSON.stringify(Value, null, 2) ?? "未提供";
			Card.createEl("pre", { text: Text.slice(0, 12000), cls: "codex-conflict-preview" }); if(Text.length > 12000) { Card.createDiv({ text: "预览已截断, 导出包含完整双方数据" }); }
		}
		const Status = Card.createDiv({ attr: { role: "status" } }), Actions = Card.createDiv({ cls: "codex-edit-actions" });
		const Export = Actions.createEl("button", { text: "导出完整冲突 JSON", attr: { type: "button" } });
		Export.addEventListener("click", () =>
		{
			const Payload = JSON.stringify({ schemaVersion: 1, Scope: State.Sync?.Scope ?? null, Conflict: C }, null, 2), Url = URL.createObjectURL(new Blob([Payload], { type: "application/json;charset=utf-8" }));
			const Link = Card.createEl("a", { attr: { href: Url, download: "codex-sync-conflict.json" } }); Link.click(); Link.remove(); setTimeout(() => URL.revokeObjectURL(Url), 1000); Status.setText("已导出包含原文的双方记录, 请自行保管");
		});
		if(Target && Session && !Deleted)
		{
			for(const [Choice, Label] of [["local", "保留本机版本..."], ["remote", "采用远端版本..."]] as const)
			{
				const Button = Actions.createEl("button", { text: Label, attr: { type: "button" } });
				Button.addEventListener("click", () => { Button.disabled = true; void Resolve(C.Key, Choice).catch(E => Status.setText(String(E))).finally(() => { Button.disabled = false; }); });
			}
		}
		else { Status.setText(Deleted ? "原会话已删除, 不复活消息; 仅保留核对和导出信息" : Target ? "原会话不可用, 不自动恢复或覆盖" : "此类版本先保留双方并导出核对; 请在设置中明确选择新值, 不自动覆盖"); }
	}
}
