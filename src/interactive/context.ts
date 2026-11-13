import type { ChatMessage } from "../history";
import type { ContextSnapshot } from "../prompt";
import { text_identity } from "../markdown-blocks";

/** Only follow already-loaded, version-verified answer references, never live focus. */
export function interactive_contexts(Messages: readonly ChatMessage[], Answer: ChatMessage): ContextSnapshot[]
{
	const Contexts = new Map<string, ContextSnapshot>(), Seen = new Set<string>();
	let Current: ChatMessage | undefined = Answer;
	for(let Depth = 0; Current && Depth < 8 && !Seen.has(Current.Id); Depth++)
	{
		Seen.add(Current.Id);
		const User: ChatMessage | undefined = Current.TurnId ? Messages.find(M => M.Role === "user" && M.TurnId === Current!.TurnId) : undefined;
		for(const C of [User?.Context, User?.Task?.Source])
		{
			if(C) { Contexts.set(JSON.stringify([C.Path, C.CapturedAt, C.Version, C.Text]), C); }
		}
		const Quote: ChatMessage["Quote"] = User?.Quote;
		const Previous: ChatMessage | undefined = Quote ? Messages.find(M => M.Id === Quote.MessageId && M.Role === "assistant") : undefined;
		Current = Previous && Quote?.SourceVersion === text_identity(Previous.Text) ? Previous : undefined;
	}
	return structuredClone([...Contexts.values()]);
}
