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
		for(const M of Saved?.Messages ?? [])
		{
			if(!M.CompletionStatus || M.Role === "user" || message_deleted(Data,S.Id,M.Id) || message_deleted(Durable,S.Id,M.Id)) { continue; }
			const Index=S.Messages.findIndex(V=>V.Id===M.Id), Current=S.Messages[Index];
			if(Current && Current.Role===M.Role && Current.TurnId===M.TurnId && !Current.CompletionStatus) { S.Messages[Index]=structuredClone(M); }
		}
	}
}
