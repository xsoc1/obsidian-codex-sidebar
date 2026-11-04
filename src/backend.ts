import { backend_model, type BackendProfile } from "./backend-profile";
import type { RpcConnection } from "./remote";
import type { RpcMessage } from "./rpc";

export interface BackendMessage
{
	Role: "system" | "user" | "assistant";
	Text: string;
	Images?: string[];
}
export interface BackendInput { Session: string; Messages: BackendMessage[]; Effort?: string; }
export type BackendDriver = (Input: BackendInput, Signal: AbortSignal) => Promise<string>;
export class BackendResultUnknown extends Error {}
interface Thread { Session: string; Instructions: string; History: BackendMessage[]; }
interface PendingTurn { ThreadId: string; Input: BackendInput; Controller: AbortController; Started: boolean; }

export async function backend_generate(Driver: BackendDriver, Input: BackendInput, Signal: AbortSignal): Promise<string>
{
	Signal.throwIfAborted();
	let Abort!: () => void;
	const Cancel = new Promise<never>((_, Reject) =>
	{
		Abort = () => Reject(new Error("已停止等待; 请求可能已到达服务端"));
		Signal.addEventListener("abort", Abort, { once: true });
	});
	try
	{
		const Answer = await Promise.race([Driver(Input, Signal), Cancel]);
		if(typeof Answer !== "string" || !Answer.trim() || Answer.length > 2_000_000) { throw new Error("后端返回的正文为空或超过长度限制"); }
		return Answer;
	}
	finally { Signal.removeEventListener("abort", Abort); }
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
	constructor(private Profile: BackendProfile, private Driver: BackendDriver | null, private Emit: (Value: RpcMessage) => void, private Efforts: readonly string[] = []) {}

	async request(Method: string, Params: any): Promise<any>
	{
		if(this.Closed) { throw new Error("连接已关闭"); }
		const Model = backend_model(this.Profile);
		if(Method === "initialize") { return {}; }
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
			Pending.Controller.abort();
			return {};
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
			this.Turns.set(Id, { ThreadId: Params.threadId, Input: {
				Session: Thread.Session, Messages: [System, ...Thread.History.filter(M => M.Role !== "system"), User], ...(Params.effort ? { Effort: Params.effort } : {})
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
		let Status = "completed", ErrorText: string | undefined, Unknown = false;
		try
		{
			const Text = await this.complete(Turn.Input, Turn.Controller.signal);
			if(!this.Closed && !Turn.Controller.signal.aborted)
			{
				this.Emit({ method: "item/completed", params: { threadId: Turn.ThreadId, turnId: Id, item: { id: crypto.randomUUID(), type: "agentMessage", phase: "final_answer", text: Text } } });
			}
		}
		catch(ErrorValue) { Status = "failed"; Unknown = ErrorValue instanceof BackendResultUnknown; ErrorText = ErrorValue instanceof Error ? ErrorValue.message : "后端请求失败"; }
		finally
		{
			this.Turns.delete(Id);
			if(!this.Closed)
			{
				this.Emit({ method: Unknown && !Turn.Controller.signal.aborted ? "backend/result-unknown" : "turn/completed", params: { threadId: Turn.ThreadId, turn: { id: Id, status: Turn.Controller.signal.aborted ? "interrupted" : Status, ...(ErrorText ? { error: { message: ErrorText } } : {}) } } });
			}
		}
	}

	async complete(Input: BackendInput, Signal: AbortSignal): Promise<string>
	{
		if(!this.Driver) { throw new Error("连接已关闭"); }
		return backend_generate(this.Driver, Input, Signal);
	}
	send(_Message: RpcMessage): void {}
	close(): void { this.Closed = true; this.Driver = null; for(const Turn of this.Turns.values()) { Turn.Controller.abort(); } this.Turns.clear(); this.Threads.clear(); }
}
