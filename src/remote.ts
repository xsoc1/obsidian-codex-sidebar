import type { RpcMessage } from "./rpc";

export interface RemoteConfig
{
	Enabled: boolean;
	Url: string;
	Token: string;
	Cursor: number;
	Server: string;
	CacheId?: string;
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
	Server = "";
	Info: any;

	constructor(private Http: HttpRequest, private Config: RemoteConfig, private OnMessage: (Message: RpcMessage) => void, private OnClosed: (ErrorValue: Error) => void, private Save: () => void)
	{
		this.Cursor = Config.Cursor;
	}

	async connect(): Promise<void>
	{
		this.Info = await this.Http("/info", "GET");
		this.Server = this.Info.server;
		if(this.Config.Server !== this.Server)
		{
			this.Cursor = 0;
			this.Config.Cursor = 0;
			this.Config.Server = this.Server;
			this.Save();
		}
	}

	set_cursor(Cursor: number): void
	{
		this.Cursor = Cursor;
		this.Config.Cursor = Cursor;
		this.Save();
	}

	start(): void
	{
		if(!this.Closed)
		{
			void this.poll();
		}
	}

	async request(Method: string, Params: any): Promise<any>
	{
		if(this.Closed)
		{
			throw new Error("远程连接已关闭");
		}
		return this.Http("/rpc", "POST", { id: crypto.randomUUID(), method: Method, params: Params });
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
			await this.Http("/state", "POST", { state: State, cursor: Cursor });
		});
		return this.StateQueue;
	}

	private async poll(): Promise<void>
	{
		try
		{
			const Page = await this.Http(`/events?after=${this.Cursor}`, "GET");
			if(Page.reset)
			{
				throw new Error("远程事件缓存已过期, 请重连恢复会话");
			}
			if(this.Closed)
			{
				return;
			}
			for(const Entry of Page.events)
			{
				if(Entry.message.method === "bridge/disconnected")
				{
					throw new Error(Entry.message.params.message);
				}
				this.Cursor = Entry.seq;
				this.OnMessage(Entry.message);
			}
			this.Cursor = Math.max(this.Cursor, Page.cursor);
			this.Config.Cursor = this.Cursor;
			this.Save();
		}
		catch(ErrorValue)
		{
			this.fail(ErrorValue);
		}
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
		if(this.Timer)
		{
			clearTimeout(this.Timer);
		}
	}
}
