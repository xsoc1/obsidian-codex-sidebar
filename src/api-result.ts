import type { BackendMetadata, BackendReceipt, BackendResult, BackendUsage } from "./backend-result";
import type { SseEvent } from "./api-sse";

export interface ApiToolCall { Id: string; Name: string; Arguments: string; }
export interface ApiResult { Result: BackendResult; Calls: ApiToolCall[]; Value: any; }
const StringValue = (V: unknown): string | undefined => typeof V === "string" && V.length <= 1024 ? V : undefined;

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

export function parse_api_result(Value: any, Protocol: "chat" | "responses", RequestId?: string): ApiResult
{
	const Receipt: BackendReceipt = { ...(RequestId ? { RequestId } : {}), ...(StringValue(Value?.id) ? { ResponseId: Value.id } : {}) };
	const Usage = api_usage(Value?.usage, Object.keys(Receipt).length ? Receipt : undefined);
	const Metadata: BackendMetadata = {
		Submission: "submitted", Wait: "finished", ...(StringValue(Value?.model) ? { Model: Value.model } : {}),
		...(Object.keys(Receipt).length ? { Receipts: [Receipt] } : {}), ...(Usage ? { Usage: [Usage] } : {})
	};
	let Text = "", Refusal = "", Status: BackendResult["Status"] = "unknown", Reason = "missing-terminal", Calls: ApiToolCall[] = [];
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
		Reason = Value?.incomplete_details?.reason ?? Value?.error?.code ?? Value?.status ?? Reason;
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
		if(Array.isArray(Message?.tool_calls)) { Calls = Message.tool_calls.map((C: any) => ({ Id: C.id, Name: C.function?.name, Arguments: C.function?.arguments })); }
		Reason = Choice?.finish_reason ?? Reason;
		if(Reason === "stop") { Status = Refusal ? "refused" : "completed"; }
		else if(Reason === "length") { Status = "partial"; }
		else if(Reason === "content_filter") { Status = "refused"; }
		else if(Reason === "tool_calls") { Status = Calls.length ? "completed" : "unknown"; }
	}
	Text = [Text, Refusal].filter(Boolean).join("\n\n");
	if(Text.length > 2_000_000) { Text = Text.slice(0, 2_000_000); Status = "partial"; Reason = "output-limit"; }
	if(Status === "completed" && !Text.trim() && !Calls.length) { Status = "failed"; Reason = "empty-body"; }
	return { Result: { Text, Status, Metadata: { ...Metadata, Reason: typeof Reason === "string" ? Reason : "invalid-terminal" } }, Calls, Value };
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
	constructor(private Protocol: "chat" | "responses", private Delta: (Text: string) => void, private RequestId?: string) {}
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
			if(!this.Terminal) { this.Terminal = { Result: { Text: this.Text, Status: this.Text ? "partial" : "failed", Metadata: { ...this.metadata(), Reason: String(V.error?.code ?? V.code ?? "stream-error"), Submission: "submitted", Wait: "finished" } }, Calls: [], Value: V }; }
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
				if(!Number.isSafeInteger(Call.index) || Call.index < 0 || Call.index >= 8) { throw new Error("工具调用索引无效"); }
				const C = this.Calls.get(Call.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
				if(typeof Call.id === "string") { C.id = Call.id; }
				C.function.name += Call.function?.name ?? ""; C.function.arguments += Call.function?.arguments ?? "";
				if(C.function.arguments.length > 16384) { throw new Error("工具参数超过限制"); }
				this.Calls.set(Call.index, C);
			}
			if(Choice.finish_reason != null) { this.Chat.choices[0].finish_reason = Choice.finish_reason; }
			Message.tool_calls = [...this.Calls.values()];
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
