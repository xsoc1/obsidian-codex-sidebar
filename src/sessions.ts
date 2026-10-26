import type { ChatMessage } from "./history";
import type { TokenUsage } from "./controls";
import { canonical_json, type ClientSync, type EntityVersion, type SyncConflict, type DeletedMessage } from "./sync/types";
import { merge_operations } from "./sync/operations";

export interface ChatSession
{
	Id: string;
	Title: string;
	ThreadId: string | null;
	Messages: ChatMessage[];
	Usage?: TokenUsage;
	EffectiveModel?: string;
	EffectiveEffort?: string;
	EffectiveTier?: string;
	InstructionsHash?: string;
	Private?: boolean;
	LegacyThreadId?: string;
	ParentId?: string;
}
export interface SessionState
{
	Sessions: ChatSession[];
	ActiveId: string;
	DeletedSessionIds?: string[];
	DeletedMessages?: DeletedMessage[];
	Sync?: ClientSync;
	MessageConflicts?: SyncConflict[];
}

export function new_session(Title = "新会话"): ChatSession { return { Id: crypto.randomUUID(), Title, ThreadId: null, Messages: [] }; }
export function session_stamp(Session: ChatSession): string { return JSON.stringify([Session.Id, Session.Title, Session.Messages]); }
export function deleted_session_ids(Value: unknown): string[]
{
	if(Value === undefined) { return []; }
	if(!Array.isArray(Value) || Value.some(Id => typeof Id !== "string" || !Id || Id.length > 128 || Id !== Id.trim())) { throw new Error("会话删除标记损坏, 原数据保留"); }
	return [...new Set(Value)];
}
export function deleted_messages(Value: unknown): DeletedMessage[]
{
	if(Value === undefined) { return []; }
	if(!Array.isArray(Value) || Value.some(V => !V || typeof V !== "object" || Object.keys(V).some(K => !["SessionId", "MessageId"].includes(K)) || [V.SessionId, V.MessageId].some(Id => typeof Id !== "string" || !Id || Id.length > 256 || Id !== Id.trim() || /[\u0000-\u001f]/.test(Id)))) { throw new Error("消息删除标记损坏, 原数据保留"); }
	return [...new Map(Value.map(V => [JSON.stringify([V.SessionId, V.MessageId]), { SessionId: V.SessionId, MessageId: V.MessageId }])).values()];
}
export function message_deleted(State: Pick<SessionState, "DeletedMessages">, SessionId: string, MessageId: string): boolean { return deleted_messages(State.DeletedMessages).some(M => M.SessionId === SessionId && M.MessageId === MessageId); }
export function prune_sessions<T extends SessionState>(State: T, Extra: unknown = undefined): T & SessionState
{
	const Deleted = [...new Set([...deleted_session_ids(State.DeletedSessionIds), ...deleted_session_ids(Extra)])], Ids = new Set(Deleted);
	const DeletedMessages = deleted_messages(State.DeletedMessages), Keys = new Set(DeletedMessages.map(M => JSON.stringify([M.SessionId, M.MessageId])));
	const Sessions = State.Sessions.filter(Session => !Ids.has(Session.Id)).map(Session => { const Messages = Session.Messages.filter(M => !Keys.has(JSON.stringify([Session.Id, M.Id]))); return Messages.length === Session.Messages.length ? Session : { ...Session, Messages }; });
	if(!Sessions.length) { Sessions.push(new_session()); }
	const Next = { ...State, Sessions, ActiveId: Sessions.some(Session => Session.Id === State.ActiveId) ? State.ActiveId : Sessions.at(-1)!.Id };
	if(Deleted.length) { Next.DeletedSessionIds = Deleted; } else { delete Next.DeletedSessionIds; }
	if(DeletedMessages.length)
	{
		Next.DeletedMessages = DeletedMessages;
		if(Next.Sync) { Next.Sync = structuredClone(Next.Sync); for(const O of Next.Sync.Operations) { if(Keys.has(JSON.stringify([O.SessionId, O.MessageId]))) { O.MessageDeleted = true; if(["local", "received"].includes(O.Status)) { O.Status = "cancelled"; } } } }
	}
	else { delete Next.DeletedMessages; }
	return Next;
}
export function delete_session_plan<T extends SessionState>(State: T, Id: string, Stamp: string, FreshTitle?: string, PreferredId?: string): { State: T & SessionState; ReplacementId?: string }
{
	const Session = State.Sessions.find(Value => Value.Id === Id);
	if(!Session) { throw new Error("会话已不存在, 不重复删除"); }
	if(session_stamp(Session) !== Stamp) { throw new Error("会话内容已变化, 请重新打开删除确认"); }
	const Sessions = State.Sessions.filter(Value => Value.Id !== Id);
	let Replacement: ChatSession | undefined;
	if(!Sessions.length || (State.ActiveId === Id && FreshTitle !== undefined)) { Replacement = new_session(FreshTitle); Sessions.push(Replacement); }
	const ActiveId = State.ActiveId !== Id ? State.ActiveId : Replacement?.Id ?? Sessions.find(Value => Value.Id === PreferredId)?.Id ?? Sessions.at(-1)!.Id;
	const Sync = State.Sync ? structuredClone(State.Sync) : undefined;
	for(const Operation of Sync?.Operations ?? []) { if(Operation.SessionId === Id) { Operation.SessionDeleted = true; if(Operation.Status === "local" || Operation.Status === "received") { Operation.Status = "cancelled"; } } }
	return { State: { ...State, Sessions, ActiveId, DeletedSessionIds: [...new Set([...deleted_session_ids(State.DeletedSessionIds), Id])], ...(Sync ? { Sync } : {}) }, ReplacementId: Replacement?.Id };
}
function merge_message(Local: ChatMessage, Remote: ChatMessage, SessionId: string, Conflicts: SyncConflict[]): ChatMessage
{
	if(canonical_json(Local) === canonical_json(Remote)) { return structuredClone(Local); }
	const L = (Local as ChatMessage & { SyncVersion?: EntityVersion }).SyncVersion, R = (Remote as ChatMessage & { SyncVersion?: EntityVersion }).SyncVersion;
	const Immutable = (M: ChatMessage) => canonical_json({ Role: M.Role, Text: M.Role === "user" ? M.Text : undefined, Prompt: M.Prompt, Context: M.Context, Quote: M.Quote, Task: M.Task, OperationId: (M as any).OperationId });
	if(Local.Role === "user" && Immutable(Local) === Immutable(Remote)) { return { ...Remote, ...Local, ...(Remote.TurnId && !Local.TurnId ? { TurnId: Remote.TurnId } : {}), ...(Remote.CompletionStatus && !Local.CompletionStatus ? { CompletionStatus: Remote.CompletionStatus } : {}) }; }
	if(Local.Role !== "user" && Local.TurnId && Local.TurnId === Remote.TurnId)
	{
		if(L && R && L.Origin === R.Origin && L.Revision !== R.Revision) { return structuredClone(L.Revision > R.Revision ? Local : Remote); }
		if(Local.CompletionStatus === "completed" && !Remote.CompletionStatus) { return structuredClone(Local); }
		if(Remote.CompletionStatus === "completed" && !Local.CompletionStatus) { return structuredClone(Remote); }
	}
	const Conflict = { Key: JSON.stringify([SessionId, Local.Id]), Reason: "同一消息 ID 的内容版本不能确定, 保留本机与远端双方", Local: structuredClone(Local), Remote: structuredClone(Remote) };
	if(!Conflicts.some(C => canonical_json(C) === canonical_json(Conflict))) { Conflicts.push(Conflict); }
	return structuredClone(Local);
}
export function restore_sessions<T extends SessionState>(Local: T, Remote: T, Linked: readonly string[], FollowLocal: boolean): T & SessionState
{
	const Deleted = [...new Set([...deleted_session_ids(Local.DeletedSessionIds), ...deleted_session_ids(Remote.DeletedSessionIds)])], Ids = new Set(Deleted), Keep = new Set(Linked);
	const DeletedMessages = deleted_messages([...deleted_messages(Local.DeletedMessages), ...deleted_messages(Remote.DeletedMessages)]), MessageKeys = new Set(DeletedMessages.map(M => JSON.stringify([M.SessionId, M.MessageId])));
	if(Local.Sync && Remote.Sync && Local.Sync.Scope !== Remote.Sync.Scope) { throw new Error("连接作用域不同, 不合并聊天数据"); }
	const Conflicts = structuredClone([...(Local.Sync?.Conflicts ?? Local.MessageConflicts ?? []), ...(Remote.Sync?.Conflicts ?? Remote.MessageConflicts ?? [])]);
	const Sessions = Local.Sessions.filter(Session => !Ids.has(Session.Id)).map(Session => ({ ...structuredClone(Session), Messages: structuredClone(Session.Messages.filter(M => !MessageKeys.has(JSON.stringify([Session.Id, M.Id])))) }));
	for(const R of Remote.Sessions.filter(Session => !Ids.has(Session.Id)))
	{
		const L = Sessions.find(S => S.Id === R.Id);
		if(!L) { Sessions.push({ ...structuredClone(R), Messages: structuredClone(R.Messages.filter(M => !MessageKeys.has(JSON.stringify([R.Id, M.Id])))) }); continue; }
		for(const M of R.Messages)
		{
			if(MessageKeys.has(JSON.stringify([R.Id, M.Id]))) { continue; }
			const Index = L.Messages.findIndex(P => P.Id === M.Id);
			if(Index < 0) { L.Messages.push(structuredClone(M)); } else { L.Messages[Index] = merge_message(L.Messages[Index], M, L.Id, Conflicts); }
		}
		for(const [Key, Value] of Object.entries(R)) { if(Key !== "Messages" && (L as any)[Key] === undefined) { (L as any)[Key] = structuredClone(Value); } }
	}
	const RemoteActiveDeleted = Ids.has(Remote.ActiveId);
	for(const Session of Local.Sessions)
	{
		if(!Ids.has(Session.Id) && (Keep.has(Session.Id) || (RemoteActiveDeleted && Session.Id === Local.ActiveId)) && !Sessions.some(Value => Value.Id === Session.Id)) { Sessions.push(Session); }
	}
	const UseLocal = Sessions.some(Value => Value.Id === Local.ActiveId) && ((FollowLocal && Keep.has(Local.ActiveId)) || RemoteActiveDeleted);
	const Sync = Local.Sync || Remote.Sync ? { ...structuredClone(Remote.Sync ?? Local.Sync!), ...structuredClone(Local.Sync ?? {}), Operations: merge_operations(Local.Sync?.Operations, Remote.Sync?.Operations, Conflicts), Conflicts } : undefined;
	return prune_sessions({ ...Remote, ...("Settings" in Local ? { Settings: (Local as any).Settings } : {}), Sessions, ActiveId: UseLocal || Sessions.some(S => S.Id === Local.ActiveId) ? Local.ActiveId : Remote.ActiveId, ...(Deleted.length ? { DeletedSessionIds: Deleted } : {}), ...(DeletedMessages.length ? { DeletedMessages } : {}), ...(Sync ? { Sync } : Conflicts.length ? { MessageConflicts: Conflicts } : {}) });
}
