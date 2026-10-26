import type { RpcMessage } from "./rpc";
import { restore_sessions, type SessionState } from "./sessions";
import { DeltaSyncClient } from "./sync/client";
import { content_digest, type SendOperation } from "./sync/types";

export interface RemoteConfig
{
	Enabled: boolean;
	Url: string;
	Token: string;
	Cursor: number;
	Server: string;
	CacheId?: string;
	Transport?: "browser" | "native";
}

export interface RpcConnection
{
	request(Method: string, Params: any): Promise<any>;
	send(Message: RpcMessage): void;
	close(): void;
}

export type HttpRequest = (Url: string, Method: string, Body?: unknown) => Promise<any>;

export function remote_url(Value: string): string
{
	const Url = new URL(Value);
	if(Url.username || Url.password || Url.search || Url.hash || (Url.protocol !== "https:" && !(Url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(Url.hostname))))
	{
		throw new Error("远程地址需要 HTTPS, 本机测试可用 localhost HTTP. 地址不得包含凭据或查询参数");
	}
	return Url.href.replace(/\/$/, "");
}

export class RemoteConnection implements RpcConnection
{
	private Closed = false;
	private Timer: ReturnType<typeof setTimeout> | null = null;
	private StateQueue: Promise<void> = Promise.resolve();
	private Cursor: number;
	private Delta: DeltaSyncClient | null = null;
	private Started = false;
	private Polling = false;
	private Recovery: (() => Promise<void>) | null = null;
	private LastState: SessionState | null = null;
	private Retry = 0;
	private Waiting: ReturnType<typeof setTimeout> | null = null;
	private Wake: (() => void) | null = null;
	private Delays = new Map<ReturnType<typeof setTimeout>, () => void>();
	private ResumeCheck = false;
	Server = "";
	Info: any;

	constructor(private Http: HttpRequest, private Config: RemoteConfig, private OnMessage: (Message: RpcMessage) => void, private OnClosed: (ErrorValue: Error) => void, private Save: () => void)
	{
		this.Cursor = Config.Cursor;
	}

	async connect(): Promise<void>
	{
		this.Info = await this.query("/info");
		this.Server = this.Info.server;
		if(this.Config.Server !== this.Server)
		{
			this.Cursor = 0;
			this.Config.Cursor = 0;
			this.Config.Server = this.Server;
			this.Save();
		}
		if(this.Info.protocolVersion >= 2 && this.Info.capabilities?.incrementalSync === 1 && typeof this.Info.dataIdentity === "string" && typeof this.Info.client === "string") { this.Delta = new DeltaSyncClient((Path, Method, Body) => Method === "GET" ? this.query(Path) : this.Http(Path, Method, Body), this.scope()); }
	}
	scope(): string { return this.Info?.dataIdentity && this.Info?.client ? this.Info.dataIdentity + ":" + this.Info.client : "legacy:" + (this.Info?.client ?? this.Config.CacheId ?? this.Config.Url); }
	set_recovery(Recover: () => Promise<void>): void { this.Recovery = Recover; }
	conflicts(): readonly { Key: string; Reason: string; Local: unknown; Remote: unknown }[] { return this.Delta?.Conflicts ?? []; }
	private pause(Milliseconds: number): Promise<void>
	{
		if(this.Closed) { return Promise.resolve(); }
		return new Promise(Resolve => { const Timer = setTimeout(() => { this.Delays.delete(Timer); Resolve(); }, Milliseconds); this.Delays.set(Timer, Resolve); });
	}
	private async query(Path: string): Promise<any>
	{
		let ErrorValue: unknown;
		for(let Attempt = 0; Attempt < 3; Attempt++)
		{
			if(this.Closed) { throw new Error("远程连接已关闭"); }
			try { const Value = await this.Http(Path, "GET"); if(this.Closed) { throw new Error("远程连接已关闭"); } return Value; }
			catch(Error) { ErrorValue = Error; if(Attempt < 2) { await this.pause(100 * (Attempt + 1)); } }
		}
		throw ErrorValue;
	}
	async restore_state<T extends SessionState>(Local: T, Linked: readonly string[] = [], FollowLocal = true): Promise<T>
	{
		if(this.Delta)
		{
			const Result = await this.Delta.restore(Local, Linked, FollowLocal); this.LastState = Result.State; this.set_cursor(Result.Cursor); return Result.State;
		}
		const Result = await this.query("/state");
		const State = Result.state?.Sessions?.length ? restore_sessions(Local, Result.state, Linked, FollowLocal) : Local;
		this.LastState = State; this.set_cursor(Result.cursor ?? 0); return State;
	}

	set_cursor(Cursor: number): void
	{
		this.Cursor = Cursor;
		this.Config.Cursor = Cursor;
		this.Save();
	}

	start(): void
	{
		if(!this.Closed && !this.Started)
		{
			this.Started = true;
			void this.poll();
		}
	}
	resume(): void { if(this.Closed) { return; } this.ResumeCheck = true; if(this.Polling) { return; } if(this.Timer) { clearTimeout(this.Timer); this.Timer = null; } this.Started = true; void this.poll(); }
	private async recover_snapshot(): Promise<void>
	{
		const Info = await this.query("/info"), Scope = this.scope(), NewScope = Info.dataIdentity ? Info.dataIdentity + ":" + Info.client : "legacy:" + (Info.client ?? this.Config.CacheId ?? this.Config.Url);
		if(NewScope !== Scope && Scope !== "legacy:" + Info.client) { throw new Error("远程稳定身份变化, 停止自动恢复并保留本机记录"); }
		if(this.Delta && Info.capabilities?.incrementalSync !== 1) { throw new Error("远程协议能力降级, 不退回可能覆盖历史的旧同步"); }
		this.Info = Info;
		if(!this.Delta && Info.protocolVersion >= 2 && Info.capabilities?.incrementalSync === 1) { this.Delta = new DeltaSyncClient((Path, Method, Body) => Method === "GET" ? this.query(Path) : this.Http(Path, Method, Body), this.scope()); }
		if(this.Server !== Info.server) { this.Server = Info.server; this.Config.Server = Info.server; this.Cursor = 0; }
		if(this.Recovery) { await this.Recovery(); }
		else if(this.LastState) { const Prior = this.LastState, State = await this.restore_state(Prior); Object.assign(Prior, State); this.LastState = Prior; this.OnMessage({ method: "bridge/recovered", params: { state: Prior } }); }
	}

	async request(Method: string, Params: any): Promise<any>
	{
		if(this.Closed)
		{
			throw new Error("远程连接已关闭");
		}
		return this.Http("/rpc", "POST", { id: crypto.randomUUID(), method: Method, params: Params });
	}
	async operation_status(Id: string): Promise<SendOperation | null>
	{
		if(!this.Delta || this.Info?.capabilities?.operationStatus !== 1) { throw new Error("旧桥不支持操作状态查询, 未知提交不能自动重发; 请升级桥后核对"); }
		return this.Delta.operation_status(Id);
	}
	async request_operation(Operation: SendOperation, Params?: any, BeforePost?: () => Promise<void>, Signal?: AbortSignal): Promise<{ operation: SendOperation; result?: any }>
	{
		if(Operation.Scope !== this.scope()) { throw new Error("发送操作属于其他连接作用域"); }
		if(Operation.Conflicts?.length) { throw new Error("发送操作存在身份或终态冲突, 请先核对双方记录; 不复用原身份推理"); }
		if(Operation.Attempted || (Operation.Attempted !== false && Operation.Status !== "local" && Operation.Status !== "received"))
		{
			const Existing = await this.operation_status(Operation.Id);
			if(!Existing) { throw new Error("原推理提交结果未知, 未找到接收凭证; 不自动重发"); }
			return { operation: Existing, ...(Existing.Result ? { result: Existing.Result } : {}) };
		}
		const Request = Params ?? Operation.Request; if(!Request) { throw new Error("发送操作缺少已解析的请求参数"); }
		const Digest = await content_digest(Request);
		if(Operation.RequestDigest && Operation.RequestDigest !== Digest) { throw new Error("发送操作请求已变化, 不复用原操作身份"); }
		const Prepared = this.Delta ? await this.Delta.prepare(Operation, Request, Signal) : undefined;
		if(this.Closed || Signal?.aborted || ["cancelled", "failed", "completed"].includes(Operation.Status)) { throw new Error("发送准备已取消或结束, 未提交推理"); }
		const Previous = { Status: Operation.Status, Attempted: Operation.Attempted };
		Operation.Request = structuredClone(Request); Operation.RequestDigest = Digest; Operation.Attempted = true; Operation.Status = "submission-unknown";
		try { await BeforePost?.(); } catch(ErrorValue) { if(Operation.Status === "submission-unknown") { Object.assign(Operation, Previous); } throw ErrorValue; }
		try
		{
			if(this.Delta) { const Response = await this.Delta.submit(Operation, Request, Prepared); Object.assign(Operation, Response.operation); return Response; }
			const Result = await this.Http("/rpc", "POST", { id: Operation.Id, method: "turn/start", params: Request });
			Operation.TurnId = Result.turn?.id; Operation.ThreadId = Request.threadId; Operation.Result = Result; Operation.Status = "running"; return { operation: Operation, result: Result };
		}
		catch(ErrorValue) { Operation.Error = String(ErrorValue); Operation.Status = "submission-unknown"; throw new Error("推理提交结果待核对, 不会自动重发. " + String(ErrorValue)); }
	}

	send(Message: RpcMessage): void
	{
		if(Message.method === "initialized")
		{
			return;
		}
		void this.Http("/reply", "POST", Message).catch(ErrorValue => this.fail(ErrorValue));
	}

	cursor_snapshot(): number
	{
		return this.Cursor;
	}

	sync_state(State: any, Cursor = this.Cursor): Promise<void>
	{
		this.StateQueue = this.StateQueue.catch(() => {}).then(async () =>
		{
			if(this.Closed)
			{
				throw new Error("远程连接已关闭, 状态已保存在本机");
			}
			if(this.Delta) { await this.Delta.sync(State); }
			else
			{
				const Body = { state: State, cursor: Cursor }, Size = new TextEncoder().encode(JSON.stringify(Body)).byteLength;
				if(Size > 4 * 1024 * 1024) { throw new Error(`旧桥整份状态为 ${Size} UTF-8 字节, 超过 4 MiB; 本机历史保留, 请升级增量同步桥`); }
				await this.Http("/state", "POST", Body);
			}
		});
		return this.StateQueue;
	}

	private async poll(): Promise<void>
	{
		if(this.Closed || this.Polling) { return; } this.Polling = true;
		try
		{
			if(this.ResumeCheck) { this.ResumeCheck = false; await this.recover_snapshot(); }
			const Page = await this.Http(`/events?after=${this.Cursor}${this.Delta ? "&protocol=2" : ""}`, "GET");
			if((Page.server && Page.server !== this.Server) || Page.cursor < this.Cursor) { throw new Error("远程进程或事件游标变化, 需要一致快照恢复"); }
			if(Page.reset)
			{
				throw new Error("远程事件缓存已过期, 请重连恢复会话");
			}
			if(this.Closed)
			{
				return;
			}
			if(!Array.isArray(Page.events) || Page.events.length > 256 || !Number.isSafeInteger(Page.cursor) || Page.cursor < 0 || Page.events.some((E: any, I: number) => !Number.isSafeInteger(E.seq) || E.seq < 1 || !E.message || (I > 0 && E.seq <= Page.events[I - 1].seq))) { throw new Error("远程事件分页损坏, 需要一致快照恢复"); }
			for(const Entry of Page.events)
			{
				if(Entry.message.method === "bridge/disconnected")
				{
					throw new Error(Entry.message.params.message);
				}
				if(Entry.seq <= this.Cursor) { continue; }
				if(Entry.message.method === "bridge/sync-changed" && this.Delta)
				{
					if(Entry.message.params.scope !== this.scope()) { throw new Error("增量通知来自其他作用域"); }
					if(!this.Delta.owns_mutation(Entry.message.params.mutationId)) { await this.recover_snapshot(); }
				}
				else if(Entry.message.method === "bridge/message-ref" && this.Delta)
				{
					const P = Entry.message.params, Message = await this.Delta.message_value(P.blob, P.version);
					if(this.Closed) { return; } this.OnMessage({ method: "bridge/message-updated", params: { threadId: P.threadId, turnId: P.turnId, sessionId: P.sessionId, message: Message } });
				}
				else { this.OnMessage(Entry.message); }
				this.Cursor = Math.max(this.Cursor, Entry.seq);
			}
			this.Cursor = Math.max(this.Cursor, Page.cursor);
			this.Config.Cursor = this.Cursor;
			this.Save();
			this.Retry = 0;
		}
		catch(ErrorValue)
		{
			if(!this.Closed && this.Retry < 4)
			{
				this.Retry++; this.OnMessage({ method: "bridge/recovering", params: { attempt: this.Retry, message: "正在恢复只读查询与事件监听, 不重发推理" } });
				await this.pause(Math.min(4000, 250 * 2 ** this.Retry));
				if(!this.Closed)
				{
					try
					{
						await this.recover_snapshot();
					}
					catch(RecoveryError) { if(this.Retry >= 4 || /稳定身份/.test(String(RecoveryError))) { this.fail(RecoveryError); } }
				}
			}
			else { this.fail(ErrorValue); }
		}
		finally { this.Polling = false; }
		if(!this.Closed)
		{
			this.Timer = setTimeout(() => void this.poll(), 700);
		}
	}

	private fail(ErrorValue: unknown): void
	{
		if(!this.Closed)
		{
			this.close();
			this.OnClosed(ErrorValue instanceof Error ? ErrorValue : new Error(String(ErrorValue)));
		}
	}

	close(): void
	{
		this.Closed = true;
		this.Started = false;
		if(this.Waiting) { clearTimeout(this.Waiting); this.Waiting = null; this.Wake?.(); this.Wake = null; }
		for(const [Timer, Resolve] of this.Delays) { clearTimeout(Timer); Resolve(); } this.Delays.clear();
		if(this.Timer)
		{
			clearTimeout(this.Timer);
		}
	}
}
