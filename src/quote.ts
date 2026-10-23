import { bound_text, type AnswerQuote } from "./prompt";
import type { ChatMessage } from "./history";

export function answer_status(Message: ChatMessage, ActiveTurn: string | null, Busy: boolean): AnswerQuote["SourceStatus"]
{
	if(Message.Phase === "commentary") { return "incomplete"; }
	if(Message.CompletionStatus === "completed") { return "completed"; }
	if(Message.CompletionStatus || (Busy && Message.TurnId === ActiveTurn)) { return "incomplete"; }
	return "unknown";
}

export function answer_quote(SessionId: string, MessageId: string, SelectedText: string, SourceText: string, SourceStatus: AnswerQuote["SourceStatus"] = "unknown"): AnswerQuote
{
	const Selected = bound_text(SelectedText.trim(), 4000);
	const Source = bound_text(SourceText, 24000);
	return { SessionId, MessageId, SelectedText: Selected.Text, SourceText: Source.Text, SelectedTruncated: Selected.Truncated, SourceTruncated: Source.Truncated, FollowupMode: "integrated-v1", SourceStatus };
}
