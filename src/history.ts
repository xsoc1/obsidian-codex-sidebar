import { build_prompt, type ContextSnapshot, type AnswerQuote } from "./prompt";
import type { TaskSpec } from "./edit/task";
import { message_pdf_refs } from "./pdf/inputs";

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
	Task?: TaskSpec;
	CompletionStatus?: "completed" | "interrupted" | "failed";
	Phase?: "commentary" | "final_answer" | null;
}

export function history_items(Messages: ChatMessage[], Images = new Map<string, string>())
{
	const Seen = new Set<string>();
	return Messages.filter(Value => (Value.Role === "user" || Value.Role === "assistant") && Value.Text.trim()).map(Value =>
	{
		const Content: any[] = [{ type: Value.Role === "user" ? "input_text" : "output_text", text: Value.Role === "user" ? Value.Prompt ?? build_prompt(Value.Text, Value.Context ?? null, Value.Quote ?? null) : Value.Text }];
		for(const Ref of Value.Role === "user" ? message_pdf_refs(Value) : [])
		{
			if(Seen.has(Ref.Id)) { continue; }
			const Url = Images.get(Ref.Id);
			if(!Url) { throw new Error("原 PDF 页图缺失, 不能省略或改用当前页面恢复历史"); }
			Seen.add(Ref.Id); Content.push({ type: "input_image", image_url: Url });
		}
		return { type: "message", role: Value.Role, content: Content };
	});
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
