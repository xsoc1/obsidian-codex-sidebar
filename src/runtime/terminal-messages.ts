import type { SessionState } from "../sessions";
import { message_deleted } from "../sessions";

// A queued replaceable snapshot cannot roll back an already durable terminal body.
export function preserve_terminal_messages(Data: SessionState, Durable: SessionState): void
{
	if(Data.Sync?.Scope !== Durable.Sync?.Scope) { return; }
	for(const S of Data.Sessions)
	{
		if(Data.DeletedSessionIds?.includes(S.Id) || Durable.DeletedSessionIds?.includes(S.Id)) { continue; }
		const Saved = Durable.Sessions.find(V => V.Id === S.Id);
		const Positions = new Map(S.Messages.map((M, Index) => [M.Id, Index]));
		for(const M of Saved?.Messages ?? [])
		{
			if(!M.CompletionStatus || M.Role === "user" || message_deleted(Data,S.Id,M.Id) || message_deleted(Durable,S.Id,M.Id)) { continue; }
			const Index=Positions.get(M.Id) ?? -1, Current=S.Messages[Index];
			if(Current && Current.Role===M.Role && Current.TurnId===M.TurnId && (!Current.CompletionStatus || M.CompletionStatus === "completed" && Current.CompletionStatus !== "completed")) { S.Messages[Index]=structuredClone(M); }
			else if(!Current && Data.Sync?.History?.[S.Id]?.Status !== "unloaded")
			{
				const Before = Saved!.Messages.slice(0, Saved!.Messages.indexOf(M)).reverse().find(P => S.Messages.some(V => V.Id === P.Id));
				const Bound = M.TurnId && Data.Sync?.Operations.some(O => O.SessionId === S.Id && O.TurnId === M.TurnId);
				if(Before || Bound)
				{
					const Insert = Before ? Positions.get(Before.Id)! + 1 : S.Messages.length;
					S.Messages.splice(Insert, 0, structuredClone(M));
					for(let I = Insert; I < S.Messages.length; I++) { Positions.set(S.Messages[I].Id, I); }
				}
			}
		}
	}
}
