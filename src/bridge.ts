import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { BridgePdfImages } from "./pdf/bridge-cache";
import { dirname, join, resolve } from "node:path";
import { CodexConnection, type RpcMessage } from "./rpc";
import { CompletionService } from "./completion";
import { math_writing_skill, skill_input } from "./skills";
import { run_options, type ModelInfo } from "./controls";
import { environment_instructions } from "./prompt";
import { ObsidianTool, run_obsidian_read } from "./obsidian-tool";
import type { RpcConnection } from "./remote";
import { skill_version } from "./desktop";
import { ProductVersion } from "./version";
import { SyncServerStore } from "./sync/server-store";
import { canonical_json, SyncBudgets, SyncCapabilities, SyncProtocol, type SendOperation } from "./sync/types";
import { restore_sessions } from "./sessions";
import { HistoryReadTool, read_history_page } from "./history-budget";
import { tool_read_reference, type SourceReference } from "./sources";

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
	private PdfImages: BridgePdfImages;
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
	readonly Store: SyncServerStore;
	private ReadSources = new Map<string, SourceReference[]>();
	private SnapshotCursors = new Map<number, number>();
	private AgentInstance = randomUUID();

	constructor(private Config: BridgeConfig, readonly Id: string, private Create: Factory)
	{
		if(!/^[a-z0-9_-]{8,80}$/i.test(Id))
		{
			throw new Error("设备 ID 无效");
		}
		mkdirSync(Config.StateDir, { recursive: true });
		this.PdfImages = new BridgePdfImages(join(Config.StateDir, Id + "-pdf"));
		this.File = join(Config.StateDir, Id + ".json");
		if(existsSync(this.File))
		{
			this.State = JSON.parse(readFileSync(this.File, "utf8"));
		}
		this.Store = new SyncServerStore(Config.StateDir, Id, this.File);
		if(this.Store.Data.Rows.length) { this.State = this.Store.materialize(); }
	}

	private save(): void
	{
		if(this.Store?.Data.ProtocolUsed) { return; }
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
			this.AgentInstance = randomUUID();
			this.Connection = this.Create(this.Config.Cli, this.Config.Cwd, Value => this.event(Value), ErrorValue =>
			{
				for(const O of this.Store.Data.Operations.filter(O => ["received", "running"].includes(O.Status))) { this.Store.put_operation({ ...O, Status: "submission-unknown", Error: "独立 CLI 已断开, 保留接收凭证与回合身份待核对, 不自动重发" }); }
				this.Connection = null; this.Ready = null; this.Threads.clear();
				this.event({ method: "bridge/disconnected", params: { message: ErrorValue.message } });
			});
			await this.Connection.request("initialize", { clientInfo: { name: "obsidian_ipad_isolated", version: ProductVersion }, capabilities: { experimentalApi: true } });
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
						const Result = await run_obsidian_read(this.Config.ObsidianCli, this.Config.Vault, Value.params.arguments), Ref = tool_read_reference(Value.params.arguments, Result, "windows-copy");
						if(Ref)
						{
							const Key = Value.params.threadId + ":" + Value.params.turnId, Refs = this.ReadSources.get(Key) ?? [];
							if(!Refs.some(R => R.Id === Ref.Id)) { Refs.push(Ref); } this.ReadSources.set(Key, Refs);
							const Thread = this.Threads.get(Value.params.threadId)!, User = this.State?.Sessions?.find((S: any) => S.Id === Thread.Session)?.Messages.find((M: any) => M.Role === "user" && M.TurnId === Value.params.turnId);
							if(User) { User.Sources = [...(User.Sources ?? []), Ref]; this.Store.observe_message(Thread.Session, User); }
							this.event({ method: "bridge/source-read", params: { threadId: Value.params.threadId, turnId: Value.params.turnId, source: Ref } });
						}
						Connection?.send({ id: Value.id, result: Result });
					}
					catch
					{
						Connection?.send({ id: Value.id, result: { success: false, contentItems: [{ type: "inputText", text: "只读工具参数无效" }] } });
					}
				}
				else if(Value.method === "item/tool/call" && Value.params?.tool === HistoryReadTool.name && this.Threads.has(Value.params.threadId))
				{
					try { const SessionId = this.Threads.get(Value.params.threadId)!.Session; const Messages = (this.State?.Sessions?.find((S: any) => S.Id === SessionId)?.Messages ?? []).filter((M: any) => !this.Store.is_message_deleted(SessionId, M.Id)); Connection?.send({ id: Value.id, result: await read_history_page(SessionId, Messages, Value.params.arguments) }); }
					catch(ErrorValue) { Connection?.send({ id: Value.id, result: { success: false, contentItems: [{ type: "inputText", text: String(ErrorValue) }] } }); }
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
		const MessageId = Params?.itemId ?? (["agentMessage", "reasoning"].includes(Params?.item?.type) ? Params.item.id : undefined);
		if(Thread && MessageId && this.Store.is_message_deleted(Thread.Session, MessageId)) { return; }
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
				if(Value.method === "turn/completed")
				{
					for(const Stored of this.Messages.values())
					{
						if(Stored.Session === Thread.Session && Stored.Message.TurnId === Params.turn.id)
						{
							Stored.Message.CompletionStatus = Params.turn.status === "completed" ? "completed" : Params.turn.status === "interrupted" ? "interrupted" : "failed";
							Stored.Seq = this.Seq;
							const Session = this.State?.Sessions?.find((Entry: any) => Entry.Id === Thread.Session);
							const Message = Session?.Messages.find((Entry: any) => Entry.Id === Stored.Message.Id);
							if(Message)
							{
								Message.CompletionStatus = Stored.Message.CompletionStatus;
								this.Store.observe_message(Thread.Session, Message);
							}
						}
					}
				}
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
				const Refs = this.ReadSources.get(Params.threadId + ":" + Params.turnId) ?? Previous?.Sources;
				const Message = { Id, TurnId: Params.turnId, Role: Reasoning ? "reasoning" : "assistant", Text: Previous?.Text ?? "", SummaryParts: Previous?.SummaryParts as string[] | undefined, Phase: Previous?.Phase ?? null, ...(Refs?.length ? { Sources: Refs } : {}) };
				if(Value.method === "item/completed")
				{
					Message.Text = Reasoning ? (Params.item.summary ?? []).join("\n\n") : Params.item.text;
					if(!Reasoning) { Message.Phase = ["commentary", "final_answer"].includes(Params.item.phase) ? Params.item.phase : null; }
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
				if(Value.method === "item/completed" || this.Seq % 16 === 0)
				{
					this.Store.observe_message(Thread.Session, Message);
					const Version = this.Store.message_version(Thread.Session, Message.Id); if(Version) { Params.syncMessage = { ...Version, sessionId: Thread.Session, messageId: Message.Id }; }
				}
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
				if(Value.method === "turn/completed")
				{
					for(const Operation of this.Store.Data.Operations.filter(O => O.TurnId === Params.turn.id)) { const Updated = structuredClone(Operation); Updated.Status = Params.turn.status === "completed" ? "completed" : Params.turn.status === "interrupted" ? "cancelled" : "failed"; this.Store.put_operation(Updated); }
				}
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
			this.State = this.State?.Sessions ? restore_sessions(Next, this.State, [], true) : Next;
			this.State = this.Store.legacy_write(this.State);
			this.save();
		}
		return { state: this.Store.Data.ProtocolUsed ? this.Store.materialize() : this.State, cursor: this.Seq };
	}

	async info(): Promise<any>
	{
		await this.ready();
		return { client: this.Id, dataIdentity: this.Store.Data.Identity, agentInstance: this.AgentInstance, cwd: this.Config.Cwd, vault: this.Config.Vault, cli: this.Config.ObsidianCli, isolated: true, bridgeVersion: ProductVersion, protocolVersion: SyncProtocol, capabilities: { ...SyncCapabilities, historyRead: 1 }, budgets: SyncBudgets, pdfPageImages: 1, mathWritingVersion: this.Skill ? skill_version(this.Skill.path) : "未确认" };
	}

	events(After: number, Protocol = 1): any
	{
		const Page = this.Events.filter(Entry => Entry.seq > After).slice(0, 256), Cursor = Page.at(-1)?.seq ?? this.Seq;
		const Events = Protocol < 2 ? Page : Page.flatMap(Entry =>
		{
			const M = Entry.message, P = M.params;
			if(P?.syncMessage) { return [{ seq: Entry.seq, message: { method: "bridge/message-ref", params: { ...P.syncMessage, threadId: P.threadId, turnId: P.turnId } } }]; }
			if(["item/agentMessage/delta", "item/reasoning/summaryTextDelta"].includes(M.method ?? "")) { return []; }
			return [Entry];
		});
		return { events: Events, cursor: Cursor, reset: After < (this.Events[0]?.seq ?? 1) - 1 };
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

	private async execute(Method: string, Params: any, Resolved?: (Request: unknown) => void): Promise<any>
	{
		await this.ready();
		const Connection = this.Connection!;
		if(Method === "initialize")
		{
			return { isolated: true };
		}
		if(Method === "bridge/pdf-images") { return this.PdfImages.request(Params); }
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
				additionalSpeedTiers: Model.additionalSpeedTiers, inputModalities: Model.inputModalities
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
			const Options = run_options({ Model: Params.options?.model, Effort: Params.options?.effort, Fast: ["priority", "fast"].includes(Params.options?.serviceTier) }, this.Models);
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
			const Instructions = environment_instructions(bounded_string(Params.developerInstructions ?? "", 64000), { Vault: this.Config.Vault, Root: this.Config.Cwd, Cli: this.Config.ObsidianCli });
			const Options = run_options({ Model: Params.model, Effort: Params.config?.model_reasoning_effort, Fast: ["priority", "fast"].includes(Params.serviceTier) }, this.Models);
			const Work = (async () =>
			{
				const Result = await Connection.request(Method, { cwd: this.Config.Cwd, model: Options.model, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", dynamicTools: [ObsidianTool, HistoryReadTool], developerInstructions: Instructions, serviceTier: Options.serviceTier, config: { model_reasoning_effort: Options.effort, model_reasoning_summary: "auto" } });
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
			if(!Array.isArray(Params.input) || Params.input.length < 2 || Params.input.length > 4 || Params.input[0]?.type !== "text" || Params.input[1]?.type !== "skill" || Params.input[1]?.name !== "math-writing" || Params.input.slice(2).some((Item: any) => Item?.type !== "image" || Object.keys(Item).some(Key => !["type", "url"].includes(Key))))
			{
				throw new Error("远程请求必须包含问题与 math-writing");
			}
			const Text = bounded_string(Params.input[0].text, 96000);
			const Options = run_options({ Model: Params.model, Effort: Params.effort, Fast: ["priority", "fast"].includes(Params.serviceTier) }, this.Models);
			const Images = Params.input.slice(2).map((Item: any) => ({ type: "image", url: this.PdfImages.resolve(Item.url) }));
			const Model = this.Models.find(Value => Value.model === Options.model);
			if(Images.length && Model?.inputModalities && !Model.inputModalities.includes("image")) { throw new Error("当前模型不支持 PDF 页图"); }
			const Skill = await this.skill();
			if(this.Store.is_deleted(this.Threads.get(Id)!.Session)) { throw new Error("会话已删除, 不再提交推理"); }
			const Request = { threadId: Id, input: [...skill_input(Text, Skill), ...Images], ...Options }; Resolved?.(Request);
			const Result = await Connection.request(Method, Request);
			const Thread = this.Threads.get(Id)!;
			const Session = this.State?.Sessions?.find((Entry: any) => Entry.Id === Thread.Session);
			const User = Session?.Messages.filter((Entry: any) => Entry.Role === "user").at(-1);
			if(User && !User.TurnId && User.Prompt === Text)
			{
				User.TurnId = Result.turn.id;
				this.Messages.set(User.Id, { Session: Thread.Session, Message: structuredClone(User), Seq: this.Seq + 1 });
				this.Store.observe_message(Thread.Session, User);
				this.save();
			}
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
			if(!Array.isArray(Params.items) || Params.items.length > 4000 || Params.items.some((Item: any) => Item.type !== "message" || !["user", "assistant", "developer"].includes(Item.role) || !Array.isArray(Item.content) || Item.content.some((Part: any) => Part.type === "input_image" ? Item.role !== "user" || Object.keys(Part).some(Key => !["type", "image_url"].includes(Key)) : !["input_text", "output_text"].includes(Part.type) || typeof Part.text !== "string" || Part.text.length > 96000)))
			{
				throw new Error("问答恢复内容无效");
			}
			let ImageCount = 0;
			const Items = Params.items.map((Item: any) => ({ ...Item, content: Item.content.map((Part: any) =>
			{
				if(Part.type !== "input_image")
				{
					return Item.role === "developer" ? { ...Part, text: environment_instructions(Part.text, { Vault: this.Config.Vault, Root: this.Config.Cwd, Cli: this.Config.ObsidianCli }) } : Part;
				}
				if(++ImageCount > 32) { throw new Error("恢复的 PDF 页图过多"); }
				return { type: "input_image", image_url: this.PdfImages.resolve(Part.image_url) };
			}) }));
			return Connection.request(Method, { threadId: Id, items: Items });
		}
		if(Method === "turn/interrupt")
		{
			return Connection.request(Method, { threadId: this.owned(Params.threadId), turnId: bounded_string(Params.turnId, 100) });
		}
		throw new Error("远程桥不支持此操作");
	}

	sync_page(Kind: "catalog" | "history", Revision: number | null, Offset: number, Session?: string): any
	{
		const Page = this.Store.page(Kind, Revision, Offset, Session);
		if(!this.SnapshotCursors.has(Page.revision)) { this.SnapshotCursors.set(Page.revision, this.Seq); }
		if(this.SnapshotCursors.size > 8) { this.SnapshotCursors.delete(this.SnapshotCursors.keys().next().value!); }
		return { ...Page, cursor: this.SnapshotCursors.get(Page.revision) };
	}
	sync_delta(Body: any): any
	{
		const Revision = this.Store.Data.Revision, Result = this.Store.delta(Body);
		if(Result.ok)
		{
			this.State = this.Store.materialize();
			if(Result.revision !== Revision) { this.event({ method: "bridge/sync-changed", params: { scope: this.Store.Scope, revision: Result.revision, mutationId: Body.id } }); }
		}
		return Result;
	}
	operation_status(Id: string): any
	{
		const Operation = this.Store.operation(Id);
		if(!Operation) { return { operation: null }; }
		return { operation: this.operation_meta(Operation) };
	}
	private OperationSnapshots = new Map<string, any[]>();
	private operation_meta(Operation: SendOperation): any
	{
		const { Input, Request, Result, Conflicts, ...Meta } = Operation;
		return { ...Meta, InputBlob: this.Store.store_value(Input), ...(Request ? { RequestBlob: this.Store.store_value(Request) } : {}), ...(Result ? { ResultBlob: this.Store.store_value(Result) } : {}), ...(Conflicts?.length ? { ConflictsBlob: this.Store.store_value(Conflicts) } : {}) };
	}
	operation_list(Offset: number, Snapshot?: string): any
	{
		if(!Number.isSafeInteger(Offset) || Offset < 0) { throw new Error("操作分页位置无效"); }
		if(!Snapshot)
		{
			Snapshot = randomUUID(); this.OperationSnapshots.set(Snapshot, this.Store.Data.Operations.map(O => this.operation_meta(O)));
			if(this.OperationSnapshots.size > 8) { this.OperationSnapshots.delete(this.OperationSnapshots.keys().next().value!); }
		}
		const All = this.OperationSnapshots.get(Snapshot); if(!All) { throw new Error("操作一致快照已过期, 请重新获取第一页"); }
		const Operations: any[] = []; let Bytes = 256;
		for(const O of All.slice(Offset, Offset + SyncBudgets.historyPage))
		{
			const Size = Buffer.byteLength(canonical_json(O)); if(Bytes + Size > SyncBudgets.pageBytes) { break; } Operations.push(O); Bytes += Size;
		}
		if(!Operations.length && Offset < All.length) { throw new Error("操作元数据超过单页预算, 原记录保留"); }
		const Next = Offset + Operations.length; return { snapshot: Snapshot, operations: Operations, next: Next < All.length ? Next : null };
	}
	async submit_operation(Body: any): Promise<any>
	{
		const Incoming = Body.operation, Input = this.Store.value(Incoming?.InputBlob), Params = this.Store.value(Body.requestBlob);
		if(!Incoming || Incoming.Scope !== this.Store.Scope || typeof Incoming.Id !== "string" || Incoming.Id.length > 100 || typeof Incoming.SessionId !== "string" || typeof Incoming.MessageId !== "string") { throw new Error("发送操作身份或作用域无效"); }
		const Digest = token_hash(canonical_json({ Scope: Incoming.Scope, SessionId: Incoming.SessionId, MessageId: Incoming.MessageId, Input })), RequestDigest = token_hash(canonical_json(Params));
		if(Digest !== Incoming.Digest) { throw new Error("发送操作输入摘要不一致"); }
		if(typeof Input?.Prompt !== "string" || Params?.input?.[0]?.type !== "text" || Params.input[0].text !== Input.Prompt) { throw new Error("解析后的问题不等于不可变操作输入, 不复用身份提交"); }
		if(Input.Run?.Model && Input.Run.Model !== Params.model || Input.Run?.Effort && Input.Run.Effort !== Params.effort || typeof Input.Run?.Fast === "boolean" && Input.Run.Fast !== ["priority", "fast"].includes(Params.serviceTier)) { throw new Error("解析后的模型选择不同于已保存操作, 请新建分支"); }
		const Images = Params.input.slice(2);
		if(Images.length && (!Array.isArray(Input.PdfRefs) || Images.length !== Input.PdfRefs.length || Images.some((I: any, N: number) => I.url !== "obsidian-pdf:" + Input.PdfRefs[N]?.Id))) { throw new Error("PDF 输入不同于已保存的原始引用"); }
		const Existing = this.Store.operation(Incoming.Id);
		if(Existing)
		{
			if(Existing.Digest !== Digest || Existing.RequestDigest !== RequestDigest) { throw new Error("相同 operationId 的不可变输入不同"); }
			return { ...this.operation_status(Existing.Id), ...(Existing.Result ? { result: Existing.Result } : {}) };
		}
		if(this.Store.is_deleted(Incoming.SessionId)) { throw new Error("会话已删除, 不注册发送操作"); }
		await this.ready();
		const Registered = this.Store.operation(Incoming.Id);
		if(Registered)
		{
			if(Registered.Digest !== Digest || Registered.RequestDigest !== RequestDigest) { throw new Error("相同 operationId 的不可变输入不同"); }
			return { ...this.operation_status(Registered.Id), ...(Registered.Result ? { result: Registered.Result } : {}) };
		}
		const SavedUser = this.State?.Sessions?.find((S: any) => S.Id === Incoming.SessionId)?.Messages.find((M: any) => M.Id === Incoming.MessageId);
		if(this.Store.is_deleted(Incoming.SessionId) || this.Store.is_message_deleted(Incoming.SessionId, Incoming.MessageId) || !SavedUser || SavedUser.Role !== "user" || SavedUser.Prompt !== Input.Prompt || SavedUser.OperationId && SavedUser.OperationId !== Incoming.Id) { throw new Error("发送操作未绑定已保存的原问题或会话已删除, 不提交推理"); }
		for(const Key of ["Context", "Quote", "Task"]) { if(Key in Input && canonical_json(Input[Key] ?? null) !== canonical_json(SavedUser[Key] ?? null)) { throw new Error("发送操作来源快照不同于已保存原问题, 不复用操作身份"); } }
		if(this.Threads.get(Params.threadId)?.Session !== Incoming.SessionId) { throw new Error("发送操作线程不属于该会话"); }
		const Operation: SendOperation = { Id: Incoming.Id, Scope: this.Store.Scope, SessionId: Incoming.SessionId, MessageId: Incoming.MessageId, Input, Digest, Request: Params, RequestDigest, Status: "received" };
		this.Store.put_operation(Operation); Operation.Status = "submission-unknown"; this.Store.put_operation(Operation);
		try
		{
			const Result = await this.execute("turn/start", Params, Request => { const Pending = this.Store.operation(Operation.Id)!; Pending.HostRequestDigest = token_hash(canonical_json(Request)); this.Store.put_operation(Pending); }), Latest = this.Store.operation(Operation.Id)!;
			Latest.TurnId = Result.turn.id; Latest.ThreadId = Params.threadId; Latest.Result = Result;
			const Turn = this.Threads.get(Params.threadId)?.Turn;
			Latest.Status = Turn?.id === Result.turn.id && Turn?.status === "completed" ? "completed" : Turn?.id === Result.turn.id && Turn?.status === "interrupted" ? "cancelled" : "running";
			this.Store.put_operation(Latest); return { ...this.operation_status(Latest.Id), result: Result };
		}
		catch(ErrorValue) { const Latest = this.Store.operation(Operation.Id)!; Latest.Error = String(ErrorValue).slice(0, 2048); this.Store.put_operation(Latest); throw new Error("推理提交结果待核对, 不会自动重发. " + Latest.Error); }
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
				Result = { ...Agent.events(Cursor, Number(Url.searchParams.get("protocol") ?? 1)), server: this.ServerId };
			}
			else if(Request.method === "GET" && Url.pathname === "/state")
			{
				Result = Agent.state();
			}
			else if(Request.method === "GET" && ["/sync/catalog", "/sync/history"].includes(Url.pathname))
			{
				const Revision = Url.searchParams.has("revision") ? Number(Url.searchParams.get("revision")) : null;
				Result = Agent.sync_page(Url.pathname === "/sync/catalog" ? "catalog" : "history", Revision, Number(Url.searchParams.get("offset") ?? 0), Url.searchParams.get("session") ?? undefined);
			}
			else if(Request.method === "GET" && Url.pathname === "/sync/blob") { Result = Agent.Store.blob_part(Url.searchParams.get("id") ?? "", Number(Url.searchParams.get("index") ?? 0)); }
			else if(Request.method === "POST" && Url.pathname === "/sync/blob") { Result = Agent.Store.put_part(Body); }
			else if(Request.method === "POST" && Url.pathname === "/sync/delta") { Result = Agent.sync_delta(Body); }
			else if(Request.method === "GET" && Url.pathname === "/operations") { Result = Url.searchParams.has("id") ? Agent.operation_status(Url.searchParams.get("id")!) : Agent.operation_list(Number(Url.searchParams.get("offset") ?? 0), Url.searchParams.get("snapshot") ?? undefined); }
			else if(Request.method === "POST" && Url.pathname === "/operations") { Result = await Agent.submit_operation(Body); }
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
