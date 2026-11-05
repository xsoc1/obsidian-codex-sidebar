import type { HistoryInputLedger } from "./history-budget";

export function render_input_ledger(Root: HTMLElement, Ledger: HistoryInputLedger): void
{
	const Details = Root.createEl("details", { cls: "codex-input-ledger" });
	Details.createEl("summary", { text: "本轮历史覆盖" });
	Details.createDiv({ text: `已纳入 ${Ledger.IncludedMessageIds.length} 条历史; 未重放 ${Ledger.OmittedMessageCount} 条; 待按原文版本补读 ${Ledger.DeferredMaterials?.length ?? 0} 项` });
	Details.createDiv({ text: `UTF-8 输入预算 ${Ledger.Utf8Budget} 字节, 本轮记录 ${Ledger.ActualUtf8Bytes} 字节${Ledger.ReportedModelWindow === null ? "; 模型窗口未知, 使用保守预算" : "; 模型报告窗口 " + Ledger.ReportedModelWindow}` });
	if(Ledger.IncludedMessageIds.length) { Details.createEl("pre", { text: "纳入的消息 ID:\n" + Ledger.IncludedMessageIds.join("\n") }); }
	if(Ledger.OmittedMessageCount) { Details.createEl("pre", { text: "未重放的消息 ID" + (Ledger.OmittedLocatorTruncated ? " (清单也已按预算截断)" : "") + ":\n" + Ledger.OmittedMessageIds.join("\n") }); }
	if(Ledger.DeferredMaterials?.length) { Details.createEl("pre", { text: "以下只提供了补读定位, 不代表模型已读取正文:\n" + Ledger.DeferredMaterials.map(M => `${M.MessageId} · ${M.Field} · 版本 ${M.SourceVersion} · ${M.Utf8Bytes} 字节`).join("\n") }); }
}
