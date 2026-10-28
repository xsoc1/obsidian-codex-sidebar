import { canonical_json, client_sync, content_digest, type ClientSync, type OperationStatus, type SendOperation, type SyncConflict } from "./types";

const terminal = (Status: OperationStatus): boolean => ["completed", "cancelled", "failed"].includes(Status);
function conflict(Local: SendOperation, Remote: SendOperation, Reason: string, Conflicts?: SyncConflict[]): void
{
	const { Conflicts: _L, ...L } = Local, { Conflicts: _R, ...R } = Remote;
	const Value = { Key: JSON.stringify(["operation", Local.Id]), Reason, Local: structuredClone(L), Remote: structuredClone(R) };
	Local.Conflicts ??= []; for(const List of [Local.Conflicts, Conflicts].filter(Boolean) as SyncConflict[][]) { if(!List.some(C => canonical_json(C) === canonical_json(Value))) { List.push(structuredClone(Value)); } }
}

export async function create_send_operation(Scope: string, SessionId: string, MessageId: string, Input: unknown, Id: string = crypto.randomUUID()): Promise<SendOperation>
{
	if(!Scope || !SessionId || !MessageId || !Id) { throw new Error("发送操作身份缺失"); }
	return { Id, Scope, SessionId, MessageId, Input: structuredClone(Input), Digest: await content_digest({ Scope, SessionId, MessageId, Input }), Status: "local", Attempted: false };
}
export function update_operation(Sync: ClientSync, Id: string, Status: OperationStatus, Details: Partial<SendOperation> = {}): SendOperation
{
	const Operation = Sync.Operations.find(O => O.Id === Id);
	if(!Operation) { throw new Error("发送操作记录缺失, 不创建替代请求"); }
	for(const Key of ["Id", "Scope", "SessionId", "MessageId", "Digest", "Input"] as const)
	{
		if(Details[Key] !== undefined && canonical_json(Details[Key]) !== canonical_json(Operation[Key])) { conflict(Operation, { ...Operation, ...Details, Status }, "更新试图改写发送操作的不可变输入, 保留双方但不应用", Sync.Conflicts); return Operation; }
	}
	if(terminal(Operation.Status) && terminal(Status) && Operation.Status !== Status) { conflict(Operation, { ...Operation, ...Details, Status }, "同一发送操作出现不同终态, 保留双方供核对", Sync.Conflicts); return Operation; }
	if(Operation.TurnId && Details.TurnId && Operation.TurnId !== Details.TurnId) { conflict(Operation, { ...Operation, ...Details, Status }, "同一发送操作出现不同回合身份, 不自动替换", Sync.Conflicts); return Operation; }
	if(terminal(Operation.Status) && !terminal(Status)) { return Operation; }
	Object.assign(Operation, Details, { Status }); return Operation;
}
export function ensure_sync(State: { Sync?: ClientSync }, Scope: string): ClientSync
{
	if(State.Sync && State.Sync.Scope !== Scope) { throw new Error("同步数据属于其他连接作用域, 未合并"); }
	State.Sync ??= client_sync(Scope); return State.Sync;
}
export function merge_operations(Local: SendOperation[] = [], Remote: SendOperation[] = [], Conflicts?: SyncConflict[]): SendOperation[]
{
	const Result = structuredClone(Local);
	for(const R of Remote)
	{
		const L = Result.find(O => O.Id === R.Id);
		if(!L) { Result.push(structuredClone(R)); continue; }
		if(L.Scope !== R.Scope || L.Digest !== R.Digest || !L.Evidence && !R.Evidence && canonical_json(L.Input) !== canonical_json(R.Input) || L.SessionId !== R.SessionId || L.MessageId !== R.MessageId || L.RequestDigest && R.RequestDigest && L.RequestDigest !== R.RequestDigest || L.Request && R.Request && canonical_json(L.Request) !== canonical_json(R.Request)) { conflict(L, R, "相同操作 ID 的不可变输入或作用域不同, 未合并或重发", Conflicts); continue; }
		if(terminal(L.Status) && terminal(R.Status) && L.Status !== R.Status) { conflict(L, R, "同一发送操作出现不同终态, 保留双方供核对", Conflicts); continue; }
		if(L.TurnId && R.TurnId && L.TurnId !== R.TurnId) { conflict(L, R, "同一发送操作出现不同回合身份, 不自动替换", Conflicts); continue; }
		const ExistingConflicts = [...(L.Conflicts ?? []), ...(R.Conflicts ?? [])], Attempted = L.Attempted || R.Attempted, Deleted = L.SessionDeleted || R.SessionDeleted, MessageDeleted = L.MessageDeleted || R.MessageDeleted;
		const Rank: Record<OperationStatus, number> = { local: 0, received: 1, "submission-unknown": 2, running: 3, completed: 4, cancelled: 4, failed: 4 };
		const Comparable = L.Origin === L.Scope && R.Origin === L.Scope && L.Revision !== undefined && R.Revision !== undefined;
		const Hydrated = !L.Evidence ? { Input: L.Input, Request: L.Request, Result: L.Result, Conflicts: L.Conflicts } : !R.Evidence ? { Input: R.Input, Request: R.Request, Result: R.Result, Conflicts: R.Conflicts } : null;
		if(!terminal(L.Status) && Comparable ? R.Revision! > L.Revision! : Rank[R.Status] > Rank[L.Status] || Rank[R.Status] === Rank[L.Status] && R.Status === L.Status) { Object.assign(L, structuredClone(R)); }
		if(Hydrated) { for(const [Key, Value] of Object.entries(Hydrated)) { if(Value !== undefined && (L as any)[Key] === undefined) { (L as any)[Key] = structuredClone(Value); } } if(L.Input !== undefined) { delete L.Evidence; } }
		if(Attempted) { L.Attempted = true; } if(Deleted) { L.SessionDeleted = true; } if(MessageDeleted) { L.MessageDeleted = true; }
		if(ExistingConflicts.length) { L.Conflicts = [...new Map(ExistingConflicts.map(C => [canonical_json(C), C])).values()]; for(const C of L.Conflicts) { if(Conflicts && !Conflicts.some(P => canonical_json(P) === canonical_json(C))) { Conflicts.push(structuredClone(C)); } } }
	}
	return Result;
}
