import { backend_model, type BackendProfile, type ApiCatalogModel } from "./backend-profile";
import type { RpcConnection } from "./remote";
import type { RpcMessage } from "./rpc";
import { normalize_backend_result, type BackendResult, type BackendMetadata, type BackendHistoryRead } from "./backend-result";
import { backend_capabilities, type BackendCapabilities } from "./backend-capabilities";
export type { BackendResult, BackendMetadata, BackendHistoryRead } from "./backend-result";

export interface BackendMessage
{
	Role: "system" | "user" | "assistant";
	Text: string;
	Images?: string[];
}
export interface BackendInput
{
	Session: string;
	Messages: BackendMessage[];
	Effort?: string;
	HistoryRead?: (Args: unknown) => ReturnType<BackendHistoryRead>;
	OnDelta?: (Text: string) => void;
	OnMetadata?: (Metadata: BackendMetadata) => void;
	OnLateResult?: (Result: BackendResult) => void;
}
export type BackendDriver = (Input: BackendInput, Signal: AbortSignal) => Promise<BackendResult | string>;
export type StructuredBackendDriver = (Input: BackendInput, Signal: AbortSignal) => Promise<BackendResult>;
export class BackendResultUnknown extends Error {}
export interface BackendConnectionOptions { HistoryRead?: BackendHistoryRead; Catalog?: ApiCatalogModel[]; Capabilities?: BackendCapabilities; }
interface Thread { Session: string; Instructions: string; History: BackendMessage[]; }
interface PendingTurn { ThreadId: string; ItemId: string; Input: BackendInput; Controller: AbortController; Started: boolean; }

export async function backend_generate(Driver: BackendDriver, Input: BackendInput, Signal: AbortSignal): Promise<BackendResult>
{
	Signal.throwIfAborted();
	let Abort!: () => void, Text = "", Metadata: BackendMetadata = {}, Stopped = false, Settled = false;
	let StopTimer: ReturnType<typeof setTimeout> | undefined;
	const Work = Promise.resolve().then(() =>
	{
		Signal.throwIfAborted();
		return Driver({ ...Input,
			OnDelta: Delta => { Text += Delta; Input.OnDelta?.(Delta); },
			OnMetadata: M => { Metadata = { ...Metadata, ...M }; Input.OnMetadata?.(M); }
		}, Signal);
	}).then(normalize_backend_result).catch(E =>
	{
		const Unknown = E instanceof BackendResultUnknown || Metadata.Submission === "submitted" || Metadata.Submission === "unknown";
		return { Text, Status: Unknown ? "unknown" : Signal.aborted ? "cancelled" : "failed", Metadata: {
			...Metadata, Reason: E instanceof Error ? E.message : "后端请求失败", Submission: Unknown ? "unknown" : Metadata.Submission ?? "not-submitted", Wait: Signal.aborted ? "stopped" : "finished"
		} } as BackendResult;
	});
	const Observed = Work.then(Result =>
	{
		Settled = true;
		if(Stopped) { Input.OnLateResult?.(Result); }
		return Result;
	});
	const Cancel = new Promise<BackendResult>(Resolve =>
	{
		Abort = () =>
		{
			// Let a terminal frame already being processed settle before local stop wins.
			StopTimer = setTimeout(() =>
			{
				if(Settled) { return; }
				Stopped = true;
				Resolve({ Text, Status: Metadata.Submission === "not-submitted" ? "cancelled" : "unknown", Metadata: {
					...Metadata, Reason: Metadata.Submission === "not-submitted" ? "已停止, 请求未提交" : "已停止等待; 服务端取消未确认", Wait: "stopped", Submission: Metadata.Submission === "not-submitted" ? "not-submitted" : "unknown"
				} });
			}, 0);
		};
		Signal.addEventListener("abort", Abort, { once: true });
		if(Signal.aborted) { Abort(); }
	});
	try
	{
		return await Promise.race([Observed, Cancel]);
	}
	finally { clearTimeout(StopTimer); Signal.removeEventListener("abort", Abort); }
}

function backend_message(Role: BackendMessage["Role"], Content: unknown): BackendMessage
{
	if(!Array.isArray(Content)) { throw new Error("对话输入格式无效"); }
	const Text: string[] = [], Images: string[] = [];
	for(const Part of Content)
	{
		if(["text", "input_text", "output_text"].includes(Part?.type) && typeof Part.text === "string") { Text.push(Part.text); continue; }
		const Image = Part?.type === "image" ? Part.url : Part?.type === "input_image" ? Part.image_url : "";
		if(Role === "user" && typeof Image === "string" && /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(Image)) { Images.push(Image); continue; }
		throw new Error("当前后端收到不支持的输入项");
	}
	return { Role, Text: Text.join("\n\n"), ...(Images.length ? { Images } : {}) };
}

// Local adapter for the existing sidebar lifecycle. No traffic is sent until the host has saved the turn binding.
export class BackendConnection implements RpcConnection
{
	private Threads = new Map<string, Thread>();
	private Turns = new Map<string, PendingTurn>();
	private Closed = false;
	readonly Capabilities: BackendCapabilities;
	constructor(private Profile: BackendProfile, private Driver: BackendDriver | null, private Emit: (Value: RpcMessage) => void, private Efforts: readonly string[] = [], private Options: BackendConnectionOptions = {})
	{
		this.Profile = { ...Profile };
		this.Capabilities = Options.Capabilities ?? backend_capabilities(Profile, { HistoryRead: Profile.Kind === "api" && !!Options.HistoryRead, ...(Profile.Kind === "api" && Profile.Stream === "buffered" ? { Streaming: false } : {}) });
	}

	async request(Method: string, Params: any): Promise<any>
	{
		if(this.Closed) { throw new Error("连接已关闭"); }
		const Model = backend_model(this.Profile);
		if(Method === "initialize") { return { backendCapabilities: this.Capabilities }; }
		if(Method === "account/read") { return { account: { type: "configured" } }; }
		if(Method === "model/list") { return { nextCursor: null, data: [{
			model: Model, displayName: this.Profile.Model || "Agent 当前模型", isDefault: true,
			supportedReasoningEfforts: this.Efforts.map(reasoningEffort => ({ reasoningEffort, description: "" })), defaultReasoningEffort: "",
			inputModalities: this.Profile.Kind === "api" && this.Profile.Vision ? ["text", "image"] : ["text"]
		}] }; }
		if(Method === "thread/start")
		{
			const Id = crypto.randomUUID(), Session = String(Params.clientSessionId || Id);
			for(const [Old, Thread] of this.Threads) { if(Thread.Session === Session) { this.Threads.delete(Old); } }
			this.Threads.set(Id, { Session, Instructions: Params.developerInstructions || "", History: [] });
			return { thread: { id: Id, ephemeral: true, path: null, turns: [] }, model: Model };
		}
		if(Method === "turn/interrupt")
		{
			const Pending = this.Turns.get(Params.turnId);
			if(!Pending || Pending.ThreadId !== Params.threadId) { throw new Error("该回复已结束或不在此连接中"); }
			Pending.Controller.abort(); this.Turns.delete(Params.turnId);
			if(!Pending.Started) { Pending.Started = true; void this.run_turn(Params.turnId, Pending); }
			return { stoppedWaiting: true, serverCancellation: "unknown" };
		}
		const Thread = this.Threads.get(Params.threadId);
		if(!Thread) { throw new Error("临时会话不存在, 请重连"); }
		if(Method === "thread/inject_items")
		{
			for(const Item of Params.items)
			{
				if(Item.type !== "message" || !["developer", "user", "assistant"].includes(Item.role)) { throw new Error("会话重放格式无效"); }
				const Message = backend_message(Item.role === "developer" ? "system" : Item.role, Item.content);
				if(Item.role === "developer" && Message.Text.startsWith("以下是当前 Obsidian Sidebar 的工作指令,")) { Thread.Instructions = Message.Text; }
				else { Thread.History.push(Message); }
			}
			return {};
		}
		if(Method === "turn/start")
		{
			if(this.Turns.size) { throw new Error("请等待当前回复完成"); }
			const Id = crypto.randomUUID(), User = backend_message("user", Params.input);
			const System: BackendMessage = { Role: "system", Text: [Thread.Instructions, ...Thread.History.filter(M => M.Role === "system").map(M => M.Text)].filter(Boolean).join("\n\n") };
			this.Turns.set(Id, { ThreadId: Params.threadId, ItemId: crypto.randomUUID(), Input: {
				Session: Thread.Session, Messages: [System, ...Thread.History.filter(M => M.Role !== "system"), User], ...(Params.effort ? { Effort: Params.effort } : {}),
				...(this.Capabilities.HistoryRead === true && this.Options.HistoryRead ? { HistoryRead: (Args: unknown) => this.Options.HistoryRead!(Args, Thread.Session) } : {})
			}, Controller: new AbortController(), Started: false });
			return { turn: { id: Id, status: "inProgress" } };
		}
		throw new Error("当前后端不支持此操作");
	}

	begin_turn(Id: string): void
	{
		const Turn = this.Turns.get(Id);
		if(!Turn || Turn.Started || this.Closed) { return; }
		Turn.Started = true;
		void this.run_turn(Id, Turn);
	}

	private async run_turn(Id: string, Turn: PendingTurn): Promise<void>
	{
		const ResultEvent = (Result: BackendResult, Late = false) => this.Emit({ method: "backend/result", params: {
			threadId: Turn.ThreadId, turnId: Id, sessionId: Turn.Input.Session, itemId: Turn.ItemId, result: Result, ...(Late ? { late: true } : {})
		} });
		const Result = await this.complete_result({ ...Turn.Input,
			OnDelta: Text =>
			{
				if(!this.Closed && !Turn.Controller.signal.aborted)
				{
					this.Emit({ method: "item/agentMessage/delta", params: { threadId: Turn.ThreadId, turnId: Id, itemId: Turn.ItemId, delta: Text } });
				}
			}, OnLateResult: Late => ResultEvent(Late, true)
		}, Turn.Controller.signal).catch(E => ({ Text: "", Status: "cancelled", Metadata: { Submission: "not-submitted", Wait: "stopped", Reason: E instanceof Error ? E.message : "未提交" } } as BackendResult));
		this.Turns.delete(Id);
		ResultEvent(Result, this.Closed);
		if(!this.Closed)
		{
			if(Result.Text)
			{
				this.Emit({ method: "item/completed", params: { threadId: Turn.ThreadId, turnId: Id, item: { id: Turn.ItemId, type: "agentMessage", phase: Result.Status === "completed" ? "final_answer" : "commentary", text: Result.Text, backendResult: Result } } });
			}
			this.Emit({ method: Result.Status === "unknown" ? "backend/result-unknown" : "turn/completed", params: { threadId: Turn.ThreadId, sessionId: Turn.Input.Session, backend: { result: Result }, turn: { id: Id, status: Result.Status, ...(Result.Metadata.Reason && Result.Status !== "completed" ? { error: { message: Result.Metadata.Reason } } : {}) } } });
		}
	}
	async complete_result(Input: BackendInput, Signal: AbortSignal): Promise<BackendResult>
	{
		if(!this.Driver) { throw new Error("连接已关闭"); }
		return backend_generate(this.Driver, Input, Signal);
	}

	async complete(Input: BackendInput, Signal: AbortSignal): Promise<string>
	{
		const Result = await this.complete_result(Input, Signal);
		if(Result.Status !== "completed") { throw new Error(Result.Metadata.Reason ?? "后端未返回完整正文"); }
		return Result.Text;
	}
	send(_Message: RpcMessage): void {}
	close(): void { this.Closed = true; this.Driver = null; for(const Turn of this.Turns.values()) { Turn.Controller.abort(); } this.Turns.clear(); this.Threads.clear(); }
}
