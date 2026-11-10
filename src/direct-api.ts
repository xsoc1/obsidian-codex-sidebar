import { api_reasoning_supported, type ApiReasoning, type BackendProfile } from "./backend-profile";
import type { BackendInput, StructuredBackendDriver, BackendMessage } from "./backend";
import type { BackendMetadata, BackendResult } from "./backend-result";
import { api_protocol } from "./backend-capabilities";
import { parse_api_result, ApiStreamAccumulator, ApiReplayError, api_chat_tool_calls, api_error_reason, ApiOpaqueBudget, type ApiResult } from "./api-result";
import { SseDecoder, stream_step, DefaultStreamBudget, type StreamBudget } from "./api-sse";
import { HistoryReadTool } from "./history-budget";
import type { BrowserRequest } from "./browser-http";
import { ProductVersion } from "./version";

type Profile = Extract<BackendProfile, { Kind: "api" }>;
type NativeRequest = (Value: BrowserRequest) => PromiseLike<{ status: number; json: any; headers?: Record<string, string> }>;
export interface DirectApiOptions { Fetch?: typeof fetch; Budget?: Partial<StreamBudget>; }
export const ApiHistoryBudget = { MaxCalls: 6, MaxRounds: 4, MaxOutputUtf8Bytes: 32000, MaxRequestUtf8Bytes: 12 * 1024 * 1024 } as const;
const Encoder = new TextEncoder();
function redact<T>(Value: T, Secret: string): T
{
	if(typeof Value === "string") { return Value.replaceAll(Secret, "[redacted]") as T; }
	if(Array.isArray(Value)) { return Value.map(V => redact(V, Secret)) as T; }
	if(Value && typeof Value === "object") { return Object.fromEntries(Object.entries(Value).map(([K, V]) => [K.replaceAll(Secret, "[redacted]"), /^(thought_signature|encrypted_content)$/i.test(K) ? "[redacted]" : redact(V, Secret)])) as T; }
	return Value;
}

export function direct_api_key(Value: string): string
{
	const Key = Value.trim();
	if(!/^[!-~]{8,1024}$/.test(Key)) { throw new Error("请填写该服务商的 API Key"); }
	return Key;
}

function chat_message(Message: BackendMessage)
{
	return { role: Message.Role, content: Message.Images?.length ? [
		{ type: "text", text: Message.Text },
		...Message.Images.map(url => ({ type: "image_url", image_url: { url } }))
	] : Message.Text };
}

function chat_reasoning(Provider: Profile["Provider"], Format: ApiReasoning["Format"] | undefined, Effort?: string): object
{
	if(!Effort) { return {}; }
	if(Provider === "deepseek") { return Effort === "none" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: Effort }; }
	if(Provider === "google" && Format === "gemini-level") { return { extra_body: { google: { thinking_config: { thinking_level: Effort } } } }; }
	return { reasoning_effort: Effort };
}

function http_failure(Status: number, Value?: unknown): ApiResult
{
	const Hint = Status === 401 || Status === 403 ? "核对密钥、项目权限及模型可用性" : Status === 429 ? "核对额度或频率限制" : Status === 400 ? "请求协议或参数被拒绝" : "服务商请求失败";
	const Detail = Value ? api_error_reason(Value) : "";
	return { Result: { Text: "", Status: "failed", Metadata: { Reason: `API HTTP ${Status}. ${Hint}${Detail && Detail !== "provider-error" ? "; " + Detail : ""}`, Submission: "rejected", Wait: "finished" } }, Calls: [], Value: null };
}

function unknown_result(Reason: string, Transport: "streaming" | "buffered"): ApiResult
{
	return { Result: { Text: "", Status: "unknown", Metadata: { Reason, Submission: "unknown", Wait: "stopped", Transport } }, Calls: [], Value: null };
}

async function streaming_request(Request: BrowserRequest, Protocol: "chat" | "responses", Input: BackendInput, Signal: AbortSignal, Options: DirectApiOptions, AccountBytes: (Bytes: number) => void, OnOpaque: (Value: string) => void): Promise<ApiResult>
{
	const Budget = { ...DefaultStreamBudget, ...Options.Budget }, Start = Date.now(), Controller = new AbortController();
	const Stop = () => Controller.abort();
	Signal.addEventListener("abort", Stop, { once: true });
	let Reader: ReadableStreamDefaultReader<Uint8Array> | undefined, Stream: ApiStreamAccumulator | undefined, Bytes = 0, FirstEvent: number | undefined, FirstText: number | undefined;
	const Remaining = () => Budget.TotalMs - (Date.now() - Start);
	try
	{
		Signal.throwIfAborted();
		const Response = await stream_step((Options.Fetch ?? globalThis.fetch)(Request.url, {
			method: "POST", headers: Request.headers, body: Request.body, signal: Controller.signal, credentials: "omit", cache: "no-store", redirect: "error"
		}), Math.min(Budget.FirstEventMs, Remaining()), "等待首个 API 事件超时", Signal);
		if(Response.status < 200 || Response.status >= 300)
		{
			let Value: unknown;
			try
			{
				if(Response.body)
				{
					Reader = Response.body.getReader();
					const Decode = new TextDecoder(); let ErrorText = "", ErrorBytes = 0;
					while(ErrorBytes <= 8192)
					{
						const Chunk = await stream_step(Reader.read(), Math.min(Budget.IdleMs, Remaining()), "读取 API 错误超时", Signal);
						if(Chunk.done) { try { Value = JSON.parse(ErrorText + Decode.decode()); } catch {} break; }
						AccountBytes(Chunk.value.byteLength); ErrorBytes += Chunk.value.byteLength;
						if(ErrorBytes <= 8192) { ErrorText += Decode.decode(Chunk.value, { stream: true }); }
					}
				}
			}
			catch { /* An unreadable error body cannot undo the observed HTTP rejection. */ }
			return http_failure(Response.status, Value);
		}
		if(!Response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") || !Response.body)
		{
			return unknown_result("服务商未返回 SSE 流; 未自动重发, 可显式切换整段响应模式", "streaming");
		}
		Stream = new ApiStreamAccumulator(Protocol, Text => { FirstText ??= Date.now() - Start; Input.OnDelta?.(Text); }, Response.headers.get("x-request-id") ?? undefined, OnOpaque);
		const Decoder = new SseDecoder(Frame =>
		{
			FirstEvent ??= Date.now() - Start;
			Stream!.accept(Frame);
			Input.OnMetadata?.({ ...Stream!.metadata(), Transport: "streaming" });
		});
		Reader = Response.body.getReader();
		while(!Stream.Done)
		{
			const Wait = FirstEvent === undefined ? Budget.FirstEventMs - (Date.now() - Start) : Budget.IdleMs;
			const Chunk = await stream_step(Reader.read(), Math.min(Wait, Remaining()), FirstEvent === undefined ? "等待首个 API 事件超时" : Remaining() <= Budget.IdleMs ? "API 整体运行预算已到" : "API 流空闲超时", Signal);
			if(Chunk.done) { Decoder.finish(); break; }
			Bytes += Chunk.value.byteLength;
			AccountBytes(Chunk.value.byteLength);
			if(Bytes > Budget.MaxBytes) { throw new Error("API 流超过字节预算"); }
			Decoder.push(Chunk.value);
		}
		const Parsed = Stream.result();
		Parsed.Result.Metadata = { ...Parsed.Result.Metadata, Transport: "streaming", FirstEventMs: FirstEvent, FirstTextMs: FirstText, ElapsedMs: Date.now() - Start };
		return Parsed;
	}
	catch(E)
	{
		const Parsed = Stream?.result(Signal.aborted ? "stopped-waiting" : E instanceof Error ? E.message : "stream-interrupted") ?? unknown_result(Signal.aborted ? "已停止等待，服务端取消未确认" : "API 流式请求未建立；可在设置改为「原生整段」并点「启用 API 直连」。原请求待核对，未自动重发", "streaming");
		if(E instanceof ApiReplayError)
		{
			Parsed.Calls = []; Parsed.Result.Status = Parsed.Result.Text ? "partial" : "failed";
			Parsed.Result.Metadata = { ...Parsed.Result.Metadata, Reason: E.message, Submission: "submitted", Wait: "finished" };
		}
		Parsed.Result.Metadata = { ...Parsed.Result.Metadata, Transport: "streaming", Wait: Signal.aborted ? "stopped" : Parsed.Result.Metadata.Wait, FirstEventMs: FirstEvent, FirstTextMs: FirstText, ElapsedMs: Date.now() - Start };
		return Parsed;
	}
	finally
	{
		Signal.removeEventListener("abort", Stop);
		// Cancelling the transport does not confirm server-side cancellation.
		void Reader?.cancel().catch(() => {}); Controller.abort();
	}
}

export function direct_api(Profile: Profile, Key: string, Send: NativeRequest, Reasoning?: ApiReasoning, Options: DirectApiOptions = {}): StructuredBackendDriver
{
	Key = direct_api_key(Key);
	Reasoning = Reasoning ? { ...Reasoning, Efforts: [...Reasoning.Efforts] } : undefined;
	const Frozen = { ...Profile }, Protocol = api_protocol(Frozen, Reasoning), Buffered = Frozen.Stream === "buffered";
	return async (Input, Signal) =>
	{
		const Opaque = new Set<string>();
		const RememberOpaque = (Value: string) => { Opaque.add(Value); };
		const Clean = <T>(V: T): T => { let Safe = redact(V, Key); for(const S of Opaque) { Safe = redact(Safe, S); } return Safe; };
		Signal.throwIfAborted();
		const { Session, Messages, Effort } = Input, Started = Date.now(), Budget = { ...DefaultStreamBudget, ...Options.Budget };
		if(Effort && (!api_reasoning_supported(Frozen.Provider) || !Reasoning?.Efforts.includes(Effort))) { throw new Error("当前模型不支持所选思考档次"); }
		if(!Frozen.Vision && Messages.some(M => M.Images?.length)) { throw new Error("当前 API 模型未启用图像输入"); }
		const HistoryRead = Frozen.HistoryTools !== false && (Frozen.Provider !== "compatible" || Frozen.HistoryTools === true) ? Input.HistoryRead : undefined;
		const Tools = HistoryRead ? [{ type: "function", ...(Protocol === "responses" ? { name: HistoryReadTool.name, description: HistoryReadTool.description, parameters: HistoryReadTool.inputSchema, strict: false } : { function: { name: HistoryReadTool.name, description: HistoryReadTool.description, parameters: HistoryReadTool.inputSchema } }) }] : undefined;
		const Conversation: any[] = Protocol === "responses" ? Messages.map(M => ({
			role: M.Role === "system" ? "developer" : M.Role,
			content: M.Images?.length ? [{ type: "input_text", text: M.Text }, ...M.Images.map(image_url => ({ type: "input_image", image_url, detail: "auto" }))] : M.Text
		})) : Messages.map(chat_message);
		let Calls = 0, OutputBytes = 0, ResponseBytes = 0, OpaqueBytes = 0, SuccessfulReads = 0, Prefix = "";
		const AccountBytes = (Bytes: number) => { ResponseBytes += Bytes; if(ResponseBytes > Budget.MaxBytes) { throw new ApiReplayError("API 响应累计超过字节预算; 未提交后续请求"); } };
		const Aggregate: BackendMetadata = { Transport: Buffered ? "buffered" : "streaming", Receipts: [], Usage: [] };
		const Finish = (Result: BackendResult): BackendResult =>
		{
			const Text = Prefix + Result.Text, Limited = Text.length > 2_000_000;
			return Clean({ ...Result, Text: Text.slice(0, 2_000_000), ...(Limited ? { Status: "partial" } : {}), Metadata: { ...Result.Metadata, ...Aggregate,
				...(Aggregate.Receipts?.length ? { Receipts: Aggregate.Receipts } : { Receipts: undefined }), ...(Aggregate.Usage?.length ? { Usage: Aggregate.Usage } : { Usage: undefined }), ...(Limited ? { Reason: "output-limit" } : {}), ElapsedMs: Date.now() - Started } });
		};
		for(let Round = 0; Round <= ApiHistoryBudget.MaxRounds; Round++)
		{
			if(Signal.aborted) { return Finish(unknown_result("stopped-waiting", Buffered ? "buffered" : "streaming").Result); }
			const Request = Protocol === "responses"
				? { model: Frozen.Model, store: false, stream: !Buffered, ...(Effort ? { reasoning: { effort: Effort } } : {}), input: Conversation, ...(Tools ? { tools: Tools, parallel_tool_calls: false } : {}) }
				: { model: Frozen.Model, messages: Conversation, stream: !Buffered, ...(!Buffered ? { stream_options: { include_usage: true } } : {}), ...chat_reasoning(Frozen.Provider, Reasoning?.Format, Effort), ...(Tools ? { tools: Tools, parallel_tool_calls: false } : {}) };
			const Body = JSON.stringify(Request);
			if(Encoder.encode(Body).byteLength > ApiHistoryBudget.MaxRequestUtf8Bytes)
			{
				if(!Round) { throw new Error("当前 API 输入过长, 请缩小选区或开启新会话"); }
				return Finish({ Text: "", Status: "partial", Metadata: { Reason: "历史工具后续输入超过预算; 未提交后续请求", Submission: "submitted", Wait: "finished" } });
			}
			const Headers = { Authorization: `Bearer ${Key}`, "Content-Type": "application/json", Accept: Buffered ? "application/json" : "text/event-stream",
				...(Frozen.Provider === "opencode" ? { "User-Agent": `Obsidian-Codex-Sidebar/${ProductVersion}`, "x-opencode-session": `ses_${Session.replace(/[^a-z0-9]/gi, "")}` } : {}) };
			const Http: BrowserRequest = { url: Frozen.Base + (Protocol === "responses" ? "/responses" : "/chat/completions"), method: "POST", headers: Headers, body: Body };
			let Parsed: ApiResult;
			const Remaining = Budget.TotalMs - (Date.now() - Started);
			if(Remaining <= 0) { return Finish(unknown_result("API 整体运行预算已到", Buffered ? "buffered" : "streaming").Result); }
			Input.OnMetadata?.({ Submission: "submitted", Transport: Buffered ? "buffered" : "streaming" });
			if(Buffered)
			{
				let TimedOut = false;
				try
				{
					// requestUrl cannot be aborted; the original result remains observable after local stop.
					const Pending = Promise.resolve(Send(Http)).then(Result =>
					{
						let Json: any, InvalidJson = false;
						try { Json = Result.json; } catch { InvalidJson = true; }
						const Value = Result.status < 200 || Result.status >= 300 ? http_failure(Result.status, Clean(Json)) : InvalidJson
							? unknown_result(`API 原生整段收到 HTTP ${Result.status}，但正文不是有效 JSON；原请求待核对，未自动重发`, "buffered")
							: parse_api_result(Json, Protocol, Result.headers?.["x-request-id"], RememberOpaque);
						if(InvalidJson && Value.Result.Status === "unknown") { Value.Result.Metadata.Wait = "finished"; }
						try { AccountBytes(Encoder.encode(JSON.stringify(Json) ?? "").byteLength); }
						catch(E)
						{
							if(!(E instanceof ApiReplayError)) { throw E; }
							Value.Calls = []; Value.Result = { ...Value.Result, Status: "partial", Metadata: { ...Value.Result.Metadata, Reason: E.message } };
						}
						if(TimedOut)
						{
							const Late = Finish(Value.Calls.length ? { ...Value.Result, Status: "partial", Metadata: { ...Value.Result.Metadata, Reason: "已停止等待; 历史工具尚未执行, 未发起后续推理" } } : Value.Result);
							const Receipts = [...(Late.Metadata.Receipts ?? []), ...(Value.Result.Metadata.Receipts ?? [])], Usage = [...(Late.Metadata.Usage ?? []), ...(Value.Result.Metadata.Usage ?? [])];
							if(Receipts.length) { Late.Metadata.Receipts = Receipts; }
							if(Usage.length) { Late.Metadata.Usage = Usage; }
							Input.OnLateResult?.(Clean(Late));
						}
						return Value;
					});
					Parsed = await stream_step(Pending, Remaining, "API 整体运行预算已到");
				}
				catch { TimedOut = true; Parsed = unknown_result("API 原生整段请求失败或超时，服务端结果待核对；未自动重发", "buffered"); }
			}
			else
			{
				let Tail = "";
				Parsed = await streaming_request(Http, Protocol, { ...Input, OnDelta: Text =>
				{
					const Redacted = (Tail + Text).replaceAll(Key, "[redacted]");
					let Hold = Math.min(Key.length - 1, Redacted.length);
					while(Hold && !Key.startsWith(Redacted.slice(-Hold))) { Hold--; }
					Tail = Hold ? Redacted.slice(-Hold) : "";
					const Safe = Redacted.slice(0, Redacted.length - Hold);
					if(Safe) { Input.OnDelta?.(Safe); }
				}, OnMetadata: M => Input.OnMetadata?.(Clean(M)) }, Signal, { ...Options, Budget: { ...Budget, TotalMs: Remaining } }, AccountBytes, RememberOpaque);
				if(Tail) { Input.OnDelta?.(Tail); }
			}
			Aggregate.Receipts!.push(...(Parsed.Result.Metadata.Receipts ?? [])); Aggregate.Usage!.push(...(Parsed.Result.Metadata.Usage ?? []));
			if(Round && !["completed", "refused"].includes(Parsed.Result.Status))
			{
				Parsed.Result.Metadata.Reason = `${SuccessfulReads ? "历史读取完成" : "历史工具已返回失败结果"}, 后续模型请求失败或未完成; ${Parsed.Result.Metadata.Reason ?? Parsed.Result.Status}`;
			}
			if(Prefix.length + Parsed.Result.Text.length > 2_000_000) { return Finish(Parsed.Result); }
			if(!Parsed.Calls.length || Parsed.Result.Status !== "completed") { return Finish(Parsed.Result); }
			const StopTools = (Reason: string) => Finish({ ...Parsed.Result, Status: "partial", Metadata: { ...Parsed.Result.Metadata, Reason } });
			if(Protocol === "chat")
			{
				try
				{
					const Message = Parsed.Value.choices[0].message;
					Message.tool_calls = api_chat_tool_calls(Message.tool_calls);
					for(const Call of Message.tool_calls)
					{
						const S = Call.extra_content?.google.thought_signature;
						if(S !== undefined) { Opaque.add(S); OpaqueBytes += Encoder.encode(S).byteLength; }
					}
					if(OpaqueBytes > ApiOpaqueBudget.MaxOperationUtf8Bytes) { return StopTools("工具签名累计超过操作预算; 未提交后续请求"); }
				}
				catch(E) { return StopTools(E instanceof ApiReplayError ? E.message : "工具续轮结构无效; 未提交后续请求"); }
			}
			if(!HistoryRead || Round >= ApiHistoryBudget.MaxRounds || Calls + Parsed.Calls.length > ApiHistoryBudget.MaxCalls) { return StopTools("历史工具调用预算已到; 请明确选择下一轮继续"); }
			if(Signal.aborted) { return StopTools("已停止等待; 未发起工具后续推理"); }
			const Ids = new Set<string>();
			for(const C of Parsed.Calls)
			{
				if(Signal.aborted) { return StopTools("已停止等待; 未发起工具后续推理"); }
				if(C.Name !== HistoryReadTool.name || typeof C.Id !== "string" || !C.Id || Ids.has(C.Id) || typeof C.Arguments !== "string" || C.Arguments.length > 16384) { return StopTools("拒绝未授权或无效工具调用"); }
				Ids.add(C.Id);
			}
			const Outputs: { Id: string; Text: string }[] = [];
			for(const C of Parsed.Calls)
			{
				let Args: unknown;
				try { Args = JSON.parse(C.Arguments); } catch { return StopTools("历史工具参数不是有效 JSON"); }
				Calls++;
				let Output: string;
				if(Signal.aborted) { return StopTools("已停止等待; 未发起工具后续推理"); }
				try
				{
					const Result = await stream_step(HistoryRead(Args), Budget.TotalMs - (Date.now() - Started), "历史读取超时", Signal);
					if(Result.success) { SuccessfulReads++; }
					Output = JSON.stringify(Result);
				}
				catch { return StopTools("历史工具读取未完成; 未发起后续推理"); }
				OutputBytes += Encoder.encode(Output).byteLength;
				if(OutputBytes > ApiHistoryBudget.MaxOutputUtf8Bytes) { return StopTools("历史工具输出超过 32000 UTF8 字节预算"); }
				Outputs.push({ Id: C.Id, Text: Output });
			}
			if(Protocol === "responses") { Conversation.push(...Parsed.Value.output, ...Outputs.map(O => ({ type: "function_call_output", call_id: O.Id, output: O.Text }))); }
			else
			{
				const Message = Parsed.Value.choices[0].message;
				Conversation.push({ role: "assistant", content: Message.content ?? null, tool_calls: Message.tool_calls,
					...(typeof Message.reasoning_content === "string" ? { reasoning_content: Message.reasoning_content } : {}), ...(typeof Message.refusal === "string" ? { refusal: Message.refusal } : {})
				}, ...Outputs.map(O => ({ role: "tool", tool_call_id: O.Id, content: O.Text })));
			}
			Prefix += Parsed.Result.Text;
		}
		throw new Error("历史工具回合预算无效");
	};
}
