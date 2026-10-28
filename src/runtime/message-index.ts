import type { ChatMessage } from "../history";
import type { ChatSession } from "../sessions";

export class MessageIndex
{
	private Sessions = new WeakMap<ChatSession, { Messages: ChatMessage[]; Length: number; ById: Map<string, number> }>();
	get(Session: ChatSession, Id: string): ChatMessage | undefined
	{
		let Cache = this.Sessions.get(Session);
		if(!Cache || Cache.Messages !== Session.Messages || Cache.Length > Session.Messages.length)
		{
			Cache = { Messages: Session.Messages, Length: 0, ById: new Map() }; this.Sessions.set(Session, Cache);
		}
		for(let I = Cache.Length; I < Session.Messages.length; I++) { Cache.ById.set(Session.Messages[I].Id, I); }
		Cache.Length = Session.Messages.length;
		const Index = Cache.ById.get(Id); return Index === undefined ? undefined : Session.Messages[Index];
	}
	invalidate(Session: ChatSession): void { this.Sessions.delete(Session); }
}
