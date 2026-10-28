import { content_digest, canonical_json, type OperationStatus } from "../sync/types";

export interface SendIntent
{
	SchemaVersion: 1;
	Id: string;
	SessionId: string;
	MessageId: string;
	LocalScope: string;
	Input: unknown;
	Digest: string;
	Status: OperationStatus;
	Error?: string;
}
export async function send_intent(LocalScope: string, SessionId: string, MessageId: string, Input: unknown): Promise<SendIntent>
{
	return { SchemaVersion: 1, Id: crypto.randomUUID(), SessionId, MessageId, LocalScope, Input: structuredClone(Input), Digest: await content_digest(Input), Status: "local" };
}
export function validate_outbox(Value: unknown): asserts Value is SendIntent[]
{
	if(!Array.isArray(Value)) { throw new Error("待发送操作记录损坏, 原历史保留"); }
	const Seen = new Set<string>();
	for(const Entry of Value)
	{
		if(!Entry || Entry.SchemaVersion !== 1 || typeof Entry.Id !== "string" || Seen.has(Entry.Id) || !Entry.Id || typeof Entry.SessionId !== "string" || !Entry.SessionId || typeof Entry.MessageId !== "string" || !Entry.MessageId || typeof Entry.LocalScope !== "string" || !Entry.LocalScope || !/^[0-9a-f]{64}$/.test(Entry.Digest) || !["local", "received", "submission-unknown", "running", "completed", "cancelled", "failed"].includes(Entry.Status)) { throw new Error("待发送操作身份或状态损坏, 原历史保留"); }
		Seen.add(Entry.Id);
	}
}
export function merge_outbox(Local: SendIntent[] = [], Remote: SendIntent[] = []): SendIntent[]
{
	validate_outbox(Local); validate_outbox(Remote); const Result = structuredClone(Local);
	for(const Entry of Remote)
	{
		const Previous = Result.find(E => E.Id === Entry.Id);
		if(!Previous) { Result.push(structuredClone(Entry)); }
		else if(Previous.LocalScope !== Entry.LocalScope || Previous.Digest !== Entry.Digest || canonical_json(Previous.Input) !== canonical_json(Entry.Input)) { throw new Error("同一待发送操作存在输入冲突, 未覆盖任何一方"); }
	}
	return Result;
}
export function normalize_outbox(State: { Outbox?: SendIntent[]; Sync?: { Operations: { Id: string; SessionId: string; MessageId: string; Input: unknown; Evidence?: unknown }[] } }): void
{
	if(!State.Outbox) { return; }
	State.Outbox = State.Outbox.filter(Intent =>
	{
		const Bound = State.Sync?.Operations.find(O => O.Id === Intent.Id); if(!Bound) { return true; }
		if(Bound.Evidence) { return true; }
		if(Bound.SessionId !== Intent.SessionId || Bound.MessageId !== Intent.MessageId || canonical_json(Bound.Input) !== canonical_json(Intent.Input)) { throw new Error("待发送意图与已绑定操作冲突, 不丢弃任一输入"); } return false;
	});
}
