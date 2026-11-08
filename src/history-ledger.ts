import type { ChatMessage } from "./history";
import type { HistoryInputLedger } from "./history-budget";
import type { BackendHistoryResult } from "./backend-result";
import { canonical_json } from "./sync/types";

export interface HistoryLedgerIdentity { Scope: string; SessionId: string; OperationId: string; }
export interface HistoryMaterialLabel
{
	MessageId: string;
	Label: string;
	Role: ChatMessage["Role"];
	Round?: number;
	Completion?: ChatMessage["CompletionStatus"];
	Snapshot: "truncated" | "complete" | "unknown" | "none";
}
export interface HistoryReadRecord extends HistoryLedgerIdentity
{
	MessageId: string;
	Field: "text" | "prompt" | "source" | "quote_source";
	SourceVersion: string;
	BodyVersion: string;
	From: number;
	To: number;
	TotalChars: number;
	Utf8Bytes: number;
}
// Optional metadata; old ledgers keep their original meaning and remain readable.
export interface HistoryMaterialLedger extends HistoryInputLedger
{
	Identity?: HistoryLedgerIdentity;
	MaterialLabels?: HistoryMaterialLabel[];
	ReadRecords?: HistoryReadRecord[];
	ReadRecordsTruncated?: boolean;
}
export const HistoryLedgerLimits = { Labels: 160, Reads: 64, LabelChars: 96 } as const;
export function message_label(Message: Pick<ChatMessage, "Role" | "Text">): string
{
	const Head = Message.Text.slice(0, 2048).split(/\r?\n/).find(L => L.trim() && !/^\s*(?:```|~~~|\$\$|---)/.test(L))?.trim().replace(/^\s*(?:#{1,6}\s+|>\s*(?:\[![^\]]+\]\s*)?)/, "") ?? "";
	const Text = (Head.match(/^.*?[。！？!?](?:\s|$)/)?.[0] ?? Head).replace(/\s+/g, " ").trim();
	return Text ? Text.slice(0, HistoryLedgerLimits.LabelChars) + (Text.length > HistoryLedgerLimits.LabelChars ? "…" : "") : Message.Role === "user" ? "历史问题 (正文未加载)" : "历史回答 (正文未加载)";
}
function material_labels(Messages: readonly ChatMessage[], Ids: Set<string>): HistoryMaterialLabel[]
{
	let Round = 0;
	const Result: HistoryMaterialLabel[] = [];
	for(const M of Messages)
	{
		if(M.Role === "user") { Round++; }
		if(!Ids.has(M.Id) || Result.length >= HistoryLedgerLimits.Labels) { continue; }
		const S = M.Context, Q = M.Quote;
		const Truncated = S?.Truncated || S?.SelectedTruncated || S?.ContextTruncated || Q?.SelectedTruncated || Q?.SourceTruncated;
		const Snapshot = !S && !Q ? "none" : Truncated ? "truncated" : S && S.SelectedTruncated !== undefined && S.ContextTruncated !== undefined && (!Q || !Q.SourceTruncated && !Q.SelectedTruncated) ? "complete" : "unknown";
		Result.push({ MessageId: M.Id, Label: message_label(M), Role: M.Role, ...(Round ? { Round } : {}), ...(M.CompletionStatus ? { Completion: M.CompletionStatus } : {}), Snapshot });
	}
	return Result;
}
export function same_ledger_identity(A: HistoryLedgerIdentity | undefined, B: HistoryLedgerIdentity | undefined): boolean
{
	return !!A && !!B && A.Scope === B.Scope && A.SessionId === B.SessionId && A.OperationId === B.OperationId;
}
/** Capture at actual input construction, not after a later history reload. */
export function capture_history_ledger(Ledger: HistoryInputLedger, Messages: readonly ChatMessage[], Identity: HistoryLedgerIdentity): HistoryMaterialLedger
{
	return { ...Ledger, Identity: { ...Identity }, MaterialLabels: material_labels(Messages, new Set([...Ledger.IncludedMessageIds, ...Ledger.OmittedMessageIds])) };
}
/** Call only from the host after an actual history read. Never copies the body. */
export function record_history_read(Ledger: HistoryInputLedger, Identity: HistoryLedgerIdentity, Args: unknown, Result: BackendHistoryResult, Messages: readonly ChatMessage[] = []): HistoryMaterialLedger
{
	const Stored = Ledger as HistoryMaterialLedger;
	if(!same_ledger_identity(Stored.Identity, Identity) || !Result.success || !Args || typeof Args !== "object") { return Stored; }
	const P = Args as Record<string, unknown>;
	if(P.command !== "read" || Result.contentItems.length !== 1 || Result.contentItems[0].type !== "inputText") { return Stored; }
	let R: any;
	try { R = JSON.parse(Result.contentItems[0].text); } catch { return Stored; }
	const Field = P.field ?? "text", From = P.offset ?? 0;
	if(R.version_kind !== "body" || R.session !== Identity.SessionId || R.message_id !== P.message_id || R.field !== Field || !["text", "prompt", "source", "quote_source"].includes(Field as string) || typeof R.text !== "string" || typeof R.version !== "string" || !R.version.startsWith("body:") || R.version.length > 128 || typeof R.source_version !== "string" || R.source_version.length > 128 || !R.source_version || R.offset !== From || !Number.isSafeInteger(From) || (From as number) < 0 || !Number.isSafeInteger(R.total_chars) || R.total_chars < 0 || R.text.length > 16000 || R.offset + R.text.length > R.total_chars || (P.version !== undefined && P.version !== R.version) || (P.source_version !== undefined && P.source_version !== R.source_version)) { return Stored; }
	const Record: HistoryReadRecord = { ...Identity, MessageId: R.message_id, Field: R.field, SourceVersion: R.source_version, BodyVersion: R.version, From: R.offset, To: R.offset + R.text.length, TotalChars: R.total_chars, Utf8Bytes: new TextEncoder().encode(R.text).byteLength };
	const Old = Stored.ReadRecords ?? [];
	if(Old.some(V => V.MessageId === Record.MessageId && V.Field === Record.Field && V.BodyVersion === Record.BodyVersion && V.From === Record.From && V.To === Record.To)) { return Stored; }
	if(Old.length >= HistoryLedgerLimits.Reads) { return { ...Stored, ReadRecordsTruncated: true }; }
	const Labels = Stored.MaterialLabels ?? [], Additional = Labels.some(V => V.MessageId === Record.MessageId) ? [] : material_labels(Messages, new Set([Record.MessageId]));
	return { ...Stored, ReadRecords: [...Old, Record], MaterialLabels: [...Labels, ...Additional].slice(0, HistoryLedgerLimits.Labels) };
}

function valid_read_record(Value: HistoryReadRecord, Identity: HistoryLedgerIdentity): boolean
{
	return !!Value && same_ledger_identity(Value, Identity) && typeof Value.MessageId === "string" && Value.MessageId.length > 0 && Value.MessageId.length <= 256 && ["text", "prompt", "source", "quote_source"].includes(Value.Field) && /^[0-9a-f]{16}$/.test(Value.SourceVersion) && /^body:[0-9a-f]{64}$/.test(Value.BodyVersion) && [Value.From, Value.To, Value.TotalChars, Value.Utf8Bytes].every(N => Number.isSafeInteger(N) && N >= 0) && Value.From <= Value.To && Value.To <= Value.TotalChars && Value.To - Value.From <= 16000 && Value.Utf8Bytes >= Value.To - Value.From && Value.Utf8Bytes <= 64000 && Object.keys(Value).every(K => ["Scope", "SessionId", "OperationId", "MessageId", "Field", "SourceVersion", "BodyVersion", "From", "To", "TotalChars", "Utf8Bytes"].includes(K));
}
/** Caller establishes a verified server version: newer, or the exact acknowledged version. */
export function merge_history_read_records(Local: HistoryInputLedger, Remote: HistoryInputLedger, Identity: HistoryLedgerIdentity): HistoryInputLedger | undefined
{
	if(!same_ledger_identity(Local.Identity, Identity) || !same_ledger_identity(Remote.Identity, Identity)) { return undefined; }
	const Plan = (Ledger: HistoryInputLedger) => { const { ReadRecords: _Reads, ReadRecordsTruncated: _Truncated, MaterialLabels: _Labels, ...Original } = Ledger; return canonical_json(Original); };
	if(Plan(Local) !== Plan(Remote)) { return undefined; }
	const LocalReads = Local.ReadRecords ?? [], RemoteReads = Remote.ReadRecords ?? [];
	if(!Array.isArray(LocalReads) || !Array.isArray(RemoteReads) || LocalReads.length > HistoryLedgerLimits.Reads || RemoteReads.length > HistoryLedgerLimits.Reads || [...LocalReads, ...RemoteReads].some(R => !valid_read_record(R, Identity))) { return undefined; }
	const Records = new Map<string, HistoryReadRecord>();
	for(const Record of [...LocalReads, ...RemoteReads])
	{
		const Key = canonical_json([Record.MessageId, Record.Field, Record.SourceVersion, Record.BodyVersion, Record.From, Record.To]), Existing = Records.get(Key);
		if(Existing && canonical_json(Existing) !== canonical_json(Record)) { return undefined; }
		Records.set(Key, Record);
	}
	if(!Records.size && !Remote.ReadRecordsTruncated) { return Local; }
	return { ...Local, ReadRecords: [...Records.values()].slice(0, HistoryLedgerLimits.Reads).map(R => ({ ...R })), ...((Local.ReadRecordsTruncated || Remote.ReadRecordsTruncated || Records.size > HistoryLedgerLimits.Reads) ? { ReadRecordsTruncated: true } : {}) };
}
