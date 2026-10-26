import type { ChatMessage } from "./history";
import type { TokenUsage } from "./controls";

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
}

export function new_session(Title = "新会话"): ChatSession { return { Id: crypto.randomUUID(), Title, ThreadId: null, Messages: [] }; }
export function session_stamp(Session: ChatSession): string { return JSON.stringify([Session.Id, Session.Title, Session.Messages]); }
export function deleted_session_ids(Value: unknown): string[]
{
	if(Value === undefined) { return []; }
	if(!Array.isArray(Value) || Value.some(Id => typeof Id !== "string" || !Id || Id.length > 128 || Id !== Id.trim())) { throw new Error("会话删除标记损坏, 原数据保留"); }
	return [...new Set(Value)];
}
export function prune_sessions<T extends SessionState>(State: T, Extra: unknown = undefined): T & SessionState
{
	const Deleted = [...new Set([...deleted_session_ids(State.DeletedSessionIds), ...deleted_session_ids(Extra)])], Ids = new Set(Deleted);
	const Sessions = State.Sessions.filter(Session => !Ids.has(Session.Id));
	if(!Sessions.length) { Sessions.push(new_session()); }
	const Next = { ...State, Sessions, ActiveId: Sessions.some(Session => Session.Id === State.ActiveId) ? State.ActiveId : Sessions.at(-1)!.Id };
	if(Deleted.length) { Next.DeletedSessionIds = Deleted; } else { delete Next.DeletedSessionIds; }
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
	return { State: { ...State, Sessions, ActiveId, DeletedSessionIds: [...new Set([...deleted_session_ids(State.DeletedSessionIds), Id])] }, ReplacementId: Replacement?.Id };
}
export function restore_sessions<T extends SessionState>(Local: T, Remote: T, Linked: readonly string[], FollowLocal: boolean): T & SessionState
{
	const Deleted = [...new Set([...deleted_session_ids(Local.DeletedSessionIds), ...deleted_session_ids(Remote.DeletedSessionIds)])], Ids = new Set(Deleted), Keep = new Set(Linked);
	const Sessions = Remote.Sessions.filter(Session => !Ids.has(Session.Id));
	const RemoteActiveDeleted = Ids.has(Remote.ActiveId);
	for(const Session of Local.Sessions)
	{
		if(!Ids.has(Session.Id) && (Keep.has(Session.Id) || (RemoteActiveDeleted && Session.Id === Local.ActiveId)) && !Sessions.some(Value => Value.Id === Session.Id)) { Sessions.push(Session); }
	}
	const UseLocal = Sessions.some(Value => Value.Id === Local.ActiveId) && ((FollowLocal && Keep.has(Local.ActiveId)) || RemoteActiveDeleted);
	return prune_sessions({ ...Remote, Sessions, ActiveId: UseLocal ? Local.ActiveId : Remote.ActiveId, ...(Deleted.length ? { DeletedSessionIds: Deleted } : {}) });
}
