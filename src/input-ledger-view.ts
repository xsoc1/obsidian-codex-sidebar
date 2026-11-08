import type { HistoryInputLedger } from "./history-budget";
import type { ChatMessage } from "./history";
import { capture_history_ledger, same_ledger_identity, HistoryLedgerLimits, type HistoryLedgerIdentity, type HistoryMaterialLedger, type HistoryReadRecord } from "./history-ledger";

export interface InputLedgerViewOptions
{
	Messages?: readonly ChatMessage[];
	Identity?: HistoryLedgerIdentity;
	NavigationScope?: string;
	Preview?: boolean;
	Delivery?: "prepared" | "submitted" | "unknown";
	Reveal?: (Target: { Scope: string; SessionId: string; MessageId: string }) => void;
}
const Completion: Record<string, string> = { completed: "完整完成", partial: "部分", interrupted: "中断", failed: "失败", refused: "拒绝", unknown: "未知", cancelled: "已取消" };
function read_range(Records: HistoryReadRecord[]): string
{
	return Records.slice(0, HistoryLedgerLimits.Reads).map(R => `${R.Field}: ${R.From}–${R.To} / ${R.TotalChars} 字符`).join("; ");
}
export function render_input_ledger(Root: HTMLElement, Ledger: HistoryInputLedger, Options: InputLedgerViewOptions = {}): void
{
	const Stored = Ledger as HistoryMaterialLedger;
	const Labels = Stored.MaterialLabels ?? (Options.Messages ? capture_history_ledger(Ledger, Options.Messages, Options.Identity ?? { Scope: "", SessionId: "", OperationId: "" }).MaterialLabels : []);
	const Included = new Set(Ledger.IncludedMessageIds), Omitted = new Set(Ledger.OmittedMessageIds);
	const Reads = !Options.Preview && same_ledger_identity(Stored.Identity, Options.Identity) ? (Stored.ReadRecords ?? []).filter(R => same_ledger_identity(R, Options.Identity)).slice(0, HistoryLedgerLimits.Reads) : [];
	const Ids = [...new Set([...Included, ...(Ledger.DeferredMaterials ?? []).map(M => M.MessageId), ...Reads.map(R => R.MessageId), ...Omitted])].slice(0, HistoryLedgerLimits.Labels);
	const Details = Root.createEl("details", { cls: "codex-input-ledger" });
	const Prepared = Options.Preview || Options.Delivery === "prepared";
	Details.createEl("summary", { text: Prepared ? "发送前历史材料预览 (尚未发送)" : Options.Delivery === "unknown" ? "本轮历史材料 (提交待核对)" : "本轮历史覆盖" });
	Details.createDiv({ text: `已纳入 ${Ledger.IncludedMessageIds.length} 条历史; 未重放 ${Ledger.OmittedMessageCount} 条; 待按原文版本补读 ${Ledger.DeferredMaterials?.length ?? 0} 项` });
	Details.createDiv({ cls: "codex-message-context", text: Prepared ? "这是待发送输入的预算记录; 尚未向模型提交." : Options.Delivery === "unknown" ? "这是原请求构造的材料范围; 提交结果待核对, 不推断正文已送达. 实际补读状态单独列出." : "记录本轮提供范围; 不代表模型已理解或核验数学正确性. 仅有补读定位不代表模型已读取正文." });
	for(const Id of Ids)
	{
		const Label = Labels?.find(M => M.MessageId === Id), Deferred = Ledger.DeferredMaterials?.filter(M => M.MessageId === Id) ?? [], Read = Reads.filter(R => R.MessageId === Id);
		const Row = Details.createDiv({ cls: "codex-ledger-material" });
		Row.createEl("strong", { text: `${Label?.Round ? `第 ${Label.Round} 轮 · ` : ""}${Label?.Role === "user" ? "问题" : Label?.Role === "assistant" ? "回答" : "历史材料"} · ${Label?.Label ?? "正文摘要未知 (旧记录或未加载)"}` });
		const Provided = Deferred.length ? "只提供补读定位" + (Label?.Role === "user" ? " (问题文字仍已提供)" : "") : Included.has(Id) ? (Ledger.Deduplicated.some(D => D.MessageId === Id) ? "本轮已提供派生正文 (同版本重复材料去重)" : "本轮已提供正文") : Omitted.has(Id) ? "本轮未提供正文" : "本轮提供范围未知";
		Row.createDiv({ text: Prepared ? Provided.replace("本轮已提供", "预计提供").replace("只提供", "预计只提供") : Options.Delivery === "unknown" ? Provided.replace("本轮已提供", "原请求包含") : Provided });
		const Applicable = Read.filter(R => !Deferred.length || Deferred.some(D => D.Field === R.Field && D.SourceVersion === R.SourceVersion));
		Row.createDiv({ text: Applicable.length ? "实际补读成功 · " + read_range(Applicable) : "实际补读: 尚未知 (没有本轮成功读取证据)" });
		if(Read.length > Applicable.length) { Row.createDiv({ text: "另有其他字段或版本的成功读取, 不替代上述原文定位" }); }
		Row.createDiv({ cls: "codex-message-context", text: `原回答完成状态: ${Label?.Role === "user" ? "不适用" : Completion[Label?.Completion ?? "unknown"] ?? "未知"}; 来源快照: ${Label?.Snapshot === "truncated" ? "有截断" : Label?.Snapshot === "complete" ? "已记录为未截断" : Label?.Snapshot === "none" ? "未附快照" : "截断情况未知"}` });
		if(Options.Reveal && Options.Identity && (!Stored.Identity || same_ledger_identity(Stored.Identity, Options.Identity)))
		{
			const Target = { Scope: Options.NavigationScope ?? Options.Identity.Scope, SessionId: Options.Identity.SessionId, MessageId: Id }, Button = Row.createEl("button", { text: "查看原消息", attr: { type: "button" } });
			Button.addEventListener("click", () => Options.Reveal!(Target));
		}
		const Meta = Row.createEl("details"); Meta.createEl("summary", { text: "身份、版本与范围" });
		Meta.createEl("pre", { text: `消息 ID: ${Id}\n` + Deferred.map(M => `${M.Field} · 版本 ${M.SourceVersion} · ${M.Utf8Bytes} 字节`).join("\n") + (Read.length ? "\n" + Read.map(R => `${R.Field} · ${R.BodyVersion} · 原文版本 ${R.SourceVersion} · ${R.Utf8Bytes} 字节`).join("\n") : "") });
		if(!Stored.MaterialLabels && Label) { Meta.createDiv({ text: "摘要来自当前已加载目录; 旧记录没有当轮摘要快照" }); }
	}
	if(Ledger.OmittedLocatorTruncated || Ids.length < new Set([...Included, ...Omitted]).size || Stored.ReadRecordsTruncated) { Details.createDiv({ text: "清单按展示预算截断; 未列出部分的读取状态不作推断" }); }
	const Budget = Details.createEl("details"); Budget.createEl("summary", { text: "输入预算详情" });
	Budget.createDiv({ text: `UTF-8 输入预算 ${Ledger.Utf8Budget} 字节, 本轮记录 ${Ledger.ActualUtf8Bytes} 字节${Ledger.ReportedModelWindow === null ? "; 模型窗口未知, 使用保守预算" : "; 模型报告窗口 " + Ledger.ReportedModelWindow}` });
}
