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
export async function prepare_conflict_resolution(Scope: string, Conflict: SyncConflict, Choice: "local" | "remote"): Promise<ConflictResolution>
{
	if(!Scope || !["local", "remote"].includes(Choice)) { throw new Error("冲突决议作用域或选择无效"); }
	const Evidence = structuredClone(Conflict);
	return { SchemaVersion: 1, Id: crypto.randomUUID(), Scope, ConflictId: await content_digest([Scope, conflict_evidence_key(Evidence)]), Conflict: Evidence, Choice };
}
export async function verify_conflict_resolutions(Scope: string, Values: readonly ConflictResolution[] = []): Promise<void>
{
	merge_conflict_resolutions(Scope, Values);
	for(const R of Values) { if(R.ConflictId !== await content_digest([Scope, conflict_evidence_key(R.Conflict)])) { throw new Error("冲突决议摘要与双方版本证据不符, 不隐藏冲突"); } }
}
export function merge_conflict_resolutions(Scope: string, ...Lists: (readonly ConflictResolution[] | undefined)[]): ConflictResolution[]
{
	const All = new Map<string, ConflictResolution>();
	for(const R of Lists.flatMap(L => L ?? []))
	{
		if(R.SchemaVersion !== 1 || R.Scope !== Scope || typeof R.Id !== "string" || !R.Id || !/^[0-9a-f]{64}$/.test(R.ConflictId) || !R.Conflict || typeof R.Conflict.Key !== "string" || !["local", "remote"].includes(R.Choice)) { throw new Error("冲突决议版本或作用域无效, 保留原数据"); }
		// Decisions are a set of evidence, never a last-writer-wins register.
		All.set(canonical_json(R), structuredClone(R));
	}
	return [...All.values()];
}
export function pending_conflicts(Conflicts: readonly SyncConflict[], Resolutions: readonly ConflictResolution[] = [], Legacy: readonly any[] = []): SyncConflict[]
{
	const Choices = new Map<string, Set<string>>(), Evidence = new Map<string, SyncConflict>();
	for(const R of Resolutions) { const Key = conflict_evidence_key(R.Conflict); if(!Choices.has(Key)) { Choices.set(Key, new Set()); } Choices.get(Key)!.add(R.Choice); }
	// Old receipts keep their missing identity/version unknown. Only exact saved evidence is matched.
	for(const R of Legacy) { if(R && typeof R.Key === "string" && ["local", "remote"].includes(R.Choice)) { const Key = conflict_evidence_key(R); if(!Choices.has(Key)) { Choices.set(Key, new Set()); } Choices.get(Key)!.add(R.Choice); } }
	for(const C of Conflicts) { Evidence.set(conflict_evidence_key(C), C); }
	for(const R of Resolutions) { if((Choices.get(conflict_evidence_key(R.Conflict))?.size ?? 0) > 1) { Evidence.set(conflict_evidence_key(R.Conflict), { ...R.Conflict, Reason: "同一冲突存在不同客户端的不同决议, 保留双方选择并重新核对" }); } }
	return [...Evidence].filter(([Key]) => Choices.get(Key)?.size !== 1).map(([, C]) => structuredClone(C));
}
export function resolved_message(Resolutions: readonly ConflictResolution[], Key: string, Local: unknown, Remote: unknown): unknown | undefined
{
	const Candidates = Resolutions.filter(R => normalized_key(R.Conflict.Key) === normalized_key(Key) && canonical_json(R.Conflict.Remote) === canonical_json(Remote) && [R.Conflict.Local, R.Conflict.Remote].some(V => canonical_json(V) === canonical_json(Local)));
	if(!Candidates.length || new Set(Candidates.map(R => R.Choice)).size !== 1) { return undefined; }
	const Values = Candidates.map(R => R.Choice === "local" ? R.Conflict.Local : R.Conflict.Remote);
	return Values.every(V => canonical_json(V) === canonical_json(Values[0])) ? structuredClone(Values[0]) : undefined;
}

export function preserve_durable_resolved_messages(Data: SessionState, Durable: SessionState): void
{
	if(!Data.Sync || !Durable.Sync) { return; }
	const Resolutions = merge_conflict_resolutions(Data.Sync.Scope, Data.Sync.Resolutions, Durable.Sync.Resolutions);
	if(Data.Sync.Scope !== Durable.Sync.Scope) { throw new Error("已提交冲突决议来自其他作用域, 未修改正文"); }
	if(!Durable.Sync.Resolutions?.length) { return; }
	const DurableDecisions = new Set(Durable.Sync.Resolutions.map(R => canonical_json(R)));
	const Groups = new Map<string, ConflictResolution[]>();
	for(const R of Resolutions)
	{
		const Key = normalized_key(R.Conflict.Key); if(!Groups.has(Key)) { Groups.set(Key, []); } Groups.get(Key)!.push(R);
	}
	for(const Session of Data.Sessions)
	{
		if(Data.DeletedSessionIds?.includes(Session.Id) || Durable.DeletedSessionIds?.includes(Session.Id)) { continue; }
		const SavedSessions = Durable.Sessions.filter(S => S.Id === Session.Id); if(SavedSessions.length !== 1) { continue; }
		for(let I = 0; I < Session.Messages.length; I++)
		{
			const Message = Session.Messages[I], Key = canonical_json(["message", Session.Id, Message.Id]), Decisions = Groups.get(Key);
			if(!Decisions || [...(Data.DeletedMessages ?? []), ...(Durable.DeletedMessages ?? [])].some(M => M.SessionId === Session.Id && M.MessageId === Message.Id)) { continue; }
			const SavedMessages = SavedSessions[0].Messages.filter(M => M.Id === Message.Id); if(SavedMessages.length !== 1) { continue; }
			const Actual = SavedMessages[0], ActualText = canonical_json(Actual), CurrentText = canonical_json(Message);
			if(CurrentText === ActualText) { continue; }
			const Choices = new Map<string, Set<string>>();
			for(const R of Decisions) { const Evidence = conflict_evidence_key(R.Conflict); if(!Choices.has(Evidence)) { Choices.set(Evidence, new Set()); } Choices.get(Evidence)!.add(R.Choice); }
			if([...Choices.values()].some(V => V.size !== 1)) { continue; }
			const Applicable = Decisions.filter(R => DurableDecisions.has(canonical_json(R)) && canonical_json(R.Choice === "local" ? R.Conflict.Local : R.Conflict.Remote) === ActualText);
			if(!Applicable.length) { continue; }
			if(Applicable.some(R => canonical_json(R.Choice === "local" ? R.Conflict.Remote : R.Conflict.Local) === CurrentText))
			{
				Session.Messages[I] = structuredClone(Actual); continue;
			}
			const Conflict: SyncConflict = { Key: JSON.stringify([Session.Id, Message.Id]), Reason: "排队正文已超出原冲突双方版本, 保留当前正文与已提交选择供核对", Local: structuredClone(Message), Remote: structuredClone(Actual) };
			if(!Data.Sync.Conflicts.some(C => canonical_json(C) === canonical_json(Conflict))) { Data.Sync.Conflicts.push(Conflict); }
		}
	}
}
