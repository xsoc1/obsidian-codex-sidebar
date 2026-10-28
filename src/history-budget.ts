import { build_prompt, derived_message_prompt } from "./prompt";
import { history_items, type ChatMessage } from "./history";
import { message_pdf_refs } from "./pdf/inputs";
import { text_identity } from "./markdown-blocks";

export interface HistoryBudgetOptions
{
	ModelContextWindow?: number | null;
	MaxUtf8Bytes?: number;
	/** Work instructions/other current input; CurrentMessage is accounted separately. */
	ReservedUtf8Bytes?: number;
	CurrentMessage?: ChatMessage;
	SessionId?: string;
	MaxMessages?: number;
	MaxImages?: number;
	RequiredMessageIds?: string[];
	UnresolvedMessageIds?: string[];
	UserConstraints?: string[];
	HistoryReadAvailable?: boolean;
	HistoryReadBodyVersionsAvailable?: boolean;
}
export interface HistoryInputLedger
{
	SchemaVersion: 1;
	Construction: "bounded-history-v1";
	BudgetKind: "reported-window-conservative-bytes" | "unknown-window-conservative-bytes";
	ReportedModelWindow: number | null;
	Utf8Budget: number;
	ActualUtf8Bytes: number;
	MessageEnvelopeReserveBytes: number;
	SerializedItemsUtf8Bytes?: number;
	IncludedMessageIds: string[];
	IncludedMessageVersions: { Id: string; Revision: number | null; Digest: string | null }[];
	OmittedMessageIds: string[];
	OmittedMessageCount: number;
	OmittedLocatorTruncated: boolean;
	ImageIds: string[];
	Deduplicated: { MessageId: string; ProvidedIn: string; Path: string; Utf8Bytes: number }[];
	CurrentUtf8Bytes?: number;
	WorkReserveUtf8Bytes?: number;
	ImageReserveBytes?: number;
	DeferredMaterials?: { MessageId: string; Field: "text" | "prompt"; SourceVersion: string; Utf8Bytes: number }[];
}
export interface HistoryPlan { Messages: ChatMessage[]; Ledger: HistoryInputLedger; Navigation: string; }
const Bytes = (Text: string) => new TextEncoder().encode(Text).byteLength;
const Saved = (M: ChatMessage) => M.Role === "user" ? M.Prompt ?? build_prompt(M.Text, M.Context ?? null, M.Quote ?? null) : M.Text;

function groups(Messages: ChatMessage[]): ChatMessage[][]
{
	const Result: ChatMessage[][] = [];
	for(const M of Messages.filter(M => ["user", "assistant"].includes(M.Role) && M.Text.trim()))
	{
		if(M.Role === "user" || !Result.length) { Result.push([]); }
		Result.at(-1)!.push(M);
	}
	return Result;
}
function quote_supplied(Current: ChatMessage | undefined, Message: ChatMessage, SessionId: string | undefined): boolean
{
	const Q = Current?.Quote;
	if(!Current || !Q || !SessionId || Q.SessionId !== SessionId || Q.MessageId !== Message.Id || Q.SourceVersion !== text_identity(Message.Text) || Q.SourceText !== Message.Text || Q.SourceTruncated) { return false; }
	try
	{
		const Prompt = derived_message_prompt(Current), Reference = JSON.parse(Prompt.slice(Prompt.lastIndexOf("\n") + 1));
		return Reference.reference === "selected_assistant_answer" && Reference.session_id === SessionId && Reference.message_id === Message.Id && Reference.source_version === Q.SourceVersion && Reference.original_answer_markdown === Message.Text;
	}
	catch { return false; }
}
function derive(Messages: ChatMessage[], Options: HistoryBudgetOptions)
{
	const Deduplicated: HistoryInputLedger["Deduplicated"] = [], Known = new Map<string, string>(), Earlier = new Map<string, ChatMessage>();
	const Derived = Messages.map(M =>
	{
		if(M.Role !== "user")
		{
			Earlier.set(M.Id, M);
			if(quote_supplied(Options.CurrentMessage, M, Options.SessionId))
			{
				Deduplicated.push({ MessageId: M.Id, ProvidedIn: "current:" + Options.CurrentMessage!.Id, Path: "answer:text", Utf8Bytes: Bytes(M.Text) });
				return { ...M, Text: `[原回答 ${M.Id} 的同版本完整 Markdown 已在当前引用 original_answer_markdown 提供; 此处仅去重派生输入, 原消息不变.]` };
			}
			return { ...M };
		}
		let Prompt = derived_message_prompt(M); const Sources = [M.Context, M.Task?.WriteUnit, M.Task?.Source].filter(Boolean);
		for(const Source of Sources)
		{
			if(!Source || Source.Text.length < 512 || !Prompt.includes(Source.Text)) { continue; }
			const Key = JSON.stringify([Source.Path, Source.Version ?? Source.CapturedAt, Source.Text]), ProvidedIn = Known.get(Key);
			if(ProvidedIn && ProvidedIn !== M.Id && Prompt.split(Source.Text).length === 2)
			{
				Prompt = Prompt.replace(Source.Text, `[相同原文已在历史消息 ${ProvidedIn} 提供; 来源 ${Source.Path}. 这只去重派生输入, 原快照不变.]`);
				Deduplicated.push({ MessageId: M.Id, ProvidedIn, Path: Source.Path, Utf8Bytes: Bytes(Source.Text) });
			}
			else { Known.set(Key, M.Id); }
		}
		const Q = M.Quote, Previous = Q ? Earlier.get(Q.MessageId) : undefined;
		if(Q && Previous && quote_supplied(M, Previous, Options.SessionId))
		{
			const At = Prompt.lastIndexOf("\n");
			try
			{
				const Value = JSON.parse(Prompt.slice(At + 1));
				if(Value.reference === "selected_assistant_answer" && Value.message_id === Q.MessageId && Value.original_answer_markdown === Previous.Text)
				{
					Value.original_answer_markdown = `[同版本完整原文已由前面的 assistant 消息 ${Previous.Id} 提供; 使用该原文, 不把本标记当作原文.]`;
					Prompt = Prompt.slice(0, At + 1) + JSON.stringify(Value);
					Deduplicated.push({ MessageId: M.Id, ProvidedIn: Previous.Id, Path: "answer:text", Utf8Bytes: Bytes(Previous.Text) });
				}
			}
			catch { /* Saved custom prompt is opaque. */ }
		}
		return { ...M, Prompt };
	});
	return { Messages: Derived, Deduplicated };
}
function deferred(Message: ChatMessage)
{
	const Field = Message.Role === "user" ? "prompt" as const : "text" as const, Text = Saved(Message), SourceVersion = text_identity(Text);
	const Locator = JSON.stringify({ command: "read", message_id: Message.Id, field: Field, source_version: SourceVersion });
	const Marker = `[完整已保存材料未重放; 使用 obsidian_history_read ${Locator} 分页补读, 第一页取得正文 version 后续页必须沿用. 该定位符不是证明或条件的摘要; 作答依赖此材料时必须先读取, 无法读取则明确缺失, 不猜补.]`;
	return { Message: Message.Role === "user" ? { ...Message, Prompt: Message.Text + "\n" + Marker } : { ...Message, Text: Marker }, Material: { MessageId: Message.Id, Field, SourceVersion, Utf8Bytes: Bytes(Text) } };
}
export function plan_history_input(Messages: ChatMessage[], Options: HistoryBudgetOptions = {}): HistoryPlan
{
	const Window = typeof Options.ModelContextWindow === "number" && Number.isFinite(Options.ModelContextWindow) && Options.ModelContextWindow > 0 ? Options.ModelContextWindow : null;
	const Base = Options.MaxUtf8Bytes ?? Math.min(192000, Window ? Math.floor(Window * 0.8) : 96000);
	const CurrentBytes = Options.CurrentMessage ? Bytes(derived_message_prompt(Options.CurrentMessage)) : 0;
	const WorkReserve = Math.max(0, Options.ReservedUtf8Bytes ?? 0), CurrentImages = Options.CurrentMessage ? message_pdf_refs(Options.CurrentMessage).length : 0;
	if(CurrentImages > 2) { throw Error("当前轮 PDF 图片超过两张, 历史图片预算不能扩大当前轮约束"); }
	const Budget = Math.floor(Base - WorkReserve - CurrentBytes - CurrentImages * 4096 - 8192);
	if(!Number.isSafeInteger(Budget) || Budget < 2048) { throw new Error("当前问题与工作指令超出保守输入预算; 请缩小来源或分段提问. 原历史保留."); }
	const Required = new Set([...(Options.RequiredMessageIds ?? []), ...(Options.UnresolvedMessageIds ?? [])]), Groups = groups(Messages), Chosen = new Set<number>(), Deferred = new Set<string>();
	if([...Required].some(Id => !Messages.some(M => M.Id === Id))) { throw new Error("必需历史消息不在当前会话中, 未读取其他作用域或补造材料"); }
	const MaxMessages = Options.MaxMessages ?? 64, MaxImages = Options.MaxImages ?? 8;
	const Evaluate = (Indices: Set<number>, DeferredIds = Deferred) =>
	{
		const Selected = Groups.flatMap((G, I) => Indices.has(I) ? G : []), Result = derive(Selected, Options), Materials: NonNullable<HistoryInputLedger["DeferredMaterials"]> = [];
		const Derived = Result.Messages.map((M, I) =>
		{
			if(!DeferredIds.has(M.Id)) { return M; }
			const D = deferred(Selected[I]); Materials.push(D.Material); return D.Message;
		});
		const Images = new Set(Derived.flatMap(M => M.Role === "user" ? message_pdf_refs(M).map(R => R.Id) : []));
		const Cost = Derived.reduce((N, M) => N + Bytes(Saved(M)) + 192, 0) + Images.size * 4096;
		return { Selected, Messages: Derived, Materials, Images, Cost, Deduplicated: Result.Deduplicated };
	};
	const Fits = (R: ReturnType<typeof Evaluate>) => R.Cost <= Budget - 8192 && R.Messages.length <= MaxMessages && R.Images.size <= MaxImages;
	const Add = (Index: number, Mandatory: boolean) =>
	{
		if(Chosen.has(Index)) { return; }
		const Candidate = new Set([...Chosen, Index]), TryDeferred = new Set(Deferred); let Result = Evaluate(Candidate, TryDeferred);
		if(!Fits(Result) && Mandatory && Options.HistoryReadAvailable === true && Options.HistoryReadBodyVersionsAvailable === true)
		{
			for(const M of [...Groups[Index]].sort((A, B) => Bytes(Saved(B)) - Bytes(Saved(A))))
			{
				if(Bytes(Saved(M)) < 1024) { continue; }
				TryDeferred.add(M.Id); Result = Evaluate(Candidate, TryDeferred); if(Fits(Result)) { break; }
			}
		}
		if(!Fits(Result))
		{
			if(Mandatory) { throw new Error("近期完整回合或当前必需原文超出恢复预算; 请明确缩小来源、分段处理或新建会话. 原消息、Prompt和PDF快照保留."); }
			return;
		}
		Chosen.add(Index); for(const Id of TryDeferred) { Deferred.add(Id); }
	};
	for(let I = 0; I < Groups.length; I++) { if(Groups[I].some(M => Required.has(M.Id))) { Add(I, true); } }
	if(Groups.length) { Add(Groups.length - 1, true); }
	for(let I = Groups.length - 2; I >= 0; I--) { Add(I, false); }
	const Result = Evaluate(Chosen), SelectedIds = new Set(Result.Selected.map(M => M.Id));
	const Omitted = Messages.filter(M => ["user", "assistant"].includes(M.Role) && !SelectedIds.has(M.Id));
	const Index = Omitted.filter(M => M.Role === "user").slice(-24).map(M => ({ id: M.Id, turn: M.TurnId ?? null, question: M.Text.slice(0, 96), source: M.Context?.Path ?? M.Task?.Source?.Path ?? null, status: M.CompletionStatus ?? "unknown" }));
	const Constraints = Options.UserConstraints ?? [];
	const ReadInstructions = Options.HistoryReadAvailable === false ? "当前桥不支持历史读取工具; 材料缺失时请明确请用户补充或升级桥, 不假装能读取." : "需要省略的证明、符号或原文时调用 obsidian_history_read, 不猜补. 带 source_version 的定位符约束引用时原文; 第一页读取返回正文 version, 随后的页必须使用正文版本, 目录版本不能用于正文.";
	const Navigation = Omitted.length || Constraints.length || Result.Materials.length ? "历史输入构造 bounded-history-v1. 完整历史仍由客户端保存, 本轮提供下列ID的材料或明确补读定位符, 不是删除历史. 历史索引仅供定位, 不作为定理条件或证明的替代. " + ReadInstructions + " 未知状态仍为未知. 字节预算是保守策略, 不是精确token数; 每张图另留保守容量, 不代表精确视觉token计数.\n" + JSON.stringify({ included: Result.Selected.map(M => M.Id), deferred_originals: Result.Materials, omitted_count: Omitted.length, recent_omitted_questions: Index, user_constraints: Constraints }) : "";
	if(Bytes(Navigation) > 8192) { throw new Error("用户约束或历史导航超过恢复预算; 请缩小本轮材料, 原历史保留."); }
	const Actual = Result.Messages.reduce((N, M) => N + Bytes(Saved(M)), 0) + Bytes(Navigation), Envelope = Result.Messages.length * 192;
	if(Actual + Envelope + Result.Images.size * 4096 > Budget) { throw new Error("派生历史超出字节预算; 请缩小来源或分段. 原记录未改动."); }
	return { Messages: Result.Messages, Navigation, Ledger: { SchemaVersion: 1, Construction: "bounded-history-v1", BudgetKind: Window ? "reported-window-conservative-bytes" : "unknown-window-conservative-bytes", ReportedModelWindow: Window, Utf8Budget: Budget, ActualUtf8Bytes: Actual, MessageEnvelopeReserveBytes: Envelope, IncludedMessageIds: Result.Selected.map(M => M.Id), IncludedMessageVersions: Result.Selected.map(M => ({ Id: M.Id, Revision: M.SyncVersion?.Revision ?? null, Digest: M.SyncVersion?.Digest ?? null })), OmittedMessageIds: Omitted.length <= 64 ? Omitted.map(M => M.Id) : [...Omitted.slice(0, 32), ...Omitted.slice(-32)].map(M => M.Id), OmittedMessageCount: Omitted.length, OmittedLocatorTruncated: Omitted.length > 64, ImageIds: [...Result.Images], Deduplicated: Result.Deduplicated, CurrentUtf8Bytes: CurrentBytes, WorkReserveUtf8Bytes: WorkReserve, ImageReserveBytes: (CurrentImages + Result.Images.size) * 4096, DeferredMaterials: Result.Materials } };
}
export function build_history_input(Messages: ChatMessage[], Options: HistoryBudgetOptions = {}, Images = new Map<string, string>())
{
	const Plan = plan_history_input(Messages, Options), Items: any[] = history_items(Plan.Messages, Images);
	if(Plan.Navigation) { Items.unshift({ type: "message", role: "developer", content: [{ type: "input_text", text: Plan.Navigation }] }); }
	Plan.Ledger.SerializedItemsUtf8Bytes = Bytes(JSON.stringify(Items));
	return { ...Plan, Items };
}

export { HistoryReadTool, history_read_tool, read_history_page } from "./history-reader";
