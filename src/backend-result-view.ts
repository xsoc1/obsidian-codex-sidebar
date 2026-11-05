import type { BackendResult } from "./backend-result";

export function render_backend_result(Root: HTMLElement, Result: BackendResult): void
{
	const Status = { completed: "完整回答", partial: "部分正文", refused: "服务端拒绝", unknown: "结果未知", failed: "失败", cancelled: "已确认取消" }[Result.Status];
	const Metadata = Result.Metadata;
	Root.createDiv({ cls: "codex-message-context", text: `${Result.Status==="cancelled"&&Metadata.Submission==="not-submitted"?"已取消 (未提交)":Status}${Metadata.Reason ? " · " + Metadata.Reason : ""}` });
	if(Metadata.Model || Metadata.Transport)
	{
		Root.createDiv({ cls: "codex-message-context", text: [Metadata.Model ? "实际模型: " + Metadata.Model : "", Metadata.Transport ? "传输: " + (Metadata.Transport === "streaming" ? "流式" : "整段响应") : ""].filter(Boolean).join(" · ") });
	}
	if(!Metadata.Usage?.length) { Root.createDiv({ cls: "codex-message-context", text: "用量: 服务商未提供" }); return; }
	const Details = Root.createEl("details"); Details.createEl("summary", { text: "实际用量 (每个请求的累计值)" });
	for(const Usage of Metadata.Usage)
	{
		const Counts = [["输入", Usage.InputTokens], ["输出", Usage.OutputTokens], ["总计", Usage.TotalTokens], ["缓存输入 (含于输入)", Usage.CachedInputTokens], ["推理输出 (含于输出)", Usage.ReasoningOutputTokens]].filter(([_Label, Value]) => Value !== undefined).map(([Label, Value]) => `${Label}: ${Value}`);
		Details.createDiv({ text: Counts.length ? Counts.join(" · ") : "服务商未提供可显示的计数" });
		if(Usage.Receipt?.RequestId || Usage.Receipt?.ResponseId) { Details.createDiv({ cls: "codex-message-context", text: [Usage.Receipt.RequestId ? "请求 " + Usage.Receipt.RequestId : "", Usage.Receipt.ResponseId ? "响应 " + Usage.Receipt.ResponseId : ""].filter(Boolean).join(" · ") }); }
	}
}
