import type { AnswerQuote } from "./prompt";
import type { ChatMessage } from "./history";
import { text_identity } from "./markdown-blocks";

/** Verify the saved body before either host prefetch or a scoped model read. */
export function verify_quoted_body(Quote: AnswerQuote | null | undefined, Session: string, Messages: readonly ChatMessage[], InheritedFrom: readonly string[] = []): ChatMessage | undefined
{
	if(!Quote) { return; }
	if(Quote.SessionId !== Session && !Quote.SourceTruncated) { return; }
	if(Quote.SessionId !== Session && !InheritedFrom.includes(Quote.SessionId)) { throw new Error("长引用不属于当前会话或已核对分支，未读取其他会话或把材料转交新服务"); }
	const Original = Messages.find(M => M.Id === Quote.MessageId && M.Role === "assistant");
	if(!Original)
	{
		if(Quote.SourceTruncated) { throw new Error("引用的原消息尚未恢复或已被删除，请回到原会话加载后重选；草稿保留"); }
		return;
	}
	if(Quote.SourceVersion && text_identity(Original.Text) !== Quote.SourceVersion) { throw new Error("引用原文版本已变化，请核对原回答后重新选择；没有用新版本替换旧快照"); }
	if(!Quote.SourceVersion && Quote.SourceTruncated) { throw new Error("长引用缺少原文版本，请从原回答重新选择；草稿保留"); }
	return Original;
}

export function quote_input_ready(Quote: AnswerQuote | null | undefined, Session: string, Messages: readonly ChatMessage[], BodyRead: boolean, InheritedFrom: readonly string[] = []): void
{
	const Original = verify_quoted_body(Quote, Session, Messages,InheritedFrom);
	if(Quote?.SourceTruncated && !Original && !BodyRead) { throw new Error("本轮缺少可核验的原回答，请在原会话加载或分段附带原文；草稿保留"); }
}
