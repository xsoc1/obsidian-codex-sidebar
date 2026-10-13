import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CodexConnection, type RpcMessage } from "./rpc";
import { CompletionService } from "./completion";
import { math_writing_skill, skill_input } from "./skills";
import { run_options, type ModelInfo } from "./controls";
import { editing_instructions, environment_instructions } from "./prompt";
import { ObsidianTool, run_obsidian_read } from "./obsidian-tool";
import type { RpcConnection } from "./remote";

export interface BridgeConfig
{
	Port: number;
	Cli: string;
	Cwd: string;
	Vault: string;
	ObsidianCli: string;
	StateDir: string;
	Clients: { Id: string; Hash: string }[];
}

type Factory = (Cli: string, Cwd: string, Message: (Value: RpcMessage) => void, Closed: (ErrorValue: Error) => void) => RpcConnection;
export const token_hash = (Token: string): string => createHash("sha256").update(Token).digest("hex");
const bounded_string = (Value: unknown, Limit: number): string =>
{
	if(typeof Value !== "string" || Value.length > Limit)
	{
		throw new Error("输入文本无效或过长");
	}
	return Value;
};

class DeviceAgent
{
	Connection: RpcConnection | null = null;
	private Ready: Promise<void> | null = null;
	private Models: ModelInfo[] = [];
	private Skill: ReturnType<typeof math_writing_skill> | null = null;
	private Threads = new Map<string, { Session: string; Options: any; Turn?: { id: string; status: string; items: any[] } }>();
	private Starting = new Map<string, Promise<any>>();
	private Events: { seq: number; message: RpcMessage }[] = [];
	private Seq = 0;
	private State: any = null;
	private Messages = new Map<string, { Session: string; Message: any; Seq: number }>();
	private Cache = new Map<string, { Hash: string; Result: Promise<any> }>();
	private Jobs = new Map<string, AbortController>();
	private CancelledJobs = new Set<string>();
	private Completion = new CompletionService();
	private File: string;

	constructor(private Config: BridgeConfig, readonly Id: string, private Create: Factory)
	{
		if(!/^[a-z0-9_-]{8,80}$/i.test(Id))
		{
			throw new Error("设备 ID 无效");
		}
		mkdirSync(Config.StateDir, { recursive: true });
		this.File = join(Config.StateDir, Id + ".json");
		if(existsSync(this.File))
		{
			this.State = JSON.parse(readFileSync(this.File, "utf8"));
		}
	}

	private save(): void
	{
		if(!this.State)
		{
			return;
		}
		writeFileSync(this.File + ".tmp", JSON.stringify(this.State), { mode: 0o600 });
		renameSync(this.File + ".tmp", this.File);
	}

	private async ready(): Promise<void>
	{
		if(this.Ready)
		{
			return this.Ready;
		}
		this.Ready = (async () =>
		{
			this.Connection = this.Create(this.Config.Cli, this.Config.Cwd, Value => this.event(Value), ErrorValue =>
			{
				this.Connection = null; this.Ready = null; this.Threads.clear();
				this.event({ method: "bridge/disconnected", params: { message: ErrorValue.message } });
			});
			await this.Connection.request("initialize", { clientInfo: { name: "obsidian_ipad_isolated", version: "0.6.2" }, capabilities: { experimentalApi: true } });
			this.Connection.send({ method: "initialized", params: {} });
			let Cursor: string | null = null;
			this.Models = [];
			do
			{
				const Page = await this.Connection.request("model/list", { limit: 100, includeHidden: false, cursor: Cursor });
				this.Models.push(...Page.data); Cursor = Page.nextCursor ?? null;
			} while(Cursor);
			await this.skill();
		})();
		try
		{
			await this.Ready;
		} catch(ErrorValue)
		{
			this.Connection?.close(); this.Connection = null; this.Ready = null; throw ErrorValue;
		}
	}

	private async skill()
	{
		const Result = await this.Connection!.request("skills/list", { cwds: [this.Config.Cwd], forceReload: true });
		this.Skill = math_writing_skill(Result, this.Config.Cwd);
		if(!existsSync(this.Skill.path))
		{
			throw new Error("远程 math-writing 技能文件不存在");
		}
		return this.Skill;
	}

	private event(Value: RpcMessage): void
	{
		if(Value.id !== undefined && Value.method)
		{
			void (async () =>
			{
				const Connection = this.Connection;
				if(Value.method === "item/tool/call" && Value.params?.tool === "obsidian_cli_read" && this.Threads.has(Value.params.threadId))
				{
					try
					{
						Connection?.send({ id: Value.id, result: await run_obsidian_read(this.Config.ObsidianCli, this.Config.Vault, Value.params.arguments) });
					}
					catch
					{
						Connection?.send({ id: Value.id, result: { success: false, contentItems: [{ type: "inputText", text: "只读工具参数无效" }] } });
					}
				}
				else
				{
					Connection?.send({ id: Value.id, error: { code: -32601, message: "Remote agent is read-only; privileged approvals and unknown tools are unavailable" } });
				}
			})();
			return;
		}
		const Params = Value.params;
		const Thread = this.Threads.get(Params?.threadId);
		this.Events.push({ seq: ++this.Seq, message: Value });
		if(this.Events.length > 4096)
		{
			this.Events.splice(0, this.Events.length - 4096);
		}
		if(Thread && Params)
		{
			if(Value.method === "turn/started" || Value.method === "turn/completed")
			{
				Thread.Turn = { id: Params.turn.id, status: Params.turn.status, items: [] };
			}
			if(Value.method === "thread/settings/updated")
			{
				Thread.Options.model = Params.threadSettings.model;
				Thread.Options.reasoningEffort = Params.threadSettings.effort;
				Thread.Options.serviceTier = Params.threadSettings.serviceTier ?? "default";
			}
			if(Value.method === "item/agentMessage/delta" || Value.method === "item/reasoning/summaryTextDelta" || (Value.method === "item/completed" && ["agentMessage", "reasoning"].includes(Params.item?.type)))
			{
				const Id = Params.itemId ?? Params.item.id;
				const Previous = this.Messages.get(Id)?.Message;
				const Reasoning = Value.method === "item/reasoning/summaryTextDelta" || Params.item?.type === "reasoning";
				const Message = { Id, TurnId: Params.turnId, Role: Reasoning ? "reasoning" : "assistant", Text: Previous?.Text ?? "", SummaryParts: Previous?.SummaryParts as string[] | undefined };
				if(Value.method === "item/completed")
				{
					Message.Text = Reasoning ? (Params.item.summary ?? []).join("\n\n") : Params.item.text;
				}
				else if(Reasoning)
				{
					Message.SummaryParts ??= [];
					Message.SummaryParts[Params.summaryIndex] = (Message.SummaryParts[Params.summaryIndex] ?? "") + Params.delta;
					Message.Text = Message.SummaryParts.filter(Boolean).join("\n\n");
				}
				else
				{
					Message.Text += Params.delta;
				}
				this.Messages.set(Id, { Session: Thread.Session, Message, Seq: this.Seq });
				const Session = this.State?.Sessions?.find((Entry: any) => Entry.Id === Thread.Session);
				if(Session)
				{
					const Index = Session.Messages.findIndex((Entry: any) => Entry.Id === Id);
					if(Index < 0)
					{
						Session.Messages.push(Message);
					} else
					{
						Session.Messages[Index] = Message;
					}
				}
			}
			if(Value.method === "thread/tokenUsage/updated")
			{
				const Session = this.State?.Sessions?.find((Entry: any) => Entry.Id === Thread.Session);
				if(Session)
				{
					Session.Usage = Params.tokenUsage;
				}
			}
			if(["item/completed", "turn/completed"].includes(Value.method ?? ""))
			{
				this.save();
			}
		}
	}

	private owned(Id: unknown): string
	{
		if(typeof Id !== "string" || !this.Threads.has(Id))
		{
			throw new Error("会话不属于此独立远程设备");
		}
		return Id;
	}

	state(Cursor?: number, Incoming?: any): { state: any; cursor: number }
	{
		if(Incoming)
		{
			if(!Array.isArray(Incoming.Sessions) || Incoming.Sessions.length > 256 || !Incoming.Settings || Incoming.Sessions.some((Entry: any) => typeof Entry.Id !== "string" || !Array.isArray(Entry.Messages) || Entry.Messages.length > 4000))
			{
				throw new Error("远程状态格式无效");
			}
			const Next = structuredClone(Incoming);
			for(const Stored of this.Messages.values())
			{
				if(Stored.Seq <= (Cursor ?? 0))
				{
					continue;
				}
				const Session = Next.Sessions.find((Entry: any) => Entry.Id === Stored.Session);
				if(!Session)
				{
					continue;
				}
				const Index = Session.Messages.findIndex((Entry: any) => Entry.Id === Stored.Message.Id);
				if(Index < 0)
				{
					Session.Messages.push(Stored.Message);
				} else
				{
					Session.Messages[Index] = Stored.Message;
				}
			}
			for(const Session of Next.Sessions)
			{
				const Previous = this.State?.Sessions?.find((Entry: any) => Entry.Id === Session.Id);
				if(Previous?.Usage)
				{
					Session.Usage = Previous.Usage;
				}
			}
			this.State = Next;
			this.save();
		}
		return { state: this.State, cursor: this.Seq };
	}

	async info(): Promise<any>
	{
		await this.ready();
		return { client: this.Id, cwd: this.Config.Cwd, vault: this.Config.Vault, cli: this.Config.ObsidianCli, isolated: true };
	}

	events(After: number): any
	{
		return { events: this.Events.filter(Entry => Entry.seq > After).slice(0, 256), cursor: this.Events.filter(Entry => Entry.seq > After).slice(0, 256).at(-1)?.seq ?? this.Seq, reset: After < (this.Events[0]?.seq ?? 1) - 1 };
	}

	request(Id: unknown, Method: unknown, Params: any): Promise<any>
	{
		const Key = bounded_string(Id, 80);
		const Name = bounded_string(Method, 80);
		const Hash = token_hash(JSON.stringify({ Name, Params }));
		const Cached = this.Cache.get(Key);
		if(Cached)
		{
			if(Cached.Hash !== Hash)
			{
				return Promise.reject(new Error("请求 ID 已被不同请求使用"));
			}
			return Cached.Result;
		}
		if(this.Cache.size >= 512)
		{
			this.Cache.delete(this.Cache.keys().next().value!);
		}
		const Result = this.execute(Name, Params ?? {});
		this.Cache.set(Key, { Hash, Result });
		return Result;
	}

	private async execute(Method: string, Params: any): Promise<any>
	{
		await this.ready();
		const Connection = this.Connection!;
		if(Method === "initialize")
		{
			return { isolated: true };
		}
		if(Method === "account/read")
		{
			return Connection.request(Method, { refreshToken: false });
		}
		if(Method === "model/list")
		{
			return { data: this.Models.map(Model => ({
				model: Model.model, displayName: Model.displayName, isDefault: Model.isDefault,
				defaultReasoningEffort: Model.defaultReasoningEffort,
				supportedReasoningEfforts: Model.supportedReasoningEfforts.map(Effort => ({ reasoningEffort: Effort.reasoningEffort, description: "" })),
				serviceTiers: Model.serviceTiers?.map(Tier => ({ id: Tier.id, name: Tier.name, description: "" })),
				additionalSpeedTiers: Model.additionalSpeedTiers
			})), nextCursor: null };
		}
		if(Method === "skills/list")
		{
			await this.skill();
			return { data: [{ cwd: this.Config.Cwd, skills: [{ name: "math-writing", enabled: true, scope: "user", path: "/bridge/math-writing/SKILL.md" }] }] };
		}
		if(Method === "bridge/completion/cancel")
		{
			const Job = bounded_string(Params.job, 80);
			this.CancelledJobs.add(Job);
			if(this.CancelledJobs.size > 512)
			{
				this.CancelledJobs.delete(this.CancelledJobs.values().next().value!);
			}
			this.Jobs.get(Job)?.abort(); return {};
		}
		if(Method === "bridge/completion")
		{
			const Job = bounded_string(Params.job, 80);
			if(this.CancelledJobs.has(Job))
			{
				throw new Error("补全已取消");
			}
			if(this.Jobs.size >= 2)
			{
				throw new Error("远程补全正在进行, 请稍后重试");
			}
			const Input = { Path: bounded_string(Params.input?.Path, 512), Before: bounded_string(Params.input?.Before, 6000), After: bounded_string(Params.input?.After, 2000) };
			const Options = run_options({ Model: Params.options?.model, Effort: Params.options?.effort, Fast: Params.options?.serviceTier === "priority" }, this.Models);
			const Controller = new AbortController(); this.Jobs.set(Job, Controller);
			try
			{
				return { text: await this.Completion.complete(this.Config.Cli, this.Config.Cwd, Input, Options, Controller.signal, await this.skill()) };
			}
			finally
			{
				this.Jobs.delete(Job);
			}
		}
		if(Method === "thread/start")
		{
			const Session = bounded_string(Params.clientSessionId, 80);
			const Pending = this.Starting.get(Session);
			if(Pending)
			{
				return Pending;
			}
			const Existing = [...this.Threads].find(([, Entry]) => Entry.Session === Session);
			if(Existing)
			{
				return this.execute("bridge/resume", { threadId: Existing[0] });
			}
			if(this.Threads.size + this.Starting.size >= 256)
			{
				throw new Error("远程运行会话过多, 请重启桥并从历史恢复");
			}
			const Instructions = environment_instructions(editing_instructions(bounded_string(Params.developerInstructions ?? "", 64000)), { Vault: this.Config.Vault, Root: this.Config.Cwd, Cli: this.Config.ObsidianCli });
			const Options = run_options({ Model: Params.model, Effort: Params.config?.model_reasoning_effort, Fast: Params.serviceTier === "priority" }, this.Models);
			const Work = (async () =>
			{
				const Result = await Connection.request(Method, { cwd: this.Config.Cwd, model: Options.model, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", dynamicTools: [ObsidianTool], developerInstructions: Instructions, serviceTier: Options.serviceTier, config: { model_reasoning_effort: Options.effort, model_reasoning_summary: "auto" } });
				if(Result.thread.ephemeral !== true || Result.thread.path)
				{
					throw new Error("远程后端未提供隐式临时会话");
				}
				this.Threads.set(Result.thread.id, { Session, Options: Result });
				return Result;
			})();
			this.Starting.set(Session, Work);
			try
			{
				return await Work;
			}
			finally
			{
				this.Starting.delete(Session);
			}
		}
		if(Method === "bridge/resume")
		{
			if(!this.Threads.has(Params.threadId))
			{
				return null;
			}
			const Id = this.owned(Params.threadId);
			const Thread = this.Threads.get(Id)!;
			return { ...Thread.Options, thread: { ...Thread.Options.thread, turns: Thread.Turn ? [Thread.Turn] : [] } };
		}
		if(Method === "turn/start")
		{
			const Id = this.owned(Params.threadId);
			if(!Array.isArray(Params.input) || Params.input.length !== 2 || Params.input[0]?.type !== "text" || Params.input[1]?.type !== "skill" || Params.input[1]?.name !== "math-writing")
			{
				throw new Error("远程请求必须包含问题与 math-writing");
			}
			const Text = bounded_string(Params.input[0].text, 96000);
			const Options = run_options({ Model: Params.model, Effort: Params.effort, Fast: Params.serviceTier === "priority" }, this.Models);
			const Result = await Connection.request(Method, { threadId: Id, input: skill_input(Text, await this.skill()), ...Options });
			const Thread = this.Threads.get(Id)!;
			Thread.Options.model = Options.model;
			Thread.Options.reasoningEffort = Options.effort;
			Thread.Options.serviceTier = Options.serviceTier;
			if(Thread.Turn?.id !== Result.turn.id)
			{
				Thread.Turn = { id: Result.turn.id, status: Result.turn.status ?? "inProgress", items: [] };
			}
			return Result;
		}
		if(Method === "thread/inject_items")
		{
			const Id = this.owned(Params.threadId);
			if(!Array.isArray(Params.items) || Params.items.length > 4000 || Params.items.some((Item: any) => Item.type !== "message" || !["user", "assistant", "developer"].includes(Item.role) || !Array.isArray(Item.content) || Item.content.some((Part: any) => !["input_text", "output_text"].includes(Part.type) || typeof Part.text !== "string" || Part.text.length > 96000)))
			{
				throw new Error("问答恢复内容无效");
			}
			return Connection.request(Method, { threadId: Id, items: Params.items });
		}
		if(Method === "turn/interrupt")
		{
			return Connection.request(Method, { threadId: this.owned(Params.threadId), turnId: bounded_string(Params.turnId, 100) });
		}
		throw new Error("远程桥不支持此操作");
	}

	close(): void
	{
		this.Completion.close(); this.Connection?.close(); this.Connection = null;
	}
}

export class RemoteBridge
{
	readonly ServerId = randomUUID();
	private Agents = new Map<string, DeviceAgent>();
	readonly Http;
	constructor(private Config: BridgeConfig, private Create: Factory = (Cli, Cwd, Message, Closed) => new CodexConnection(Cli, Cwd, Message, Closed))
	{
		if(!Number.isInteger(Config.Port) || Config.Port < 0 || Config.Port > 65535 || Config.Clients.length < 1 || Config.Clients.length > 8 || Config.Clients.some(Client => !/^[0-9a-f]{64}$/.test(Client.Hash)))
		{
			throw new Error("桥配置无效");
		}
		this.Http = createServer((Request, Response) => void this.serve(Request, Response));
	}

	private async serve(Request: IncomingMessage, Response: ServerResponse): Promise<void>
	{
		Response.setHeader("Content-Type", "application/json; charset=utf-8");
		Response.setHeader("Cache-Control", "no-store");
		Response.setHeader("Access-Control-Allow-Origin", "*");
		Response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		Response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
		Response.setHeader("Access-Control-Max-Age", "600");
		if(Request.method === "OPTIONS")
		{
			Response.statusCode = 204;
			Response.end();
			return;
		}
		try
		{
			const Token = Request.headers.authorization?.match(/^Bearer ([a-zA-Z0-9_-]{32,128})$/)?.[1] ?? "";
			const Hash = Buffer.from(token_hash(Token), "hex");
			const Client = this.Config.Clients.find(Value => timingSafeEqual(Hash, Buffer.from(Value.Hash, "hex")));
			if(!Token || !Client)
			{
				Response.statusCode = 401; Response.end(JSON.stringify({ error: "远程配对密钥无效" })); return;
			}
			let Agent = this.Agents.get(Client.Id);
			if(!Agent)
			{
				Agent = new DeviceAgent(this.Config, Client.Id, this.Create); this.Agents.set(Client.Id, Agent);
			}
			const Url = new URL(Request.url ?? "/", "http://127.0.0.1");
			let Body: any = {};
			if(Request.method === "POST")
			{
				const Chunks: Buffer[] = []; let Size = 0;
				for await(const Chunk of Request)
				{
					Size += Chunk.length; if(Size > 4 * 1024 * 1024)
					{
						throw new Error("请求体过大");
					} Chunks.push(Chunk);
				}
				Body = JSON.parse(Buffer.concat(Chunks).toString("utf8"));
			}
			let Result: any;
			if(Request.method === "GET" && Url.pathname === "/info")
			{
				Result = { ...await Agent.info(), server: this.ServerId };
			}
			else if(Request.method === "GET" && Url.pathname === "/events")
			{
				const Cursor = Number(Url.searchParams.get("after") ?? 0);
				if(!Number.isSafeInteger(Cursor) || Cursor < 0)
				{
					throw new Error("事件游标无效");
				}
				Result = Agent.events(Cursor);
			}
			else if(Request.method === "GET" && Url.pathname === "/state")
			{
				Result = Agent.state();
			}
			else if(Request.method === "POST" && Url.pathname === "/state")
			{
				Result = { cursor: Agent.state(Body.cursor, Body.state).cursor };
			}
			else if(Request.method === "POST" && Url.pathname === "/rpc")
			{
				Result = await Agent.request(Body.id, Body.method, Body.params);
			}
			else
			{
				Response.statusCode = 404; Result = { error: "没有此远程操作" };
			}
			Response.end(JSON.stringify(Result));
		}
		catch(ErrorValue)
		{
			Response.statusCode = 400; Response.end(JSON.stringify({ error: ErrorValue instanceof Error ? ErrorValue.message : "远程请求失败" }));
		}
	}

	async listen(): Promise<number>
	{
		await new Promise<void>((Resolve, Reject) =>
		{
			this.Http.once("error", Reject); this.Http.listen(this.Config.Port, "127.0.0.1", () =>
			{
				this.Http.off("error", Reject); Resolve();
			});
		});
		return (this.Http.address() as { port: number }).port;
	}

	async close(): Promise<void>
	{
		for(const Agent of this.Agents.values())
		{
			Agent.close();
		}
		this.Http.closeAllConnections();
		await new Promise<void>(Resolve => this.Http.close(() => Resolve()));
	}
}

export function init_config(File: string, Cwd: string, Cli: string, Vault: string, ObsidianCli: string, Port = 17895): void
{
	if(existsSync(File))
	{
		throw new Error("已有配置, 请保留原配对信息");
	}
	const Token = randomBytes(32).toString("base64url");
	const Id = "ipad-" + randomUUID();
	const Root = dirname(resolve(File)); mkdirSync(Root, { recursive: true });
	const Config: BridgeConfig = { Port, Cli, Cwd: resolve(Cwd), Vault, ObsidianCli, StateDir: join(Root, "isolated-ipad-state"), Clients: [{ Id, Hash: token_hash(Token) }] };
	writeFileSync(File, JSON.stringify(Config, null, "\t"), { mode: 0o600 });
	writeFileSync(join(Root, "connection-private.json"), JSON.stringify({ Url: `http://127.0.0.1:${Port}`, Token, Client: Id }, null, "\t"), { mode: 0o600 });
}
