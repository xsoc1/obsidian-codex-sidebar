import { canonical_json, content_digest, type ConflictResolution, type SyncConflict } from "./types";
import type { SessionState } from "../sessions";

function normalized_key(Key: string): string
{
	try { const P = JSON.parse(Key); if(Array.isArray(P) && P.length === 2 && P.every(V => typeof V === "string" && V)) { return canonical_json(["message", ...P]); } } catch { }
	return Key;
}
export function conflict_evidence_key(C: SyncConflict): string
{
	return canonical_json([normalized_key(C.Key), C.Local, C.Remote]);
}
export function merge_conflict_resolutions(Scope: string, ...Lists: (readonly ConflictResolution[] | undefined)[]): ConflictResolution[]
{
	const All = new Map<string, ConflictResolution>();
	for(const List of Lists)
	{
		if(List !== undefined && !Array.isArray(List)) { throw new Error("冲突决议集合无效, 保留原数据"); }
		for(const R of List ?? [])
		{
			if(!R || ![1, 2].includes(R.SchemaVersion) || R.Scope !== Scope || typeof R.Id !== "string" || !R.Id || R.Id.length > 256 || !/^[0-9a-f]{64}$/.test(R.ConflictId) || !R.Conflict || typeof R.Conflict.Key !== "string" || !("Local" in R.Conflict) || !("Remote" in R.Conflict) || !["local", "remote"].includes(R.Choice)) { throw new Error("冲突决议版本或作用域无效, 保留原数据"); }
			if(R.SchemaVersion === 1 && R.Supersedes !== undefined || R.SchemaVersion === 2 && (!Array.isArray(R.Supersedes) || R.Supersedes.some((Id: unknown) => typeof Id !== "string" || !Id) || new Set(R.Supersedes).size !== R.Supersedes.length)) { throw new Error("冲突裁定父引用无效, 旧记录不补造因果"); }
			const Previous = All.get(R.Id);
			if(Previous && canonical_json(Previous) !== canonical_json(R)) { throw new Error("同一冲突决议 ID 对应不同内容, 保留双方并拒绝裁定"); }
			All.set(R.Id, structuredClone(R));
		}
	}
	const Children = new Map<string, string[]>(), Degrees = new Map<string, number>();
	for(const R of All.values())
	{
		Degrees.set(R.Id, R.Supersedes?.length ?? 0);
		for(const Id of R.Supersedes ?? [])
		{
			const Parent = All.get(Id);
			if(!Parent || Parent.Scope !== R.Scope || Parent.ConflictId !== R.ConflictId || conflict_evidence_key(Parent.Conflict) !== conflict_evidence_key(R.Conflict)) { throw new Error("冲突裁定缺父或跨作用域/证据引用, 不隐藏冲突"); }
			if(!Children.has(Id)) { Children.set(Id, []); } Children.get(Id)!.push(R.Id);
		}
	}
	const Ready = [...Degrees].filter(([, N]) => N === 0).map(([Id]) => Id); let Count = 0;
	for(let I = 0; I < Ready.length; I++)
	{
		Count++; for(const Child of Children.get(Ready[I]) ?? []) { Degrees.set(Child, Degrees.get(Child)! - 1); if(Degrees.get(Child) === 0) { Ready.push(Child); } }
	}
	if(Count !== All.size) { throw new Error("冲突裁定因果引用成环, 不隐藏冲突"); }
	return [...All.values()];
}
export function effective_conflict_resolutions(Values: readonly ConflictResolution[] = []): ConflictResolution[]
{
	if(!Values.length) { return []; }
	const All = merge_conflict_resolutions(Values[0].Scope, Values), Replaced = new Set(All.flatMap(R => R.Supersedes ?? []));
	return All.filter(R => !Replaced.has(R.Id));
}
export function resolution_set_signature(Scope: string, Conflict: SyncConflict, Values: readonly ConflictResolution[] = []): string
{
	return canonical_json(merge_conflict_resolutions(Scope, Values).filter(R => normalized_key(R.Conflict.Key) === normalized_key(Conflict.Key)).map(R => [R.Id, canonical_json(R)]).sort(([A], [B]) => A.localeCompare(B)));
}
export function assert_resolution_fresh(Scope: string, Conflict: SyncConflict, Values: readonly ConflictResolution[], Expected: string): void
{
	if(resolution_set_signature(Scope, Conflict, Values) !== Expected) { throw new Error("有效冲突决议集合已变化, 请重新核对并裁定"); }
}
export function require_conflict_finalization(Capabilities: any): void
{
	if(Capabilities?.conflictFinalization !== 1) { throw new Error("当前桥未声明 conflictFinalization:1, 不支持因果最终裁定写入; 请保留证据并在获准升级桥后重试"); }
}
export async function prepare_conflict_resolution(Scope: string, Conflict: SyncConflict, Choice: "local" | "remote", Resolutions?: readonly ConflictResolution[]): Promise<ConflictResolution>
{
	if(!Scope || !["local", "remote"].includes(Choice)) { throw new Error("冲突决议作用域或选择无效"); }
	const Evidence = structuredClone(Conflict), Observed = structuredClone(Resolutions ?? []);
	await verify_conflict_resolutions(Scope, Observed);
	const ConflictId = await content_digest([Scope, conflict_evidence_key(Evidence)]);
	return { SchemaVersion: Resolutions === undefined ? 1 : 2, Id: crypto.randomUUID(), Scope, ConflictId, Conflict: Evidence, Choice, ...(Resolutions === undefined ? {} : { Supersedes: effective_conflict_resolutions(Observed).filter(R => R.ConflictId === ConflictId).map(R => R.Id).sort() }) };
}
export async function verify_conflict_resolutions(Scope: string, Values: readonly ConflictResolution[] = []): Promise<void>
{
	const All = merge_conflict_resolutions(Scope, Values);
	for(const R of All) { if(R.ConflictId !== await content_digest([Scope, conflict_evidence_key(R.Conflict)])) { throw new Error("冲突决议摘要与双方版本证据不符, 不隐藏冲突"); } }
}
export function apply_conflict_resolution<T extends SessionState>(State: T, Resolution: ConflictResolution, ExpectedSignature: string, ExpectedMessage: string): T
{
	if(State.Sync && State.Sync.Scope !== Resolution.Scope) { throw new Error("冲突裁定作用域已变化"); }
	assert_resolution_fresh(Resolution.Scope, Resolution.Conflict, State.Sync?.Resolutions ?? [], ExpectedSignature);
	if(Resolution.SchemaVersion === 2)
	{
		const Parents = effective_conflict_resolutions(State.Sync?.Resolutions).filter(R => R.ConflictId === Resolution.ConflictId).map(R => R.Id).sort();
		if(canonical_json(Parents) !== canonical_json([...(Resolution.Supersedes ?? [])].sort())) { throw new Error("最终裁定未覆盖当前确切有效决议, 请重新核对"); }
	}
	const Parts = JSON.parse(normalized_key(Resolution.Conflict.Key));
	if(!Array.isArray(Parts) || Parts.length !== 3 || Parts[0] !== "message" || Parts.slice(1).some(V => typeof V !== "string" || !V)) { throw new Error("冲突不是唯一消息目标"); }
	const [, SessionId, MessageId] = Parts, Session = State.Sessions.filter(S => S.Id === SessionId);
	const Matches = Session.length === 1 ? Session[0].Messages.filter(M => M.Id === MessageId) : [];
	if(Matches.length !== 1 || canonical_json(Matches[0]) !== ExpectedMessage || State.DeletedSessionIds?.includes(SessionId) || State.DeletedMessages?.some(M => M.SessionId === SessionId && M.MessageId === MessageId)) { throw new Error("保存前原消息已变化或删除, 请重新核对"); }
	if(!(State.Sync?.Conflicts ?? State.MessageConflicts ?? []).some(C => conflict_evidence_key(C) === conflict_evidence_key(Resolution.Conflict))) { throw new Error("保存前原冲突证据已变化"); }
	const Candidate = Resolution.Choice === "local" ? Resolution.Conflict.Local : Resolution.Conflict.Remote;
	if(!Candidate || typeof Candidate !== "object" || (Candidate as any).Id !== MessageId || typeof (Candidate as any).Text !== "string" || !["user", "assistant", "system", "reasoning"].includes((Candidate as any).Role)) { throw new Error("所选冲突正文无效"); }
	const Next = structuredClone(State);
	Next.Sync ??= { SchemaVersion: 1, Scope: Resolution.Scope, Revision: 0, Versions: {}, Operations: [], Conflicts: [] };
	Next.Sync.Resolutions = merge_conflict_resolutions(Resolution.Scope, Next.Sync.Resolutions, [Resolution]);
	Next.Sync.Conflicts = pending_conflicts(Next.Sync.Conflicts, Next.Sync.Resolutions);
	Next.MessageConflicts = pending_conflicts(Next.MessageConflicts ?? [], Next.Sync.Resolutions);
	const Messages = Next.Sessions.find(S => S.Id === SessionId)!.Messages; Messages[Messages.findIndex(M => M.Id === MessageId)] = structuredClone(Candidate) as any;
	return Next;
}
export function pending_conflicts(Conflicts: readonly SyncConflict[], Resolutions: readonly ConflictResolution[] = [], Legacy: readonly any[] = []): SyncConflict[]
{
	const Choices = new Map<string, Set<string>>(), Evidence = new Map<string, SyncConflict>();
	for(const R of effective_conflict_resolutions(Resolutions)) { const Key = conflict_evidence_key(R.Conflict); if(!Choices.has(Key)) { Choices.set(Key, new Set()); } Choices.get(Key)!.add(R.Choice); }
	// Identity-free legacy receipts cannot be invented as causal parents.
	for(const R of Legacy) { if(R && typeof R.Key === "string" && ["local", "remote"].includes(R.Choice)) { const Key = conflict_evidence_key(R); if(!Choices.has(Key)) { Choices.set(Key, new Set()); } Choices.get(Key)!.add(R.Choice); } }
	for(const C of Conflicts) { Evidence.set(conflict_evidence_key(C), C); }
	for(const R of Resolutions) { if((Choices.get(conflict_evidence_key(R.Conflict))?.size ?? 0) > 1) { Evidence.set(conflict_evidence_key(R.Conflict), { ...R.Conflict, Reason: "同一冲突存在未被最终裁定覆盖的不同决议, 请重新核对有效决议集合" }); } }
	return [...Evidence].filter(([Key]) => Choices.get(Key)?.size !== 1).map(([, C]) => structuredClone(C));
}
export function resolved_message(Resolutions: readonly ConflictResolution[], Key: string, Local: unknown, Remote: unknown): unknown | undefined
{
	const Candidates = effective_conflict_resolutions(Resolutions).filter(R => normalized_key(R.Conflict.Key) === normalized_key(Key) && canonical_json(R.Conflict.Remote) === canonical_json(Remote) && [R.Conflict.Local, R.Conflict.Remote].some(V => canonical_json(V) === canonical_json(Local)));
	if(!Candidates.length || new Set(Candidates.map(R => R.Choice)).size !== 1) { return undefined; }
	const Values = Candidates.map(R => R.Choice === "local" ? R.Conflict.Local : R.Conflict.Remote);
	return Values.every(V => canonical_json(V) === canonical_json(Values[0])) ? structuredClone(Values[0]) : undefined;
}

export function preserve_durable_resolved_messages(Data: SessionState, Durable: SessionState): void
{
	if(!Data.Sync || !Durable.Sync) { return; }
	if(Data.Sync.Scope !== Durable.Sync.Scope) { throw new Error("已提交冲突决议来自其他作用域, 未修改正文"); }
	const All = merge_conflict_resolutions(Data.Sync.Scope, Data.Sync.Resolutions, Durable.Sync.Resolutions), Resolutions = effective_conflict_resolutions(All);
	if(!Durable.Sync.Resolutions?.length) { return; }
	const DurableDecisions = new Set(Durable.Sync.Resolutions.map(R => canonical_json(R))), Groups = new Map<string, ConflictResolution[]>();
	for(const R of Resolutions) { const Key = normalized_key(R.Conflict.Key); if(!Groups.has(Key)) { Groups.set(Key, []); } Groups.get(Key)!.push(R); }
	for(const Session of Data.Sessions)
	{
		if(Data.DeletedSessionIds?.includes(Session.Id) || Durable.DeletedSessionIds?.includes(Session.Id)) { continue; }
		const SavedSessions = Durable.Sessions.filter(S => S.Id === Session.Id); if(SavedSessions.length !== 1) { continue; }
		for(let I = 0; I < Session.Messages.length; I++)
		{
			const Message = Session.Messages[I], Decisions = Groups.get(canonical_json(["message", Session.Id, Message.Id]));
			if(!Decisions || [...(Data.DeletedMessages ?? []), ...(Durable.DeletedMessages ?? [])].some(M => M.SessionId === Session.Id && M.MessageId === Message.Id)) { continue; }
			const SavedMessages = SavedSessions[0].Messages.filter(M => M.Id === Message.Id); if(SavedMessages.length !== 1) { continue; }
			const Actual = SavedMessages[0], ActualText = canonical_json(Actual), CurrentText = canonical_json(Message);
			if(CurrentText === ActualText) { continue; }
			const Choices = new Map<string, Set<string>>();
			for(const R of Decisions) { const Evidence = conflict_evidence_key(R.Conflict); if(!Choices.has(Evidence)) { Choices.set(Evidence, new Set()); } Choices.get(Evidence)!.add(R.Choice); }
			if([...Choices.values()].some(V => V.size !== 1)) { continue; }
			const Applicable = Decisions.filter(R => DurableDecisions.has(canonical_json(R)) && canonical_json(R.Choice === "local" ? R.Conflict.Local : R.Conflict.Remote) === ActualText);
			if(!Applicable.length) { continue; }
			if(Applicable.some(R => canonical_json(R.Choice === "local" ? R.Conflict.Remote : R.Conflict.Local) === CurrentText)) { Session.Messages[I] = structuredClone(Actual); continue; }
			const Conflict: SyncConflict = { Key: JSON.stringify([Session.Id, Message.Id]), Reason: "排队正文已超出原冲突双方版本, 保留当前正文与已提交选择供核对", Local: structuredClone(Message), Remote: structuredClone(Actual) };
			if(!Data.Sync.Conflicts.some(C => canonical_json(C) === canonical_json(Conflict))) { Data.Sync.Conflicts.push(Conflict); }
		}
	}
}
