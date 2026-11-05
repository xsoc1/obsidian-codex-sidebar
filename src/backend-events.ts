import type { SessionState } from "./sessions";
import type { BackendResult } from "./backend-result";
import { message_deleted } from "./sessions";

export interface BackendEvidence
{
	threadId: string;
	turnId: string;
	sessionId: string;
	itemId: string;
	result: BackendResult;
}
// A result belongs to one already-bound operation, never the currently visible turn.
export function apply_backend_evidence(State: SessionState, Event: BackendEvidence): boolean
{
	const Ops = State.Sync?.Operations.filter(O => O.SessionId === Event.sessionId && O.ThreadId === Event.threadId && O.TurnId === Event.turnId) ?? [];
	if(Ops.length !== 1) { return false; }
	const O = Ops[0], Previous = (O.Result as any)?.backend?.result as BackendResult | undefined;
	if(Previous?.Status === "completed") { return false; }
	if(!Event.itemId || !Event.result || typeof Event.result.Text !== "string" || !["completed","partial","refused","unknown","failed","cancelled"].includes(Event.result.Status)) { throw new Error("后端结果身份或状态无效"); }
	if(JSON.stringify(Previous) === JSON.stringify(Event.result)) { return false; }
	O.Result = { ...(O.Result as object), backend: { itemId: Event.itemId, result: structuredClone(Event.result) } };
	O.Status = Event.result.Status === "completed" ? "completed" : Event.result.Status === "unknown" ? "submission-unknown" : Event.result.Status === "cancelled" ? "cancelled" : "failed";
	O.Error = Event.result.Metadata.Reason;
	if(O.Scope.startsWith("backend:")) { O.Origin=O.Scope;O.Revision=(O.Revision??0)+1; }
	hydrate_backend_body(State,O,Event);
	return true;
}

export function hydrate_backend_body(State:SessionState,O:NonNullable<SessionState["Sync"]>["Operations"][number],Event:BackendEvidence): boolean
{
	const S = State.Sessions.find(S => S.Id === O.SessionId);
	if(!S || State.DeletedSessionIds?.includes(O.SessionId)) { O.SessionDeleted = true; return true; }
	if(message_deleted(State, S.Id, O.MessageId) || message_deleted(State, S.Id, Event.itemId)) { O.MessageDeleted = true; return true; }
	let Reply = S.Messages.find(M => M.Id === Event.itemId);
	if(Reply?.CompletionStatus === "completed") { return true; }
	if(!Reply && !Event.result.Text && !Event.result.Metadata.Usage?.length && !Event.result.Metadata.Receipts?.length) { return true; }
	if(!Reply) { Reply = { Id: Event.itemId, Role: "assistant", Text: "", TurnId: Event.turnId }; S.Messages.push(Reply); }
	if(Reply.Role !== "assistant" || Reply.TurnId !== Event.turnId) { throw new Error("后端结果与原消息身份不符"); }
	Reply.Text = Event.result.Text; Reply.BackendResult = structuredClone(Event.result);
	if(O.WaitStopped){Reply.ArchivedOnly=true;}
	Reply.CompletionStatus = Event.result.Status; Reply.Phase = Event.result.Status === "completed" ? "final_answer" : "commentary";
	if(Event.result.Metadata.Model) { S.EffectiveModel = Event.result.Metadata.Model; }
	return true;
}
