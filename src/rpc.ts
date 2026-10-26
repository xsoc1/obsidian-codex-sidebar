import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { resolve_codex_executable } from "./launch";

export interface RpcMessage
{
	id?: number | string;
	method?: string;
	params?: any;
	result?: any;
	error?: { code: number; message: string };
}

interface PendingRequest
{
	Resolve: (Value: any) => void;
	Reject: (Error: Error) => void;
	Timer: ReturnType<typeof setTimeout>;
}

export class JsonRpcPeer
{
	private Buffer = "";
	private Decoder = new StringDecoder("utf8");
	private Counter = 0;
	private Pending = new Map<number, PendingRequest>();
	private Closed = false;

	constructor(
		private Write: (Data: string) => void,
		private OnMessage: (Message: RpcMessage) => void,
		private OnProtocolError: (Error: Error) => void
	)
	{
	}

	request(Method: string, Params: unknown, Timeout = 60000): Promise<any>
	{
		if(this.Closed)
		{
			return Promise.reject(new Error("Codex 连接已关闭"));
		}
		const Id = ++this.Counter;
		return new Promise((Resolve, Reject) =>
		{
			const Timer = setTimeout(() =>
			{
				this.Pending.delete(Id);
				Reject(new Error(`${Method} 超时. 请求结果可能未知, 请重连以核对会话`));
			}, Timeout);
			this.Pending.set(Id, { Resolve, Reject, Timer });
			try
			{
				this.send({ id: Id, method: Method, params: Params });
			}
			catch(ErrorValue)
			{
				clearTimeout(Timer);
				this.Pending.delete(Id);
				Reject(ErrorValue);
			}
		});
	}

	send(Message: RpcMessage): void
	{
		if(this.Closed)
		{
			throw new Error("Codex 连接已关闭");
		}
		this.Write(JSON.stringify(Message) + "\n");
	}

	feed(Chunk: Buffer): void
	{
		if(this.Closed)
		{
			return;
		}
		this.Buffer += this.Decoder.write(Chunk);
		if(this.Buffer.length > 32 * 1024 * 1024)
		{
			this.OnProtocolError(new Error("Codex 协议帧过大"));
			return;
		}
		let Index: number;
		while((Index = this.Buffer.indexOf("\n")) >= 0)
		{
			const Line = this.Buffer.slice(0, Index).trim();
			this.Buffer = this.Buffer.slice(Index + 1);
			if(!Line)
			{
				continue;
			}
			let Message: RpcMessage;
			try
			{
				Message = JSON.parse(Line);
				if(!Message || typeof Message !== "object" || Array.isArray(Message))
				{
					throw new Error("Invalid envelope");
				}
			}
			catch
			{
				this.OnProtocolError(new Error("Codex 返回了无效的 JSON 帧"));
				continue;
			}
			if(Message.method)
			{
				this.OnMessage(Message);
			}
			else if(typeof Message.id === "number")
			{
				const Pending = this.Pending.get(Message.id);
				if(Pending)
				{
					clearTimeout(Pending.Timer);
					this.Pending.delete(Message.id);
					if(Message.error)
					{
						Pending.Reject(new Error(Message.error.message));
					}
					else
					{
						Pending.Resolve(Message.result);
					}
				}
			}
		}
	}

	close(ErrorValue = new Error("Codex 连接已关闭")): void
	{
		this.Closed = true;
		this.Buffer = "";
		for(const Pending of this.Pending.values())
		{
			clearTimeout(Pending.Timer);
			Pending.Reject(ErrorValue);
		}
		this.Pending.clear();
	}
}

export class CodexConnection
{
	private Process: ChildProcessWithoutNullStreams;
	private Peer: JsonRpcPeer;
	private Closed = false;

	constructor(CliPath: string, Cwd: string, OnMessage: (Message: RpcMessage) => void, OnClosed: (Error: Error) => void)
	{
		this.Process = spawn(resolve_codex_executable(CliPath), ["app-server", "--listen", "stdio://"],
		{
			cwd: Cwd,
			windowsHide: true,
			shell: false,
			stdio: "pipe"
		});
		this.Peer = new JsonRpcPeer(
			Data => this.Process.stdin.write(Data),
			OnMessage,
			ErrorValue => this.fail(ErrorValue, OnClosed)
		);
		this.Process.stdout.on("data", Chunk => this.Peer.feed(Chunk));
		// Drain stderr without persisting credentials or private diagnostics.
		this.Process.stderr.on("data", () => {});
		this.Process.stdin.on("error", ErrorValue => this.fail(ErrorValue, OnClosed));
		this.Process.on("error", ErrorValue => this.fail(ErrorValue, OnClosed));
		this.Process.on("exit", Code => this.fail(new Error(`Codex 进程退出 (${Code ?? "signal"})`), OnClosed));
	}

	private fail(ErrorValue: Error, OnClosed: (Error: Error) => void): void
	{
		if(this.Closed)
		{
			return;
		}
		this.close();
		OnClosed(ErrorValue);
	}

	request(Method: string, Params: unknown): Promise<any>
	{
		return this.Peer.request(Method, Params);
	}

	send(Message: RpcMessage): void
	{
		this.Peer.send(Message);
	}

	close(): void
	{
		if(this.Closed)
		{
			return;
		}
		this.Closed = true;
		this.Peer.close();
		this.Process.stdin.end();
		this.Process.kill();
	}
}
