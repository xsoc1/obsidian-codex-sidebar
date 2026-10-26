import { canonical_json, content_digest, client_sync } from "../sync/types";
import { validate_outbox, type SendIntent } from "./outbox";
import type { StateFiles } from "./state-store";
import { message_deleted } from "../sessions";

interface PromotionBinding
{
	Id: string;
	SessionId: string;
	MessageId: string;
	LocalScope: string;
	Scope: string;
	RawIntentDigest: string;
	ScopedDigest: string;
}
interface ReceiptEvidence { Record: any; Checksum: string; }
interface LateReceipt extends ReceiptEvidence
{
	SchemaVersion: 1;
	Id: string;
	Digest: string;
	Promotion?: PromotionBinding;
	Conflicts?: ReceiptEvidence[];
}
const Terminal = (Status: string) => ["completed", "cancelled", "failed"].includes(Status);
const Scoped = (Record: any): boolean => typeof Record?.Scope === "string" && !!Record.Scope;
const SameInput = (A: any, B: any): boolean => A?.Id === B?.Id && A?.SessionId === B?.SessionId && A?.MessageId === B?.MessageId && canonical_json(A?.Input) === canonical_json(B?.Input);
async function receipt_path(Path: string, Id: string): Promise<string> { return Path + ".receipt-" + (await content_digest(Id)).slice(0, 32) + ".json"; }
async function scoped_digest(Record: any): Promise<string> { return content_digest({ Scope: Record.Scope, SessionId: Record.SessionId, MessageId: Record.MessageId, Input: Record.Input }); }
async function validate_record(Record: any): Promise<void>
{
	if(!Record || ![Record.Id, Record.Digest, Record.SessionId, Record.MessageId].every(V => typeof V === "string" && !!V) || !["local", "received", "submission-unknown", "running", "completed", "cancelled", "failed"].includes(Record.Status)) { throw new Error("迟到操作身份或状态不完整, 原记录保留"); }
	const Digest = Scoped(Record) ? await scoped_digest(Record) : await content_digest(Record.Input);
	if(Record.Digest !== Digest) { throw new Error("迟到操作输入摘要不符, 原记录保留"); }
	if(!Scoped(Record)) { validate_outbox([Record]); }
}
async function validate_promotion(Binding: PromotionBinding, Record: any, Intent?: any): Promise<void>
{
	if(!Binding || Object.keys(Binding).some(Key => !["Id", "SessionId", "MessageId", "LocalScope", "Scope", "RawIntentDigest", "ScopedDigest"].includes(Key)) || ![Binding.Id, Binding.SessionId, Binding.MessageId, Binding.LocalScope, Binding.Scope].every(V => typeof V === "string" && !!V) || !Scoped(Record) || Binding.Id !== Record.Id || Binding.SessionId !== Record.SessionId || Binding.MessageId !== Record.MessageId || Binding.Scope !== Record.Scope || Binding.ScopedDigest !== Record.Digest || Binding.ScopedDigest !== await scoped_digest(Record) || Binding.RawIntentDigest !== await content_digest(Record.Input)) { throw new Error("迟到操作晋升绑定无效, 未放宽身份校验"); }
	if(Intent)
	{
		validate_outbox([Intent]);
		if(Scoped(Intent) || !SameInput(Intent, Record) || Intent.LocalScope !== Binding.LocalScope || Intent.Digest !== Binding.RawIntentDigest || Intent.Digest !== await content_digest(Intent.Input)) { throw new Error("迟到操作与原待发送输入/设备作用域不一致, 原记录保留"); }
	}
}
async function promotion_binding(Record: any, Intent?: SendIntent): Promise<PromotionBinding | undefined>
{
	if(!Intent || !Scoped(Record)) { return undefined; }
	const Binding = { Id: Record.Id, SessionId: Record.SessionId, MessageId: Record.MessageId, LocalScope: Intent.LocalScope, Scope: Record.Scope, RawIntentDigest: Intent.Digest, ScopedDigest: Record.Digest };
	await validate_promotion(Binding, Record, Intent); return Binding;
}
async function validate_related(Other: any, Record: any, Binding?: PromotionBinding): Promise<void>
{
	await validate_record(Other);
	if(!SameInput(Other, Record)) { throw new Error("迟到凭证身份冲突, 保留原凭证"); }
	if(Other.Scope === Record.Scope && Other.Digest === Record.Digest && Other.LocalScope === Record.LocalScope) { return; }
	if(Binding && Scoped(Record) && !Scoped(Other)) { await validate_promotion(Binding, Record, Other); return; }
	throw new Error("迟到凭证作用域或摘要冲突, 保留原凭证");
}
async function validate_receipt(Value: LateReceipt): Promise<void>
{
	if(!Value || Value.SchemaVersion !== 1 || Value.Id !== Value.Record?.Id || Value.Digest !== Value.Record?.Digest || Value.Checksum !== await content_digest(Value.Record) || (Value.Conflicts !== undefined && !Array.isArray(Value.Conflicts))) { throw new Error("迟到凭证格式或校验和无效, 原数据保留"); }
	await validate_record(Value.Record); if(Value.Promotion) { await validate_promotion(Value.Promotion, Value.Record); }
	for(const Evidence of Value.Conflicts ?? [])
	{
		if(!Evidence || Evidence.Checksum !== await content_digest(Evidence.Record)) { throw new Error("迟到冲突证据校验失败, 原数据保留"); }
		await validate_related(Evidence.Record, Value.Record, Value.Promotion);
	}
}
const Queues = new WeakMap<StateFiles, Map<string, Promise<void>>>();
export async function write_late_receipt(Files: StateFiles, Path: string, Record: any, Intent?: SendIntent): Promise<void>
{
	const Copy = structuredClone(Record), Binding = await promotion_binding(Copy, Intent); await validate_record(Copy);
	const File = await receipt_path(Path, Copy.Id);
	if(!Queues.has(Files)) { Queues.set(Files, new Map()); } const Queue = Queues.get(Files)!;
	const Work = (Queue.get(File) ?? Promise.resolve()).catch(() => {}).then(async () =>
	{
		let Value = Copy, Promotion = Binding; const Conflicts: ReceiptEvidence[] = [];
		const Keep = async (V: any) => { const Checksum = await content_digest(V); if(!Conflicts.some(E => E.Checksum === Checksum && canonical_json(E.Record) === canonical_json(V))) { Conflicts.push({ Record: structuredClone(V), Checksum }); } };
		if(await Files.exists(File))
		{
			const Old: LateReceipt = JSON.parse(await Files.read(File)); await validate_receipt(Old);
			Promotion ??= Old.Promotion;
			if(Binding && Old.Promotion && canonical_json(Binding) !== canonical_json(Old.Promotion)) { throw new Error("迟到操作晋升凭证冲突, 保留原绑定"); }
			if(Scoped(Old.Record) && !Scoped(Copy)) { await validate_related(Copy, Old.Record, Promotion); }
			else { await validate_related(Old.Record, Copy, Promotion); }
			for(const Evidence of Old.Conflicts ?? []) { await Keep(Evidence.Record); }
			const DifferentTerminal = Terminal(Old.Record.Status) && Terminal(Copy.Status) && Old.Record.Status !== Copy.Status;
			const DifferentTurn = !!Old.Record.TurnId && !!Copy.TurnId && Old.Record.TurnId !== Copy.TurnId;
			if(Scoped(Old.Record) && !Scoped(Copy))
			{
				Value = Old.Record;
				if(Terminal(Copy.Status)) { await Keep(Copy); }
			}
			else if(!Scoped(Old.Record) && Scoped(Copy))
			{
				Value = Copy;
				if(Terminal(Old.Record.Status)) { await Keep(Old.Record); }
			}
			else if(DifferentTerminal || DifferentTurn) { Value = Old.Record; await Keep(Copy); }
			else
			{
				Value = { ...Old.Record }; for(const [K, V] of Object.entries(Copy)) { if(V !== undefined) { Value[K] = V; } }
				if(Terminal(Old.Record.Status) && !Terminal(Copy.Status)) { Value.Status = Old.Record.Status; }
			}
		}
		const Data: LateReceipt = { SchemaVersion: 1, Id: Value.Id, Digest: Value.Digest, Record: Value, Checksum: await content_digest(Value), ...(Promotion ? { Promotion } : {}), ...(Conflicts.length ? { Conflicts } : {}) };
		await validate_receipt(Data); const Raw = JSON.stringify(Data); await Files.write(File, Raw);
		if(await Files.read(File) !== Raw) { throw new Error("迟到凭证读回不一致, 未冒称保存成功"); }
	}); Queue.set(File, Work); return Work;
}
export async function apply_late_receipts(Files: StateFiles, Path: string, State: any): Promise<boolean>
{
	let Changed = false;
	const Conflict = (Local: any, Remote: any, Reason: string) =>
	{
		const C = { Key: JSON.stringify(["operation", Local.Id]), Reason, Local: structuredClone(Local), Remote: structuredClone(Remote) };
		const Values = State.Sync?.Conflicts ?? (State.MessageConflicts ??= []);
		if(!Values.some((V: any) => canonical_json(V) === canonical_json(C))) { Values.push(C); Changed = true; }
	};
	const BoundIds = new Set((State.Sync?.Operations ?? []).map((O: any) => O.Id));
	for(let Original of [...(State.Sync?.Operations ?? []), ...(State.Outbox ?? []).filter((I: any) => !BoundIds.has(I.Id))])
	{
		const File = await receipt_path(Path, Original.Id); if(!await Files.exists(File)) { continue; }
		const Receipt: LateReceipt = JSON.parse(await Files.read(File)), R = Receipt.Record; await validate_receipt(Receipt);
		if(Receipt.Id !== Original.Id) { throw new Error("迟到凭证与原操作身份不同, 原数据保留"); }
		await validate_related(Original, R, Receipt.Promotion);
		if(!Scoped(Original) && Scoped(R))
		{
			await validate_promotion(Receipt.Promotion!, R, Original);
			if(State.Sync && State.Sync.Scope !== R.Scope) { throw new Error("迟到操作不能晋升到另一个连接作用域, 原意图保留"); }
			State.Sync ??= client_sync(R.Scope);
			if(Terminal(Original.Status) && Original.Status !== R.Status) { Conflict(Original, R, "准备终态与迟到服务端凭证不同, 保留双方供核对"); }
			const Bound = structuredClone(R); State.Sync.Operations.push(Bound); State.Outbox = State.Outbox.filter((I: any) => I.Id !== Original.Id); Original = Bound; Changed = true;
		}
		for(const Evidence of Receipt.Conflicts ?? []) { Conflict(R, Evidence.Record, "同一操作存在不同迟到结果, 两份原始凭证均保留供核对"); }
		if(Terminal(Original.Status) && Terminal(R.Status) && Original.Status !== R.Status)
		{
			Conflict(Original, R, "迟到操作终态与本机终态不同, 保留双方供核对"); continue;
		}
		if(Original.TurnId && R.TurnId && Original.TurnId !== R.TurnId) { Conflict(Original, R, "同一操作出现不同回合ID, 未覆盖原回合"); continue; }
		const Merged = { ...Original, ...structuredClone(R) };
		if(!(Terminal(Original.Status) && !Terminal(R.Status)) && canonical_json(Original) !== canonical_json(Merged)) { Object.assign(Original, Merged); Changed = true; }
		const Session = State.Sessions.find((S: any) => S.Id === R.SessionId), Message = Session?.Messages.find((M: any) => M.Id === R.MessageId);
		if(!Session || State.DeletedSessionIds?.includes(R.SessionId)) { if(!Original.SessionDeleted) { Original.SessionDeleted = true; Changed = true; } continue; }
		if(message_deleted(State, R.SessionId, R.MessageId)) { if(!Original.MessageDeleted) { Original.MessageDeleted = true; Changed = true; } continue; }
		if(Message && R.TurnId && !Message.TurnId) { Message.TurnId = R.TurnId; Changed = true; }
	}
	return Changed;
}
