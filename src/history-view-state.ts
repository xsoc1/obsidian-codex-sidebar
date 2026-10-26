import type { ChatMessage } from "./history";
import { answer_sources, source_key, source_path } from "./sources";

export function history_source_index(Messages: readonly ChatMessage[])
{
	const Users = new Map<string, ChatMessage>();
	for(const M of Messages) { if(M.Role === "user" && M.TurnId && !Users.has(M.TurnId)) { Users.set(M.TurnId, M); } }
	return new Map(Messages.map(M =>
	{
		const User = M.Role === "user" ? M : M.TurnId ? Users.get(M.TurnId) : undefined, Bound = User ? [User] : [], Refs = answer_sources(Bound, M);
		return [M.Id, { Path: source_path(Bound, M), Sources: Refs, Key: source_key(Refs) }] as const;
	}));
}
export function operation_label(Status: string): string
{
	return ({ local: "本地已保存 · 待同步", queued: "本地已保存 · 待同步", received: "服务端已接收", submitting: "正在提交 · 结果待核对", unknown: "提交结果待核对", "submission-unknown": "提交结果待核对", running: "正在生成", completed: "已完成", cancelled: "已取消", failed: "失败", deleted: "会话已删除 · 保留核对信息" } as Record<string, string>)[Status] ?? "操作状态未知";
}
export function followup_index(Messages: readonly ChatMessage[])
{
	const Users = new Map<string, ChatMessage>(), Latest = new Map<string, string>();
	for(const M of Messages) { if(M.Role === "user" && M.TurnId) { Users.set(M.TurnId, M); } }
	for(const M of Messages)
	{
		const Quote = M.Role === "assistant" && M.TurnId ? Users.get(M.TurnId)?.Quote : null;
		if(Quote) { Latest.set(Quote.RootMessageId ?? Quote.MessageId, M.Id); }
	}
	return new Map(Messages.filter(M => M.Role === "assistant").flatMap(M =>
	{
		const Quote = M.TurnId ? Users.get(M.TurnId)?.Quote : null, RootId = Quote?.RootMessageId ?? Quote?.MessageId ?? M.Id, LatestId = Latest.get(RootId);
		return Quote || LatestId ? [[M.Id, { RootId, ParentId: Quote?.MessageId ?? null, LatestId: LatestId ?? null }] as const] : [];
	}));
}
