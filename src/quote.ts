import { bound_text, type AnswerQuote } from "./prompt";

export function answer_quote(SessionId: string, MessageId: string, SelectedText: string, SourceText: string): AnswerQuote
{
	const Selected = bound_text(SelectedText.trim(), 4000);
	const Source = bound_text(SourceText, 24000);
	return { SessionId, MessageId, SelectedText: Selected.Text, SourceText: Source.Text, SelectedTruncated: Selected.Truncated, SourceTruncated: Source.Truncated };
}
