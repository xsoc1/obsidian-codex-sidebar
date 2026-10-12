import { build_prompt, type ContextSnapshot, type AnswerQuote } from "./prompt";

export interface ChatMessage
{
	Id: string;
	Role: "user" | "assistant" | "system" | "reasoning";
	Text: string;
	TurnId?: string;
	ContextLabel?: string;
	Context?: ContextSnapshot | null;
	Prompt?: string;
	Quote?: AnswerQuote | null;
	SummaryParts?: string[];
}

export function history_items(Messages: ChatMessage[])
{
	return Messages.filter(Value => (Value.Role === "user" || Value.Role === "assistant") && Value.Text.trim()).map(Value =>
	({
		type: "message",
		role: Value.Role,
		content: [{ type: Value.Role === "user" ? "input_text" : "output_text", text: Value.Role === "user" ? Value.Prompt ?? build_prompt(Value.Text, Value.Context ?? null, Value.Quote ?? null) : Value.Text }]
	}));
}

export function branch_prefix(Messages: ChatMessage[], Id: string): ChatMessage[]
{
	const Index = Messages.findIndex(Value => Value.Id === Id && Value.Role === "user");
	if(Index < 0)
	{
		throw new Error("未找到要重发的用户消息");
	}
	return structuredClone(Messages.slice(0, Index));
}
