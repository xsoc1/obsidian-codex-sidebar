import type { BackendMetadata, BackendReceipt, BackendResult, BackendUsage } from "./backend-result";
import type { SseEvent } from "./api-sse";

export interface ApiToolCall { Id: string; Name: string; Arguments: string; }
export interface ApiResult { Result: BackendResult; Calls: ApiToolCall[]; Value: any; }
const StringValue = (V: unknown): string | undefined => typeof V === "string" && V.length <= 1024 ? V : undefined;
export const ApiOpaqueBudget = { MaxFields: 8, MaxChars: 65536, MaxFieldUtf8Bytes: 65536, MaxUtf8Bytes: 262144, MaxOperationUtf8Bytes: 262144 } as const;
export interface ApiChatToolCall
{
	id: string;
	type: "function";
	function: { name: string; arguments: string };
	extra_content?: { google: { thought_signature: string } };
}
export class ApiReplayError extends Error {}
const Encoder = new TextEncoder();

// Google requires the opaque value on its original tool call, never concatenated.
// https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures
// https://ai.google.dev/gemini-api/docs/openai
function signature(Value: any): string | undefined
{
	const V = Value?.extra_content?.google?.thought_signature;
	if(V === undefined) { return; }
	if(typeof V !== "string" || !V.length) { throw new ApiReplayError("工具签名格式无效; 未提交后续请求"); }
	if(V.length > ApiOpaqueBudget.MaxChars || Encoder.encode(V).byteLength > ApiOpaqueBudget.MaxFieldUtf8Bytes) { throw new ApiReplayError("工具签名超过字段预算; 未截断或提交后续请求"); }
	return V;
}

export function api_chat_tool_calls(Values: any[], OnOpaque?: (Value: string) => void): ApiChatToolCall[]
{
	if(Values.length > 8) { throw new ApiReplayError("工具调用数量超过限制; 未提交后续请求"); }
	let Fields = 0, Bytes = 0;
	return Values.map(V =>
	{
		if(!V || V.type != null && V.type !== "function" || typeof V.id !== "string" || V.id.length > 1024 || typeof V.function?.name !== "string" || V.function.name.length > 256 || typeof V.function?.arguments !== "string" || V.function.arguments.length > 16384) { throw new ApiReplayError("工具调用结构超过限制或无效; 未提交后续请求"); }
		const S = signature(V);
		if(S !== undefined) { Fields++; Bytes += Encoder.encode(S).byteLength; }
		if(Fields > ApiOpaqueBudget.MaxFields || Bytes > ApiOpaqueBudget.MaxUtf8Bytes) { throw new ApiReplayError("工具签名累计超过响应预算; 未提交后续请求"); }
		if(S !== undefined) { OnOpaque?.(S); }
		return { id: V.id, type: V.type ?? "function", function: { name: V.function?.name, arguments: V.function?.arguments }, ...(S !== undefined ? { extra_content: { google: { thought_signature: S } } } : {}) };
	});
}

export function api_error_reason(Value: any): string
{
	const Error = Value?.error ?? Value;
	const SafeCode = (V: unknown) => typeof V === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(V) ? V : undefined;
	const Code = SafeCode(Error?.code) ?? (typeof Error?.code === "number" && Number.isSafeInteger(Error.code) ? String(Error.code) : SafeCode(Error?.type) ?? "provider-error");
	const Status = SafeCode(Error?.status), Label = Status && Status !== Code ? `${Code}/${Status}` : Code;
	// Keep a bounded explanation, not arbitrary request dumps, URLs or credentials.
	const Message = typeof Error?.message === "string" ? Error.message.slice(0, 2048)
		.replace(/(?:Bearer\s+|(?:thought[_-]?signature|api[_-]?key|token|authorization)\s*[=:]\s*)[^\s;,]+/gi, "[redacted]")
		.replace(/https?:\/\/\S+/gi, "[redacted-url]")
		.replace(/["'`][^"'`]*["'`]/g, "[redacted-detail]")
		.replace(/[a-z0-9_+\/=.-]{32,}/gi, "[redacted]")
		.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 384) : "";
	return Message ? `${Label}: ${Message}` : Label;
}

export function api_usage(Value: any, Receipt?: BackendReceipt): BackendUsage | undefined
{
	if(!Value || typeof Value !== "object" || Array.isArray(Value)) { return; }
	const Usage: BackendUsage = { Kind: "cumulative", ...(Receipt ? { Receipt } : {}), Raw: Value };
	for(const [Key, V] of [
		["InputTokens", Value.input_tokens ?? Value.prompt_tokens], ["OutputTokens", Value.output_tokens ?? Value.completion_tokens],
		["TotalTokens", Value.total_tokens], ["CachedInputTokens", Value.input_tokens_details?.cached_tokens ?? Value.prompt_tokens_details?.cached_tokens ?? Value.prompt_cache_hit_tokens],
		["ReasoningOutputTokens", Value.output_tokens_details?.reasoning_tokens ?? Value.completion_tokens_details?.reasoning_tokens]
	] as const)
	{
		if(typeof V === "number" && Number.isFinite(V) && V >= 0) { Usage[Key] = V; }
	}
	return Usage;
}

export function parse_api_result(Value: any, Protocol: "chat" | "responses", RequestId?: string, OnOpaque?: (Value: string) => void): ApiResult
{
	const Receipt: BackendReceipt = { ...(RequestId ? { RequestId } : {}), ...(StringValue(Value?.id) ? { ResponseId: Value.id } : {}) };
	const Usage = api_usage(Value?.usage, Object.keys(Receipt).length ? Receipt : undefined);
	const Metadata: BackendMetadata = {
		Submission: "submitted", Wait: "finished", ...(StringValue(Value?.model) ? { Model: Value.model } : {}),
		...(Object.keys(Receipt).length ? { Receipts: [Receipt] } : {}), ...(Usage ? { Usage: [Usage] } : {})
	};
	let Text = "", Refusal = "", Status: BackendResult["Status"] = "unknown", Reason = "missing-terminal", Calls: ApiToolCall[] = [], ReplayFailure: string | undefined;
	if(Protocol === "responses")
	{
		for(const Item of Array.isArray(Value?.output) ? Value.output : [])
		{
			if(Item?.type === "message" && Item.role === "assistant" && Array.isArray(Item.content))
			{
				for(const Part of Item.content)
				{
					if(Part?.type === "output_text" && typeof Part.text === "string") { Text += Part.text; }
					if(Part?.type === "refusal" && typeof Part.refusal === "string") { Refusal += Part.refusal; }
				}
			}
			else if(Item?.type === "function_call") { Calls.push({ Id: Item.call_id, Name: Item.name, Arguments: Item.arguments }); }
		}
		Reason = Value?.incomplete_details?.reason ?? (Value?.error ? api_error_reason(Value) : undefined) ?? Value?.status ?? Reason;
		if(Value?.status === "completed") { Status = Refusal ? "refused" : "completed"; }
		else if(Value?.status === "incomplete") { Status = Reason === "content_filter" ? "refused" : "partial"; }
		else if(Value?.status === "failed") { Status = Text || Refusal ? "partial" : "failed"; }
		else if(Value?.status === "cancelled") { Status = "cancelled"; Metadata.Submission = "cancelled"; }
	}
	else
	{
		const Choice = Value?.choices?.[0], Message = Choice?.message;
		if(typeof Message?.content === "string") { Text = Message.content; }
		if(typeof Message?.refusal === "string") { Refusal = Message.refusal; }
		if(Array.isArray(Message?.tool_calls))
		{
			try { api_chat_tool_calls(Message.tool_calls, OnOpaque); Calls = Message.tool_calls.map((C: any) => ({ Id: C.id, Name: C.function?.name, Arguments: C.function?.arguments })); }
			catch(E) { if(!(E instanceof ApiReplayError)) { throw E; } ReplayFailure = E.message; }
		}
		Reason = Choice?.finish_reason ?? Reason;
		if(Reason === "stop") { Status = Refusal ? "refused" : "completed"; }
		else if(Reason === "length") { Status = "partial"; }
		else if(Reason === "content_filter") { Status = "refused"; }
		else if(Reason === "tool_calls") { Status = Calls.length ? "completed" : "unknown"; }
	}
	Text = [Text, Refusal].filter(Boolean).join("\n\n");
	if(Text.length > 2_000_000) { Text = Text.slice(0, 2_000_000); Status = "partial"; Reason = "output-limit"; }
	if(ReplayFailure) { Status = Text ? "partial" : "failed"; Reason = ReplayFailure; Calls = []; }
	if(Status === "completed" && !Text.trim() && !Calls.length) { Status = "failed"; Reason = "empty-body"; }
	return { Result: { Text, Status, Metadata: { ...Metadata, Reason: typeof Reason === "string" && Reason.length <= 1024 ? Reason : "invalid-terminal" } }, Calls, Value };
}

export class ApiStreamAccumulator
{
	Text = "";
	Done = false;
	private Terminal: ApiResult | undefined;
	private Seen = new Set<string>();
	private Chat: any = { choices: [{ message: { content: "", tool_calls: [] }, finish_reason: null }] };
	private Response: any = {};
	private Calls = new Map<number, any>();
	constructor(private Protocol: "chat" | "responses", private Delta: (Text: string) => void, private RequestId?: string, private OnOpaque?: (Value: string) => void) {}
	metadata(): BackendMetadata
	{
		const V = this.Protocol === "chat" ? this.Chat : this.Response;
		const Receipt = { ...(this.RequestId ? { RequestId: this.RequestId } : {}), ...(typeof V?.id === "string" ? { ResponseId: V.id } : {}) };
		const Usage = api_usage(V?.usage, Object.keys(Receipt).length ? Receipt : undefined);
		return { Submission: "submitted", ...(typeof V?.model === "string" ? { Model: V.model } : {}), ...(Object.keys(Receipt).length ? { Receipts: [Receipt] } : {}), ...(Usage ? { Usage: [Usage] } : {}) };
	}
	private append(Text: string): void
	{
		if(this.Text.length + Text.length > 2_000_000) { throw new Error("API 正文超过长度限制"); }
		this.Text += Text; this.Delta(Text);
	}
	accept(Frame: SseEvent): void
	{
		if(this.Done) { return; }
		if(Frame.Data === "[DONE]") { this.Done = true; return; }
		const V = JSON.parse(Frame.Data), Type = V.type ?? Frame.Event;
		const Identity = typeof V.sequence_number === "number" ? `seq:${V.sequence_number}` : Frame.Id ? `id:${Frame.Id}` : undefined;
		if(Identity)
		{
			if(this.Seen.has(Identity)) { return; }
			if(this.Seen.size >= 100000) { throw new Error("SSE 事件数量超过限制"); }
			this.Seen.add(Identity);
		}
		if(Type === "error" || V.error)
		{
			if(!this.Terminal) { this.Terminal = { Result: { Text: this.Text, Status: this.Text ? "partial" : "failed", Metadata: { ...this.metadata(), Reason: api_error_reason(V), Submission: "submitted", Wait: "finished" } }, Calls: [], Value: V }; }
			this.Done = true; return;
		}
		if(this.Protocol === "chat")
		{
			if(this.Terminal) { return; }
			for(const K of ["id", "model", "usage"]) { if(V[K] != null) { this.Chat[K] = V[K]; } }
			const Choice = V.choices?.find((C: any) => C.index === 0) ?? V.choices?.[0];
			if(!Choice) { return; }
			const Message = this.Chat.choices[0].message, D = Choice.delta;
			if(typeof D?.content === "string") { Message.content += D.content; this.append(D.content); }
			if(typeof D?.refusal === "string") { Message.refusal = (Message.refusal ?? "") + D.refusal; this.append(D.refusal); }
			if(typeof D?.reasoning_content === "string") { Message.reasoning_content = (Message.reasoning_content ?? "") + D.reasoning_content; }
			for(const Call of D?.tool_calls ?? [])
			{
				if(!Number.isSafeInteger(Call.index) || Call.index < 0 || Call.index >= 8) { throw new ApiReplayError("工具调用索引无效或超过数量限制; 未提交后续请求"); }
				const C = this.Calls.get(Call.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
				if(Call.id != null && (typeof Call.id !== "string" || C.id && C.id !== Call.id)) { throw new ApiReplayError("工具调用身份冲突; 未提交后续请求"); }
				if(typeof Call.id === "string") { C.id = Call.id; }
				if(Call.type != null && Call.type !== "function") { throw new ApiReplayError("工具调用类型无效; 未提交后续请求"); }
				const S = signature(Call), Previous = signature(C);
				if(S !== undefined)
				{
					if(Previous !== undefined && Previous !== S) { throw new ApiReplayError("工具签名冲突; 未合并或提交后续请求"); }
					C.extra_content = { google: { thought_signature: S } };
					this.OnOpaque?.(S);
				}
				C.function.name += Call.function?.name ?? ""; C.function.arguments += Call.function?.arguments ?? "";
				if(C.function.arguments.length > 16384) { throw new ApiReplayError("工具参数超过限制; 未提交后续请求"); }
				this.Calls.set(Call.index, C);
			}
			if(Choice.finish_reason != null) { this.Chat.choices[0].finish_reason = Choice.finish_reason; }
			Message.tool_calls = api_chat_tool_calls([...this.Calls].sort(([A], [B]) => A - B).map(([, C]) => C));
			return;
		}
		if(this.Terminal) { return; }
		if(Type === "response.created" || Type === "response.in_progress") { this.Response = V.response ?? this.Response; }
		if(Type === "response.output_text.delta" || Type === "response.refusal.delta") { if(typeof V.delta === "string") { this.append(V.delta); } }
		if(["response.completed", "response.incomplete", "response.failed", "response.cancelled"].includes(Type))
		{
			this.Response = V.response ?? this.Response;
			this.Terminal = parse_api_result(this.Response, "responses", this.RequestId);
			if(!this.Terminal.Result.Text && this.Text) { this.Terminal.Result.Text = this.Text; }
			this.Done = true;
		}
	}
	result(Reason = "eof-without-terminal"): ApiResult
	{
		if(this.Terminal) { return this.Terminal; }
		const Parsed = parse_api_result(this.Protocol === "chat" ? this.Chat : this.Response, this.Protocol, this.RequestId);
		if(this.Protocol === "chat" && this.Chat.choices[0].finish_reason != null) { return Parsed; }
		return { ...Parsed, Calls: [], Result: { Text: this.Text || Parsed.Result.Text, Status: "unknown", Metadata: { ...Parsed.Result.Metadata, Reason, Submission: "unknown" } } };
	}
}
