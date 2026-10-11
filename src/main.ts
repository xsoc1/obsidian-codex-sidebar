import {
	Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Notice,
	MarkdownRenderer, Component, FileSystemAdapter, Modal, type App
} from "obsidian";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { ContextCapture } from "./context";
import { build_prompt, DefaultInstructions, instruction_items, type ContextSnapshot } from "./prompt";
import { CodexConnection, type RpcMessage } from "./rpc";
import { selected_model, fast_tier, run_options, context_usage, type ModelInfo, type RunDefaults, type TokenUsage } from "./controls";

const ViewType = "codex-sidebar-view";
const ExplainPrompt = "请解释选中的内容. 说明符号、所需前置知识和关键推导, 保留原来的数学符号, 用中文回答.";
const ProofPrompt = "请检查选中的证明或推导. 逐项核对假设、量词、适用定理和每个非平凡步骤, 指出具体缺口与最小修正. 不擅自重写原证明, 用中文回答.";

interface SidebarSettings
{
	CliPath: string;
	Model: string;
	Effort: string;
	Fast: boolean;
	ShowUsage: boolean;
	Instructions: string;
	AttachContext: boolean;
	AutoCapture: boolean;
}

interface ChatMessage
{
	Id: string;
	Role: "user" | "assistant" | "system" | "reasoning";
	Text: string;
	TurnId?: string;
	ContextLabel?: string;
	SummaryParts?: string[];
}

interface ChatSession
{
	Id: string;
	Title: string;
	ThreadId: string | null;
	Messages: ChatMessage[];
	Usage?: TokenUsage;
	EffectiveModel?: string;
	EffectiveEffort?: string;
	EffectiveTier?: string;
	InstructionsHash?: string;
}

interface SavedState
{
	Settings: SidebarSettings;
	Sessions: ChatSession[];
	ActiveId: string;
}

function new_session(): ChatSession
{
	return { Id: crypto.randomUUID(), Title: "新会话", ThreadId: null, Messages: [] };
}

function error_text(ErrorValue: unknown): string
{
	return ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue);
}

function discover_cli(): Promise<string>
{
	return new Promise((Resolve, Reject) =>
	{
		execFile("where.exe", ["codex.exe"], { windowsHide: true, timeout: 5000 }, (ErrorValue, Output) =>
		{
			const Path = Output?.trim().split(/\r?\n/).find(Value => existsSync(Value));
			if(ErrorValue || !Path)
			{
				Reject(new Error("未找到 codex.exe. 请在插件设置中填写本机 Codex 可执行文件路径"));
			}
			else
			{
				Resolve(Path);
			}
		});
	});
}

export default class CodexSidebarPlugin extends Plugin
{
	State!: SavedState;
	Capture!: ContextCapture;
	Status = "尚未连接";
	Model = "";
	Models: ModelInfo[] = [];
	Defaults: RunDefaults = { Model: "", Effort: "" };
	CatalogError = "";
	Activity = "";
	StartedAt = 0;
	Busy = false;
	TurnId: string | null = null;
	Ribbon!: HTMLElement;
	private Connection: CodexConnection | null = null;
	private Connecting: Promise<void> | null = null;
	private LoadedThread: string | null = null;
	private Generation = 0;
	private Unloaded = false;
	private CompletedTurns = new Set<string>();
	private ApprovalItems = new Map<string, unknown>();
	private SaveQueue: Promise<void> = Promise.resolve();
	private CaptureTimer: ReturnType<typeof setTimeout> | null = null;
	private Modals = new Set<Modal>();
	private BoundDocuments = new Set<Document>();

	get Session(): ChatSession
	{
		return this.State.Sessions.find(Value => Value.Id === this.State.ActiveId)!;
	}

	private close_connection(): void
	{
		this.Connection?.close();
		this.Connection = null;
		this.LoadedThread = null;
	}

	async onload(): Promise<void>
	{
		const Saved = await this.loadData() as Partial<SavedState> | null;
		const Sessions = Saved?.Sessions?.filter(Value => Value.Id && Array.isArray(Value.Messages)) ?? [];
		if(!Sessions.length)
		{
			Sessions.push(new_session());
		}
		this.State =
		{
			Settings: { CliPath: "", Model: "", Effort: "", Fast: false, ShowUsage: true, Instructions: DefaultInstructions, AttachContext: true, AutoCapture: true, ...Saved?.Settings },
			Sessions,
			ActiveId: Sessions.some(Value => Value.Id === Saved?.ActiveId) ? Saved!.ActiveId! : Sessions[0].Id
		};
		this.Capture = new ContextCapture(this.app);
		this.registerView(ViewType, Leaf => new CodexView(Leaf, this));
		this.Ribbon = this.addRibbonIcon("bot", "Codex 聊天 (打开/收起)", () => void this.toggle_sidebar());
		this.Ribbon.addClass("codex-sidebar-ribbon");
		this.addCommand({ id: "toggle", name: "打开/收起聊天栏", callback: () => void this.toggle_sidebar() });
		this.addCommand({ id: "explain-selection", name: "解释选区", callback: () => void this.ask_selection(ExplainPrompt) });
		this.addCommand({ id: "check-proof", name: "检查选区证明", callback: () => void this.ask_selection(ProofPrompt) });
		this.addCommand({ id: "capture-reading", name: "捕获当前阅读位置", callback: () => void this.capture_current() });
		this.addSettingTab(new CodexSettings(this.app, this));
		this.registerMarkdownPostProcessor((ElementValue, Context) => this.Capture.register_block(ElementValue, Context));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () =>
		{
			this.Capture.track_view();
			if(this.Capture.LastView)
			{
				this.bind_document(this.Capture.LastView.containerEl.ownerDocument);
			}
			this.refresh();
		}));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
		this.registerEvent(this.app.workspace.on("editor-menu", (MenuValue, Editor, Info) =>
		{
			if(!Editor.getSelection().trim())
			{
				return;
			}
			const View = this.app.workspace.getLeavesOfType("markdown").map(Leaf => Leaf.view).find(Value => Value instanceof Object && (Value as any).editor === Editor);
			if(View)
			{
				this.Capture.LastView = View as typeof this.Capture.LastView;
			}
			MenuValue.addItem(Item => Item.setTitle("Codex: 解释选区").setIcon("bot").onClick(() => void this.ask_selection(ExplainPrompt)));
			MenuValue.addItem(Item => Item.setTitle("Codex: 检查证明").setIcon("check-check").onClick(() => void this.ask_selection(ProofPrompt)));
		}));
		this.app.workspace.onLayoutReady(() =>
		{
			if(this.Unloaded)
			{
				return;
			}
			this.Capture.track_view();
			this.bind_document(document);
			if(this.Capture.LastView)
			{
				this.bind_document(this.Capture.LastView.containerEl.ownerDocument);
				if(this.Capture.LastView.getMode() === "preview")
				{
					this.Capture.LastView.previewMode.rerender(true);
				}
			}
		});
	}

	private bind_document(DocumentValue: Document): void
	{
		if(this.BoundDocuments.has(DocumentValue))
		{
			return;
		}
		this.BoundDocuments.add(DocumentValue);
		this.registerDomEvent(DocumentValue, "selectionchange", () => this.queue_capture());
		this.registerDomEvent(DocumentValue, "pointerup", () => this.queue_capture());
		this.registerDomEvent(DocumentValue, "keyup", () => this.queue_capture());
	}

	private queue_capture(): void
	{
		if(!this.State.Settings.AutoCapture)
		{
			return;
		}
		if(this.CaptureTimer)
		{
			clearTimeout(this.CaptureTimer);
		}
		this.CaptureTimer = setTimeout(() =>
		{
			this.CaptureTimer = null;
			void this.Capture.capture("选区").then(Snapshot =>
			{
				if(Snapshot && !this.Unloaded)
				{
					this.refresh();
				}
			}).catch(() => {});
		}, 150);
	}

	async toggle_sidebar(): Promise<void>
	{
		const Leaves = this.app.workspace.getLeavesOfType(ViewType);
		if(Leaves.length)
		{
			Leaves.forEach(Leaf => Leaf.detach());
			this.refresh();
			return;
		}
		await this.open_sidebar();
	}

	async open_sidebar(): Promise<void>
	{
		this.Capture.track_view();
		let Leaf = this.app.workspace.getLeavesOfType(ViewType)[0];
		if(!Leaf)
		{
			const RightLeaf = this.app.workspace.getRightLeaf(false);
			if(!RightLeaf)
			{
				new Notice("无法创建右侧聊天栏");
				return;
			}
			Leaf = RightLeaf;
			await Leaf.setViewState({ type: ViewType, active: true });
		}
		await this.app.workspace.revealLeaf(Leaf);
		this.refresh();
		void this.ensure_connection().catch(ErrorValue => this.show_error(ErrorValue));
	}

	refresh(): void
	{
		if(this.Unloaded)
		{
			return;
		}
		this.Ribbon?.toggleClass("is-active", this.app.workspace.getLeavesOfType(ViewType).length > 0);
		for(const Leaf of this.app.workspace.getLeavesOfType(ViewType))
		{
			if(Leaf.view instanceof CodexView)
			{
				Leaf.view.refresh();
			}
		}
	}

	persist(): Promise<void>
	{
		const Data = JSON.parse(JSON.stringify(this.State));
		this.SaveQueue = this.SaveQueue.catch(() => {}).then(() => this.saveData(Data));
		return this.SaveQueue;
	}

	async update_run_settings(Model: string, Effort: string, Fast: boolean): Promise<void>
	{
		if(this.Busy)
		{
			return;
		}
		const Settings = this.State.Settings;
		const ModelChanged = Settings.Model !== Model;
		Settings.Model = Model;
		const Selected = selected_model(Settings, this.Models, this.Defaults);
		Settings.Effort = ModelChanged && !Selected?.supportedReasoningEfforts.some(Value => Value.reasoningEffort === Effort) ? "" : Effort;
		Settings.Fast = Fast && !!fast_tier(Selected);
		this.refresh();
		await this.persist();
	}

	private show_error(ErrorValue: unknown): void
	{
		this.Status = error_text(ErrorValue);
		this.refresh();
		new Notice(`Codex: ${this.Status}`, 7000);
	}

	async ensure_connection(): Promise<void>
	{
		if(this.Connecting)
		{
			return this.Connecting;
		}
		if(this.Connection)
		{
			return;
		}
		const Generation = ++this.Generation;
		this.Status = "连接本机 Codex...";
		this.refresh();
		const Work = (async () =>
		{
			const CliPath = this.State.Settings.CliPath.trim() || await discover_cli();
			if(Generation !== this.Generation || this.Unloaded)
			{
				throw new Error("连接已取消");
			}
			const Adapter = this.app.vault.adapter;
			if(!(Adapter instanceof FileSystemAdapter))
			{
				throw new Error("此插件需要桌面本地 vault");
			}
			const Connection = new CodexConnection(CliPath, Adapter.getBasePath(),
				Message =>
				{
					if(Generation === this.Generation)
					{
						this.handle_message(Message);
					}
				},
				ErrorValue =>
				{
					if(Generation === this.Generation && !this.Unloaded)
					{
						this.Connection = null;
						this.LoadedThread = null;
						this.Busy = false;
						this.TurnId = null;
						this.Activity = "";
						this.Status = `${error_text(ErrorValue)}; 重连后核对会话`;
						this.refresh();
						void this.persist();
					}
				});
			this.Connection = Connection;
			await Connection.request("initialize", { clientInfo: { name: "obsidian_codex_sidebar", title: "Obsidian Codex Sidebar", version: this.manifest.version }, capabilities: { experimentalApi: true } });
			Connection.send({ method: "initialized", params: {} });
			const Account = await Connection.request("account/read", { refreshToken: false });
			if(Generation !== this.Generation || this.Unloaded)
			{
				throw new Error("连接已取消");
			}
			if(!Account.account)
			{
				throw new Error("本机 Codex 尚未登录. 请先在 Codex 应用或 CLI 中登录");
			}
			this.Models = [];
			this.CatalogError = "";
			try
			{
				let Cursor: string | null = null;
				do
				{
					const Page = await Connection.request("model/list", { limit: 100, includeHidden: false, cursor: Cursor });
					this.Models.push(...Page.data);
					Cursor = Page.nextCursor ?? null;
				} while(Cursor);
				const Config = await Connection.request("config/read", {});
				this.Defaults = { Model: Config.config.model ?? "", Effort: Config.config.model_reasoning_effort ?? "" };
			}
			catch(ErrorValue)
			{
				this.CatalogError = `模型选项读取失败: ${error_text(ErrorValue)}; 点击重连重试`;
			}
			if(Generation !== this.Generation || this.Unloaded)
			{
				throw new Error("连接已取消");
			}
			this.Status = `已连接 (${Account.account.type === "chatgpt" ? "ChatGPT 登录" : Account.account.type})`;
			this.refresh();
		})();
		this.Connecting = Work;
		try
		{
			await Work;
		}
		catch(ErrorValue)
		{
			if(Generation === this.Generation)
			{
				this.close_connection();
			}
			throw ErrorValue;
		}
		finally
		{
			if(this.Connecting === Work)
			{
				this.Connecting = null;
			}
		}
	}

	private async ensure_thread(): Promise<void>
	{
		await this.ensure_connection();
		if(this.Session.ThreadId === this.LoadedThread && this.LoadedThread)
		{
			return;
		}
		const Options = run_options(this.State.Settings, this.Models, this.Defaults);
		const Instructions = this.State.Settings.Instructions.trim() || DefaultInstructions;
		const Adapter = this.app.vault.adapter as FileSystemAdapter;
		const Params =
		{
			cwd: Adapter.getBasePath(),
			approvalPolicy: "on-request",
			approvalsReviewer: "user",
			sandbox: "read-only",
			developerInstructions: Instructions,
			...(Options.model ? { model: Options.model } : {}),
			serviceTier: Options.serviceTier,
			config: { model_reasoning_summary: "auto", ...(Options.effort ? { model_reasoning_effort: Options.effort } : {}) }
		};
		const Result = this.Session.ThreadId
			? await this.Connection!.request("thread/resume", { threadId: this.Session.ThreadId, ...Params })
			: await this.Connection!.request("thread/start", Params);
		this.Session.ThreadId = Result.thread.id;
		this.LoadedThread = Result.thread.id;
		this.Model = Result.model ?? Result.thread.model ?? "";
		this.Session.EffectiveModel = this.Model;
		this.Session.EffectiveEffort = Result.reasoningEffort ?? Options.effort;
		this.Session.EffectiveTier = Result.serviceTier ?? "default";
		for(const Turn of Result.thread.turns ?? [])
		{
			for(const Item of Turn.items ?? [])
			{
				if(Item.type === "agentMessage")
				{
					const Message = this.assistant_message(Item.id, Turn.id);
					Message.Text = Item.text;
				}
				if(Item.type === "reasoning" && Item.summary?.length)
				{
					this.assistant_message(Item.id, Turn.id, "reasoning").Text = Item.summary.join("\n\n");
				}
			}
			if(Turn.status === "inProgress")
			{
				this.TurnId = Turn.id;
				this.Activity = "思考中";
				this.StartedAt = Date.now();
			}
		}
		await this.persist();
	}

	async send_message(Question: string, Context = this.State.Settings.AttachContext ? this.Capture.Snapshot : null): Promise<boolean>
	{
		if(this.Busy || !Question.trim())
		{
			return false;
		}
		this.Busy = true;
		this.TurnId = null;
		this.Activity = "准备请求";
		this.StartedAt = Date.now();
		this.refresh();
		let Submitted = false;
		try
		{
			await this.ensure_thread();
			if(this.TurnId)
			{
				this.Status = "已恢复正在运行的回复, 请等待或点击停止";
				this.refresh();
				return false;
			}
			const Instructions = this.State.Settings.Instructions.trim() || DefaultInstructions;
			const InstructionsHash = createHash("sha256").update(Instructions).digest("hex");
			if(this.Session.InstructionsHash !== InstructionsHash)
			{
				await this.Connection!.request("thread/inject_items", { threadId: this.Session.ThreadId, items: instruction_items(Instructions) });
				this.Session.InstructionsHash = InstructionsHash;
				await this.persist();
			}
			const Message: ChatMessage = { Id: crypto.randomUUID(), Role: "user", Text: Question.trim(), ContextLabel: Context ? `${Context.Path} / ${Context.Kind} / ${Context.Mapping}` : undefined };
			this.Session.Messages.push(Message);
			if(this.Session.Title === "新会话")
			{
				this.Session.Title = Question.trim().slice(0, 24);
			}
			await this.persist();
			this.Status = "Codex 正在思考...";
			this.Activity = "思考中";
			this.refresh();
			Submitted = true;
			const Options = run_options(this.State.Settings, this.Models, this.Defaults);
			const Result = await this.Connection!.request("turn/start", { threadId: this.Session.ThreadId, input: [{ type: "text", text: build_prompt(Question.trim(), Context), text_elements: [] }], ...Options });
			this.Session.EffectiveModel = Options.model;
			this.Session.EffectiveEffort = Options.effort;
			this.Session.EffectiveTier = Options.serviceTier;
			this.Model = Options.model ?? this.Model;
			Message.TurnId = Result.turn.id;
			if(!this.CompletedTurns.has(Result.turn.id))
			{
				this.TurnId = Result.turn.id;
			}
			await this.persist();
			return true;
		}
		catch(ErrorValue)
		{
			this.Busy = false;
			this.TurnId = null;
			this.Activity = "";
			if(Submitted)
			{
				this.Session.Messages.push({ Id: crypto.randomUUID(), Role: "system", Text: `请求结果需核对: ${error_text(ErrorValue)}. 请重连, 不会自动重发此问题.` });
				this.Connection?.close();
				this.Connection = null;
				this.LoadedThread = null;
				await this.persist();
			}
			this.show_error(ErrorValue);
			return Submitted;
		}
	}

	async stop_turn(): Promise<void>
	{
		if(!this.TurnId || !this.Connection)
		{
			return;
		}
		try
		{
			const TurnId = this.TurnId;
			await this.Connection.request("turn/interrupt", { threadId: this.Session.ThreadId, turnId: TurnId });
			if(this.Busy && this.TurnId === TurnId)
			{
				this.Status = "正在停止...";
				this.Activity = "正在停止";
			}
			this.refresh();
		}
		catch(ErrorValue)
		{
			this.show_error(ErrorValue);
		}
	}

	async reconnect(): Promise<void>
	{
		if(this.Busy)
		{
			new Notice("请先停止当前回复");
			return;
		}
		this.Generation++;
		this.Connection?.close();
		this.Connection = null;
		this.Connecting = null;
		this.LoadedThread = null;
		try
		{
			await this.ensure_thread();
			this.Busy = !!this.TurnId;
			if(this.Busy)
			{
				this.Status = "已恢复正在运行的回复";
			}
			this.refresh();
		}
		catch(ErrorValue)
		{
			this.show_error(ErrorValue);
		}
	}

	async choose_session(Id?: string): Promise<void>
	{
		if(this.Busy)
		{
			new Notice("请先停止当前回复");
			return;
		}
		if(Id)
		{
			this.State.ActiveId = Id;
		}
		else
		{
			const Session = new_session();
			this.State.Sessions.push(Session);
			this.State.ActiveId = Session.Id;
		}
		this.LoadedThread = null;
		this.TurnId = null;
		this.Model = "";
		this.Activity = "";
		this.Status = this.Session.Messages.length ? "历史会话, 发送后继续" : "新会话, 可以提问";
		await this.persist();
		this.refresh();
	}

	async capture_current(): Promise<void>
	{
		this.Capture.track_view();
		const Snapshot = await this.Capture.capture("当前位置");
		if(!Snapshot)
		{
			new Notice("请先打开 Markdown 笔记. 阅读视图可切换后重试以建立源块映射");
			return;
		}
		this.State.Settings.AttachContext = true;
		this.refresh();
		await this.persist();
	}

	async ask_selection(Prompt: string): Promise<void>
	{
		this.Capture.track_view();
		const Snapshot = await this.Capture.capture("选区") ?? (this.Capture.Snapshot?.Kind === "选区" ? this.Capture.Snapshot : null);
		if(!Snapshot)
		{
			new Notice("请先在笔记中选中文字或公式");
			return;
		}
		await this.open_sidebar();
		await this.send_message(Prompt, Snapshot);
	}

	private assistant_message(Id: string, TurnId: string, Role: "assistant" | "reasoning" = "assistant"): ChatMessage
	{
		let Message = this.Session.Messages.find(Value => Value.Id === Id);
		if(!Message)
		{
			Message = { Id, TurnId, Role, Text: "" };
			this.Session.Messages.push(Message);
		}
		return Message;
	}

	private handle_message(Message: RpcMessage): void
	{
		if(Message.id !== undefined && Message.method)
		{
			void this.handle_request(Message);
			return;
		}
		const Params = Message.params;
		if(!Params || Params.threadId !== this.Session.ThreadId)
		{
			return;
		}
		switch(Message.method)
		{
			case "turn/started":
				this.TurnId = Params.turn.id;
				this.Busy = true;
				this.Activity = "思考中";
				this.StartedAt = this.StartedAt || Date.now();
				break;
			case "item/reasoning/summaryTextDelta":
				{
					const Summary = this.assistant_message(Params.itemId, Params.turnId, "reasoning");
					Summary.SummaryParts ??= [];
					Summary.SummaryParts[Params.summaryIndex] = (Summary.SummaryParts[Params.summaryIndex] ?? "") + Params.delta;
					Summary.Text = Summary.SummaryParts.filter(Boolean).join("\n\n");
					this.Activity = "思考中";
					break;
				}
			case "thread/tokenUsage/updated":
				this.Session.Usage = Params.tokenUsage;
				void this.persist();
				break;
			case "thread/settings/updated":
				this.Model = Params.threadSettings.model;
				this.Session.EffectiveModel = Params.threadSettings.model;
				this.Session.EffectiveEffort = Params.threadSettings.effort;
				this.Session.EffectiveTier = Params.threadSettings.serviceTier ?? "default";
				void this.persist();
				break;
			case "thread/compacted":
				this.Session.InstructionsHash = "";
				void this.persist();
				break;
			case "item/agentMessage/delta":
				this.assistant_message(Params.itemId, Params.turnId).Text += Params.delta;
				this.Status = "Codex 正在回答...";
				this.Activity = "正在回答";
				break;
			case "item/completed":
				if(Params.item.type === "agentMessage")
				{
					this.assistant_message(Params.item.id, Params.turnId).Text = Params.item.text;
				}
				if(Params.item.type === "reasoning" && Params.item.summary?.length)
				{
					this.assistant_message(Params.item.id, Params.turnId, "reasoning").Text = Params.item.summary.join("\n\n");
				}
				if(this.Busy && ["commandExecution", "mcpToolCall", "webSearch"].includes(Params.item.type))
				{
					this.Activity = "思考中";
				}
				if(Params.item.type === "contextCompaction")
				{
					this.Session.InstructionsHash = "";
				}
				void this.persist();
				break;
			case "item/started":
				if(Params.item.type === "fileChange")
				{
					this.ApprovalItems.set(Params.item.id, Params.item.changes);
				}
				if(["commandExecution", "mcpToolCall", "webSearch"].includes(Params.item.type))
				{
					this.Status = "Codex 正在运行工具...";
					this.Activity = "正在运行工具";
				}
				if(Params.item.type === "reasoning")
				{
					this.Activity = "思考中";
				}
				break;
			case "turn/completed":
				this.CompletedTurns.add(Params.turn.id);
				this.ApprovalItems.clear();
				this.Busy = false;
				this.TurnId = null;
				this.Activity = "";
				this.StartedAt = 0;
				this.Status = Params.turn.status === "completed" ? "回复完成" : Params.turn.status === "interrupted" ? "已停止" : `回复失败: ${Params.turn.error?.message ?? Params.turn.status}`;
				void this.persist();
				break;
			case "error":
				this.Status = Params.error?.message ?? "Codex 错误";
				break;
			case "model/rerouted":
				this.Model = Params.toModel;
				this.Session.EffectiveModel = Params.toModel;
				this.Status = `后端已切换模型: ${Params.toModel}`;
				break;
		}
		this.refresh();
	}

	private async handle_request(Message: RpcMessage): Promise<void>
	{
		const Connection = this.Connection;
		let Result: unknown;
		try
		{
			if(Message.method === "item/commandExecution/requestApproval" || Message.method === "item/fileChange/requestApproval")
			{
				const Params = Message.params;
				const Changes = this.ApprovalItems.get(Params.itemId);
				const Description = [Params.reason, Params.command, Params.cwd, Message.method === "item/fileChange/requestApproval" ? `Codex 请求修改文件\n${Changes ? JSON.stringify(Changes, null, 2) : "未收到变更明细"}` : ""].filter(Boolean).join("\n\n");
				this.Activity = "等待批准";
				this.refresh();
				const Decision = await this.ask_approval(Description);
				this.Activity = this.Busy ? "思考中" : "";
				this.refresh();
				Result = { decision: Decision };
			}
			else if(Message.method === "item/tool/requestUserInput")
			{
				this.Activity = "等待补充信息";
				this.refresh();
				Result = await this.ask_questions(Message.params.questions);
				this.Activity = this.Busy ? "思考中" : "";
				this.refresh();
			}
			else
			{
				Connection?.send({ id: Message.id, error: { code: -32601, message: `Unsupported request: ${Message.method}` } });
				this.Status = `当前版本不支持 ${Message.method}`;
				this.refresh();
				return;
			}
			if(Connection === this.Connection)
			{
				Connection?.send({ id: Message.id, result: Result });
			}
		}
		catch
		{
			// The transport may close while an approval modal is open.
		}
	}

	private ask_approval(Description: string): Promise<string>
	{
		return new Promise(Resolve =>
		{
			const Approval = new ApprovalModal(this.app, Description, Value =>
			{
				this.Modals.delete(Approval);
				Resolve(Value);
			});
			this.Modals.add(Approval);
			Approval.open();
		});
	}

	private ask_questions(Questions: any[]): Promise<unknown>
	{
		return new Promise(Resolve =>
		{
			const QuestionsModal = new QuestionsDialog(this.app, Questions, Value =>
			{
				this.Modals.delete(QuestionsModal);
				Resolve(Value);
			});
			this.Modals.add(QuestionsModal);
			QuestionsModal.open();
		});
	}

	onunload(): void
	{
		this.Unloaded = true;
		this.Generation++;
		if(this.CaptureTimer)
		{
			clearTimeout(this.CaptureTimer);
		}
		for(const ModalValue of this.Modals)
		{
			ModalValue.close();
		}
		this.Connection?.close();
		this.Connection = null;
	}
}

class CodexView extends ItemView
{
	private StatusElement!: HTMLElement;
	private ContextElement!: HTMLElement;
	private MessagesElement!: HTMLElement;
	private Input!: HTMLTextAreaElement;
	private SendButton!: HTMLButtonElement;
	private StopButton!: HTMLButtonElement;
	private SessionsElement!: HTMLSelectElement;
	private ModelElement!: HTMLSelectElement;
	private EffortElement!: HTMLSelectElement;
	private FastElement!: HTMLInputElement;
	private UsageToggle!: HTMLInputElement;
	private UsageElement!: HTMLElement;
	private CatalogElement!: HTMLElement;
	private ActivityElement!: HTMLElement;
	private ActivityLabel!: HTMLElement;
	private ActivityTimer: ReturnType<typeof setInterval> | null = null;
	private RenderComponent: Component | null = null;
	private RenderTimer: ReturnType<typeof setTimeout> | null = null;
	private LastRendered = "";
	private Rendering = false;
	private Opened = false;
	private Version = 0;

	constructor(Leaf: WorkspaceLeaf, private Owner: CodexSidebarPlugin)
	{
		super(Leaf);
	}

	getViewType(): string
	{
		return ViewType;
	}

	getDisplayText(): string
	{
		return "Codex";
	}

	getIcon(): string
	{
		return "bot";
	}

	async onOpen(): Promise<void>
	{
		this.Opened = true;
		const Root = this.contentEl;
		Root.empty();
		Root.addClass("codex-sidebar");
		const Header = Root.createDiv({ cls: "codex-header" });
		Header.createEl("strong", { text: "Codex" });
		this.button(Header, "新会话", () => void this.Owner.choose_session());
		this.button(Header, "重连", () => void this.Owner.reconnect());
		this.SessionsElement = Root.createEl("select", { cls: "codex-sessions", attr: { "aria-label": "Codex 会话" } });
		this.SessionsElement.addEventListener("change", () => void this.Owner.choose_session(this.SessionsElement.value));
		this.StatusElement = Root.createDiv({ cls: "codex-status" });
		const ContextBar = Root.createDiv({ cls: "codex-context-actions" });
		this.button(ContextBar, "捕获当前位置", () => void this.Owner.capture_current());
		this.button(ContextBar, "解释选区", () => void this.Owner.ask_selection(ExplainPrompt));
		this.button(ContextBar, "检查证明", () => void this.Owner.ask_selection(ProofPrompt));
		this.ContextElement = Root.createDiv({ cls: "codex-context" });
		this.MessagesElement = Root.createDiv({ cls: "codex-messages", attr: { role: "log", "aria-label": "Codex 对话" } });
		this.ActivityElement = Root.createDiv({ cls: "codex-activity", attr: { role: "status", "aria-live": "polite" } });
		this.ActivityElement.createSpan({ cls: "codex-spinner", attr: { "aria-hidden": "true" } });
		this.ActivityLabel = this.ActivityElement.createSpan();
		const Composer = Root.createDiv({ cls: "codex-composer" });
		const Controls = Composer.createDiv({ cls: "codex-controls" });
		const ModelLabel = Controls.createEl("label");
		ModelLabel.createSpan({ text: "模型" });
		this.ModelElement = ModelLabel.createEl("select", { attr: { "aria-label": "Codex 模型" } });
		const EffortLabel = Controls.createEl("label");
		EffortLabel.createSpan({ text: "思考档次" });
		this.EffortElement = EffortLabel.createEl("select", { attr: { "aria-label": "Codex 思考档次" } });
		const Toggles = Composer.createDiv({ cls: "codex-run-toggles" });
		const FastLabel = Toggles.createEl("label");
		this.FastElement = FastLabel.createEl("input", { type: "checkbox", attr: { "aria-label": "Fast 模式" } });
		FastLabel.createSpan({ text: "Fast" });
		FastLabel.title = "请求更快的服务档次, 可能增加用量; 是否可用由后端决定";
		const UsageLabel = Toggles.createEl("label");
		this.UsageToggle = UsageLabel.createEl("input", { type: "checkbox", attr: { "aria-label": "显示上下文占用" } });
		UsageLabel.createSpan({ text: "上下文占用" });
		const ApplyOptions = () => void this.Owner.update_run_settings(this.ModelElement.value, this.EffortElement.value, this.FastElement.checked);
		this.ModelElement.addEventListener("change", ApplyOptions);
		this.EffortElement.addEventListener("change", ApplyOptions);
		this.FastElement.addEventListener("change", ApplyOptions);
		this.UsageToggle.addEventListener("change", () =>
		{
			this.Owner.State.Settings.ShowUsage = this.UsageToggle.checked;
			this.Owner.refresh();
			void this.Owner.persist();
		});
		this.CatalogElement = Composer.createDiv({ cls: "codex-catalog-status" });
		this.UsageElement = Composer.createDiv({ cls: "codex-usage" });
		this.Input = Composer.createEl("textarea", { attr: { placeholder: "随时提问... Enter 发送, Shift+Enter 换行", "aria-label": "向 Codex 提问" } });
		this.Input.addEventListener("keydown", Event =>
		{
			if(Event.key === "Enter" && !Event.shiftKey && !Event.isComposing)
			{
				Event.preventDefault();
				void this.send_input();
			}
		});
		const Actions = Composer.createDiv({ cls: "codex-compose-actions" });
		this.SendButton = this.button(Actions, "发送", () => void this.send_input());
		this.SendButton.addClass("mod-cta");
		this.StopButton = this.button(Actions, "停止", () => void this.Owner.stop_turn());
		this.ActivityTimer = setInterval(() => this.refresh_activity(), 1000);
		this.refresh();
	}

	private refresh_activity(): void
	{
		this.ActivityElement.hidden = !this.Owner.Busy;
		if(this.Owner.Busy)
		{
			const Seconds = Math.max(0, Math.floor((Date.now() - this.Owner.StartedAt) / 1000));
			this.ActivityLabel.setText(`${this.Owner.Activity || "思考中"} · ${Seconds} 秒`);
		}
	}

	private set_options(ElementValue: HTMLSelectElement, Options: { Value: string; Label: string }[], Current: string): void
	{
		const Signature = JSON.stringify(Options);
		if(ElementValue.dataset.options !== Signature)
		{
			ElementValue.empty();
			for(const Option of Options)
			{
				ElementValue.createEl("option", { text: Option.Label, value: Option.Value });
			}
			ElementValue.dataset.options = Signature;
		}
		ElementValue.value = Current;
	}

	private refresh_controls(): void
	{
		const Settings = this.Owner.State.Settings;
		const Selected = selected_model(Settings, this.Owner.Models, this.Owner.Defaults);
		const ModelOptions = [{ Value: "", Label: `本机默认${this.Owner.Defaults.Model ? ` (${this.Owner.Defaults.Model})` : ""}` }, ...this.Owner.Models.map(Value => ({ Value: Value.model, Label: Value.displayName }))];
		if(Settings.Model && !ModelOptions.some(Value => Value.Value === Settings.Model))
		{
			ModelOptions.push({ Value: Settings.Model, Label: `${Settings.Model} (自定义)` });
		}
		this.set_options(this.ModelElement, ModelOptions, Settings.Model);
		const DefaultEffort = (!Settings.Model ? this.Owner.Defaults.Effort : "") || Selected?.defaultReasoningEffort;
		const EffortOptions = [{ Value: "", Label: `默认${DefaultEffort ? ` (${DefaultEffort})` : ""}` }, ...(Selected?.supportedReasoningEfforts ?? []).map(Value => ({ Value: Value.reasoningEffort, Label: Value.reasoningEffort }))];
		if(Settings.Effort && !EffortOptions.some(Value => Value.Value === Settings.Effort))
		{
			EffortOptions.push({ Value: Settings.Effort, Label: `${Settings.Effort} (请重新选择)` });
		}
		this.set_options(this.EffortElement, EffortOptions, Settings.Effort);
		this.ModelElement.disabled = this.Owner.Busy;
		this.EffortElement.disabled = this.Owner.Busy || !Selected;
		this.FastElement.disabled = this.Owner.Busy || (!fast_tier(Selected) && !Settings.Fast);
		this.FastElement.checked = Settings.Fast;
		this.UsageToggle.checked = Settings.ShowUsage;
		this.CatalogElement.setText(this.Owner.CatalogError);
		this.CatalogElement.hidden = !this.Owner.CatalogError;
		this.UsageElement.hidden = !Settings.ShowUsage;
		this.UsageElement.empty();
		if(Settings.ShowUsage)
		{
			const Usage = context_usage(this.Owner.Session.Usage);
			if(!Usage)
			{
				this.UsageElement.setText("上下文: 等待后端用量报告");
			}
			else
			{
				const Format = (Value: number) => Value.toLocaleString("en-US");
				this.UsageElement.createSpan({ text: `上下文${Usage.Percent !== null ? ` ~${Usage.Percent.toFixed(1)}%` : ""}: ${Format(Usage.Used)}${Usage.Window ? ` / ${Format(Usage.Window)}` : " tokens (窗口未知)"}` });
				if(Usage.Percent !== null)
				{
					const Progress = this.UsageElement.createEl("progress", { attr: { max: "100", "aria-label": "上下文占用估计" } });
					Progress.value = Usage.Percent;
				}
				this.UsageElement.title = `后端最近一次模型请求的输入及输出总量, 估计上下文占用; 尚未计入未发送文字或下一次请求. 会话累计消耗 ${Format(Usage.Total)} tokens. 历史会话显示最近保存的报告.`;
			}
		}
	}

	private button(Parent: HTMLElement, Label: string, Callback: () => void): HTMLButtonElement
	{
		const Button = Parent.createEl("button", { text: Label, attr: { type: "button" } });
		Button.addEventListener("click", Callback);
		return Button;
	}

	private async send_input(): Promise<void>
	{
		const Text = this.Input.value;
		const Accepted = await this.Owner.send_message(Text);
		if(Accepted && this.Input.value === Text)
		{
			this.Input.value = "";
		}
	}

	refresh(): void
	{
		if(!this.Opened || !this.StatusElement)
		{
			return;
		}
		const Session = this.Owner.Session;
		const Effective = [Session.EffectiveModel, Session.EffectiveEffort, Session.EffectiveTier === "priority" || Session.EffectiveTier === "fast" ? "Fast" : ""].filter(Boolean).join(" / ");
		this.StatusElement.setText(`${this.Owner.Status}${Effective ? ` | 最近请求: ${Effective}` : ""}`);
		this.refresh_activity();
		this.refresh_controls();
		this.StatusElement.title = Session.ThreadId ? `Codex thread: ${Session.ThreadId}` : "发送第一条消息后创建 Codex 会话";
		this.SendButton.disabled = this.Owner.Busy;
		this.StopButton.disabled = !this.Owner.Busy || !this.Owner.TurnId;
		const Options = this.Owner.State.Sessions.map(Value => `${Value.Id}:${Value.Title}`).join("|");
		if(this.SessionsElement.dataset.options !== Options)
		{
			this.SessionsElement.empty();
			for(const Value of this.Owner.State.Sessions.slice().reverse())
			{
				this.SessionsElement.createEl("option", { text: Value.Title, value: Value.Id });
			}
			this.SessionsElement.dataset.options = Options;
		}
		this.SessionsElement.value = Session.Id;
		this.SessionsElement.disabled = this.Owner.Busy;
		this.ContextElement.empty();
		const Snapshot = this.Owner.Capture.Snapshot;
		if(Snapshot)
		{
			const Label = this.ContextElement.createEl("label", { cls: "codex-context-label" });
			const Checkbox = Label.createEl("input", { type: "checkbox" });
			Checkbox.checked = this.Owner.State.Settings.AttachContext;
			Checkbox.addEventListener("change", () =>
			{
				this.Owner.State.Settings.AttachContext = Checkbox.checked;
				void this.Owner.persist();
			});
			Label.createSpan({ text: `附带 ${Snapshot.Kind} (${Snapshot.Mode}, ${Snapshot.Mapping})` });
			const Details = this.ContextElement.createEl("details");
			Details.createEl("summary", { text: `${Snapshot.Path}${Snapshot.LineStart !== null ? `:${Snapshot.LineStart + 1}` : ""}` });
			Details.createDiv({ text: Snapshot.Heading || "未定位标题", cls: "codex-context-heading" });
			Details.createEl("pre", { text: Snapshot.Text });
			if(Snapshot.Truncated)
			{
				Details.createDiv({ text: "内容已截断到上下文长度限制" });
			}
			this.button(this.ContextElement, "清除上下文", () =>
			{
				this.Owner.Capture.Snapshot = null;
				this.Owner.refresh();
			});
		}
		else
		{
			this.ContextElement.setText("在笔记中选中文字, 或捕获当前阅读位置");
		}
		if(!this.RenderTimer)
		{
			this.RenderTimer = setTimeout(() =>
			{
				this.RenderTimer = null;
				void this.render_messages();
			}, 100);
		}
	}

	private async render_messages(): Promise<void>
	{
		if(this.Rendering || !this.Opened)
		{
			return;
		}
		const Messages = this.Owner.Session.Messages;
		const Signature = JSON.stringify(Messages);
		if(Signature === this.LastRendered)
		{
			return;
		}
		this.Rendering = true;
		const Version = ++this.Version;
		const AtBottom = this.MessagesElement.scrollHeight - this.MessagesElement.scrollTop - this.MessagesElement.clientHeight < 80;
		const OldScroll = this.MessagesElement.scrollTop;
		this.RenderComponent?.unload();
		const RenderComponent = new Component();
		this.RenderComponent = RenderComponent;
		RenderComponent.load();
		this.MessagesElement.empty();
		try
		{
			if(!Messages.length)
			{
				this.MessagesElement.createDiv({ cls: "codex-welcome", text: "可以直接提问, 或选中笔记内容后点击解释选区 / 检查证明. 阅读模式会附带原始 Markdown 源块." });
			}
			for(const Message of Messages)
			{
				if(!this.Opened || Version !== this.Version)
				{
					return;
				}
				const Card = this.MessagesElement.createDiv({ cls: `codex-message codex-${Message.Role}` });
				const Header = Card.createDiv({ cls: "codex-message-label" });
				Header.createSpan({ text: Message.Role === "user" ? "你" : Message.Role === "assistant" ? "Codex" : Message.Role === "reasoning" ? "思考摘要" : "状态" });
				if(Message.Role === "assistant")
				{
					this.button(Header, "复制", () => void navigator.clipboard.writeText(Message.Text));
				}
				if(Message.ContextLabel)
				{
					Card.createDiv({ cls: "codex-message-context", text: Message.ContextLabel });
				}
				const Content = Message.Role === "reasoning" ? Card.createEl("details") : Card;
				if(Message.Role === "reasoning")
				{
					Content.createEl("summary", { text: "查看 Codex 返回的思考摘要" });
				}
				const Body = Content.createDiv({ cls: "codex-message-body markdown-rendered" });
				if(Message.Role === "assistant" || Message.Role === "reasoning")
				{
					await MarkdownRenderer.render(this.app, Message.Text || "...", Body, this.Owner.Capture.LastView?.file?.path ?? "", RenderComponent);
				}
				else
				{
					Body.setText(Message.Text);
				}
			}
			this.LastRendered = Signature;
			this.MessagesElement.scrollTop = AtBottom ? this.MessagesElement.scrollHeight : OldScroll;
		}
		finally
		{
			this.Rendering = false;
			if(this.Opened && Signature !== JSON.stringify(this.Owner.Session.Messages))
			{
				this.refresh();
			}
		}
	}

	async onClose(): Promise<void>
	{
		this.Opened = false;
		this.Version++;
		if(this.RenderTimer)
		{
			clearTimeout(this.RenderTimer);
		}
		if(this.ActivityTimer)
		{
			clearInterval(this.ActivityTimer);
			this.ActivityTimer = null;
		}
		this.RenderComponent?.unload();
		this.Owner.refresh();
	}
}

class CodexSettings extends PluginSettingTab
{
	constructor(AppValue: App, private Owner: CodexSidebarPlugin)
	{
		super(AppValue, Owner);
	}

	display(): void
	{
		this.containerEl.empty();
		this.containerEl.createEl("h2", { text: "Codex Sidebar" });
		new Setting(this.containerEl).setName("Codex 可执行文件").setDesc("留空时从 PATH 查找 codex.exe. 使用本机 Codex 登录.").addText(TextValue => TextValue
			.setValue(this.Owner.State.Settings.CliPath).setPlaceholder("C:\\...\\codex.exe").onChange(async Value =>
			{
				this.Owner.State.Settings.CliPath = Value.trim();
				await this.Owner.persist();
			}));
		new Setting(this.containerEl).setName("模型").setDesc("推荐在侧栏选择后端返回的模型. 此处也可输入模型 ID, 留空沿用本机配置. 下一次发送生效.").addText(TextValue => TextValue
			.setValue(this.Owner.State.Settings.Model).onChange(async Value =>
			{
				this.Owner.State.Settings.Model = Value.trim();
				this.Owner.State.Settings.Effort = "";
				this.Owner.refresh();
				await this.Owner.persist();
			}));
		new Setting(this.containerEl).setName("内置工作提示词").setDesc("作为 Codex developer 消息注入会话, 保留其基础工具指令. 默认说明 Obsidian 阅读与研究工作及 Markdown/MathJax 渲染规则. 修改后在下一次发送更新当前会话.").addTextArea(TextValue =>
		{
			TextValue.inputEl.rows = 12;
			TextValue.inputEl.addClass("codex-instructions-input");
			TextValue.setValue(this.Owner.State.Settings.Instructions).onChange(async Value =>
			{
				this.Owner.State.Settings.Instructions = Value;
				await this.Owner.persist();
			});
		});
		new Setting(this.containerEl).setName("恢复默认工作提示词").addButton(Button => Button.setButtonText("恢复默认").onClick(async () =>
		{
			this.Owner.State.Settings.Instructions = DefaultInstructions;
			await this.Owner.persist();
			this.display();
		}));
		new Setting(this.containerEl).setName("自动捕获选区").setDesc("选中文字后更新上下文卡片. 点击快捷动作或发送按钮后提问.").addToggle(Toggle => Toggle
			.setValue(this.Owner.State.Settings.AutoCapture).onChange(async Value =>
			{
				this.Owner.State.Settings.AutoCapture = Value;
				await this.Owner.persist();
			}));
		new Setting(this.containerEl).setName("默认附带上下文").addToggle(Toggle => Toggle
			.setValue(this.Owner.State.Settings.AttachContext).onChange(async Value =>
			{
				this.Owner.State.Settings.AttachContext = Value;
				this.Owner.refresh();
				await this.Owner.persist();
			}));
		new Setting(this.containerEl).setName("重新连接").addButton(Button => Button.setButtonText("重连 Codex").onClick(() => void this.Owner.reconnect()));
	}
}

class ApprovalModal extends Modal
{
	private Decision = "decline";

	constructor(AppValue: App, private Description: string, private Resolve: (Value: string) => void)
	{
		super(AppValue);
	}

	onOpen(): void
	{
		this.contentEl.createEl("h3", { text: "Codex 请求批准" });
		this.contentEl.createEl("pre", { text: this.Description, cls: "codex-approval-description" });
		new Setting(this.contentEl)
			.addButton(Button => Button.setButtonText("拒绝").onClick(() => this.close()))
			.addButton(Button => Button.setButtonText("批准这一次").setCta().onClick(() =>
			{
				this.Decision = "accept";
				this.close();
			}));
	}

	onClose(): void
	{
		this.Resolve(this.Decision);
		this.contentEl.empty();
	}
}

class QuestionsDialog extends Modal
{
	private Answers: Record<string, { answers: string[] }> = {};

	constructor(AppValue: App, private Questions: any[], private Resolve: (Value: unknown) => void)
	{
		super(AppValue);
	}

	onOpen(): void
	{
		this.contentEl.createEl("h3", { text: "Codex 需要补充信息" });
		for(const Question of this.Questions)
		{
			this.contentEl.createEl("p", { text: Question.question });
			for(const Option of Question.options ?? [])
			{
				this.contentEl.createDiv({ text: `${Option.label}: ${Option.description}` });
			}
			new Setting(this.contentEl).setName(Question.header).addText(TextValue =>
			{
				if(Question.isSecret)
				{
					TextValue.inputEl.type = "password";
				}
				TextValue.onChange(Value => this.Answers[Question.id] = { answers: [Value] });
			});
		}
		new Setting(this.contentEl).addButton(Button => Button.setButtonText("提交").setCta().onClick(() => this.close()));
	}

	onClose(): void
	{
		this.Resolve({ answers: this.Answers });
		this.contentEl.empty();
	}
}
