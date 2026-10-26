import type { ChatMessage } from "../history";
import type { ChatSession } from "../sessions";
import { canonical_json, type SyncConflict } from "../sync/types";

export function message_checkpoint(Session: ChatSession, Incoming: ChatMessage, Conflicts: SyncConflict[]): boolean
{
	if(!Incoming || typeof Incoming.Id !== "string" || typeof Incoming.Text !== "string" || !["user", "assistant", "reasoning", "system"].includes(Incoming.Role)) { throw new Error("消息检查点无效"); }
	const Index = Session.Messages.findIndex(M => M.Id === Incoming.Id), Old = Session.Messages[Index];
	if(!Old) { Session.Messages.push(structuredClone(Incoming)); return true; }
	if(canonical_json(Old) === canonical_json(Incoming)) { return false; }
	const Conflict = () =>
	{
		const Value = { Key: JSON.stringify(["message", Session.Id, Incoming.Id]), Reason: "消息检查点与原记录版本无法确定, 保留双方", Local: structuredClone(Old), Remote: structuredClone(Incoming) };
		if(!Conflicts.some(C => canonical_json(C) === canonical_json(Value))) { Conflicts.push(Value); } return false;
	};
	if(Old.Role !== Incoming.Role || (Old.TurnId && Incoming.TurnId && Old.TurnId !== Incoming.TurnId)) { return Conflict(); }
	if(Old.Role === "user")
	{
		const Original = (M: ChatMessage) => canonical_json([M.Text, M.Prompt, M.Context, M.Quote, M.Task, M.OperationId]);
		if(Original(Old) !== Original(Incoming)) { return Conflict(); }
	}
	const L = Old.SyncVersion, R = Incoming.SyncVersion;
	if(L && R)
	{
		if(L.Origin !== R.Origin || (L.Revision === R.Revision && L.Digest !== R.Digest)) { return Conflict(); }
		if(L.Revision >= R.Revision) { return false; }
	}
	else if(L && !R) { return false; }
	else if(!R && Old.Text !== Incoming.Text) { return Conflict(); }
	if(Old.CompletionStatus === "completed" && Incoming.CompletionStatus !== "completed") { return false; }
	Session.Messages[Index] = structuredClone(Incoming); return true;
}
