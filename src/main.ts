import {
	Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Notice,
	MarkdownRenderer, Component, FileSystemAdapter, Modal, editorInfoField, Platform, requestUrl, type App
} from "obsidian";
import { ContextCapture } from "./context";
import { build_prompt, DefaultInstructions, editing_instructions, migrate_instructions, environment_instructions, instruction_items, type ContextSnapshot, type AnswerQuote } from "./prompt";
import { answer_quote } from "./quote";
import { branch_prefix, history_items, type ChatMessage } from "./history";
import type { CompletionService, CompletionInput } from "./completion";
import { InlineCompletions } from "./inline";
import { ObsidianTool, run_obsidian_read } from "./obsidian-tool";
import type { RpcMessage } from "./rpc";
import { RemoteConnection, remote_url, type RemoteConfig, type RpcConnection } from "./remote";
import { browser_http } from "./browser-http";
import { math_writing_skill, skill_input, type SkillInput } from "./skills";
import { selected_model, initial_selection, fast_tier, run_options, context_usage, type ModelInfo, type TokenUsage } from "./controls";
import { StudyStore } from "./study/store";
import { StudyController } from "./study/controller";
import { ObsidianWriteHost } from "./study/obsidian-host";
import { StudyPanel } from "./study/panel";
import { task_prompt, type TaskSpec } from "./study/task";
import { structured_task, question_label } from "./study/presentation";
import { safe_math_markdown } from "./study/safe-markdown";

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
	Completion: boolean;
	CompletionDelay: number;
	ObsidianCliPath: string;
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
	Private?: boolean;
	LegacyThreadId?: string;
	ParentId?: string;
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

function accessible_name(ElementValue: HTMLElement, Text: string): void
{
	const Label = ElementValue.ownerDocument.createElement("span");
	Label.id = `codex-label-${crypto.randomUUID()}`;
	Label.className = "codex-sr-only";
	Label.textContent = Text;
	ElementValue.insertAdjacentElement("afterend", Label);
	ElementValue.setAttribute("aria-labelledby", Label.id);
}

async function instruction_hash(Text: string): Promise<string>
{
	const Hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Text));
	return [...new Uint8Array(Hash)].map(Value => Value.toString(16).padStart(2, "0")).join("");
}

export default class CodexSidebarPlugin extends Plugin
{
	State!: SavedState;
	Capture!: ContextCapture;
	Status = "尚未连接";
	Model = "";
	Models: ModelInfo[] = [];
	AnswerQuote: AnswerQuote | null = null;
	CatalogError = "";
	MathWritingSkill: SkillInput | null = null;
	SkillStatus = "math-writing: 连接后检查";
	Activity = "";
	StartedAt = 0;
	Busy = false;
	TurnId: string | null = null;
	Ribbon!: HTMLElement;
	private Connection: RpcConnection | null = null;
	Remote!: RemoteConfig;
	private RemoteKey = "";
	private RemoteStatePath = "";
	private Desktop: typeof import("./desktop") | null = null;
	private HostInfo: { cwd: string; vault: string; cli: string; client: string; mathWritingVersion?: string } | null = null;
	private Connecting: Promise<void> | null = null;
	private LoadingSkill: Promise<SkillInput> | null = null;
	private LoadedThread: string | null = null;
	private Generation = 0;
	private Unloaded = false;
	private CompletedTurns = new Set<string>();
	private ApprovalItems = new Map<string, unknown>();
	private SaveQueue: Promise<void> = Promise.resolve();
	private CaptureTimer: ReturnType<typeof setTimeout> | null = null;
	private StudyVersionTimer: ReturnType<typeof setTimeout> | null = null;
	private Modals = new Set<Modal>();
	private BoundDocuments = new Set<Document>();
	private CompletionWorker: CompletionService | null = null;
	Inline!: InlineCompletions;
	private CompletionStatus!: HTMLElement;
	private LiveThreads = new Map<string, string>();
	Study: StudyController | null = null;
	private StudyAnswerFocused = false;

	get Session(): ChatSession
	{
		return this.State.Sessions.find(Value => Value.Id === this.State.ActiveId)!;
	}

	private close_connection(): void
	{
		this.Connection?.close();
		this.Connection = null;
		this.LoadedThread = null;
		this.LiveThreads.clear();
		this.MathWritingSkill = null;
		this.LoadingSkill = null;
		this.SkillStatus = "math-writing: 连接后检查";
	}

	async onload(): Promise<void>
	{
		this.RemoteKey = `codex-sidebar-remote:${this.app.vault.getName()}`;
		let RemoteSaved: Partial<RemoteConfig> = {};
		try
		{
			RemoteSaved = JSON.parse(localStorage.getItem(this.RemoteKey) || "{}");
		}
		catch
		{
			/* Ignore invalid device-local configuration. */
		}
		this.Remote = { Enabled: Platform.isMobileApp, Url: "", Token: "", Cursor: 0, Server: "", ...RemoteSaved };
		if(!/^[a-z0-9-]{36}$/i.test(this.Remote.CacheId ?? ""))
		{
			this.Remote.CacheId = crypto.randomUUID();
		}
		if(Platform.isMobileApp)
		{
			this.Remote.Enabled = true;
		}
		this.RemoteStatePath = `${this.manifest.dir}/remote-${this.Remote.CacheId}-state.json`;
		this.save_remote_config();
		if(!this.Remote.Enabled)
		{
			this.Desktop = await import("./desktop");
			this.CompletionWorker = new this.Desktop.CompletionService();
		}
		const Saved = this.Remote.Enabled ? await this.app.vault.adapter.exists(this.RemoteStatePath) ? JSON.parse(await this.app.vault.adapter.read(this.RemoteStatePath)) as Partial<SavedState> : null : await this.loadData() as Partial<SavedState> | null;
		const Sessions = Saved?.Sessions?.filter(Value => Value.Id && Array.isArray(Value.Messages)) ?? [];
		if(!Sessions.length)
		{
			Sessions.push(new_session());
		}
		for(const Session of Sessions)
		{
			if(this.Remote.Enabled)
			{
				continue;
			}
			if(Session.ThreadId && !Session.Private)
			{
				Session.LegacyThreadId = Session.ThreadId;
			}
			Session.ThreadId = null;
			Session.InstructionsHash = "";
		}
		this.State =
		{
			Settings: { CliPath: "", Model: "", Effort: "", Fast: false, ShowUsage: true, Instructions: DefaultInstructions, AttachContext: true, AutoCapture: true, Completion: true, CompletionDelay: 1200, ObsidianCliPath: "", ...Saved?.Settings },
			Sessions,
			ActiveId: Sessions.some(Value => Value.Id === Saved?.ActiveId) ? Saved!.ActiveId! : Sessions[0].Id
		};
		this.State.Settings.Instructions = migrate_instructions(this.State.Settings.Instructions);
		if(!this.State.Settings.Model)
		{
			this.State.Settings.Model = this.Session.EffectiveModel ?? "";
			this.State.Settings.Effort ||= this.Session.EffectiveEffort ?? "";
		}
		this.CompletionStatus = this.addStatusBarItem();
		this.CompletionStatus.setText(this.State.Settings.Completion ? "Codex 补全已开启" : "Codex 补全已关闭");
		this.Inline = new InlineCompletions({
			Enabled: () => this.State.Settings.Completion && !this.Unloaded && !this.StudyAnswerFocused,
			Delay: () => Math.max(500, this.State.Settings.CompletionDelay),
			Path: View => View.state.field(editorInfoField, false)?.file?.path ?? null,
			Request: (Input, Signal) => this.request_completion(Input, Signal),
			Status: Text => this.CompletionStatus.setText(Text),
			Changed: () => this.refresh()
		});
		this.registerEditorExtension(this.Inline.Extension);
		this.Capture = new ContextCapture(this.app);
		try
		{
			const Host = new ObsidianWriteHost(this.app);
			this.Study = new StudyController(new StudyStore(localStorage, this.app.vault.getName()), {
				read_current: Path => Host.read_current(Path),
				compare_write: (Path, Before, After) => Host.compare_write(Path, Before, After),
				send_task: Task => this.send_message(Task.Request, Task.Source, null, Task),
				changed: () => this.refresh(),
				suppress_completion: Paused =>
				{
					this.StudyAnswerFocused = Paused;
					if(Paused)
					{
						this.Inline.clear(); this.CompletionWorker?.close();
					}
					this.CompletionStatus.setText(Paused ? "学习作答中, 补全暂停" : this.State.Settings.Completion ? "Codex 补全已开启" : "Codex 补全已关闭");
				}
			});
		}
		catch(ErrorValue)
		{
			this.Status = error_text(ErrorValue);
		}
		this.registerView(ViewType, Leaf => new CodexView(Leaf, this));
		this.Ribbon = this.addRibbonIcon("bot", "Codex 聊天 (打开/收起)", () => void this.toggle_sidebar());
		this.Ribbon.addClass("codex-sidebar-ribbon");
		this.addCommand({ id: "toggle", name: "打开/收起聊天栏", callback: () => void this.toggle_sidebar() });
		this.addCommand({ id: "explain-selection", name: "解释选区", callback: () => void this.ask_selection(ExplainPrompt) });
		this.addCommand({ id: "check-proof", name: "检查选区证明", callback: () => void this.ask_selection(ProofPrompt) });
		this.addCommand({ id: "capture-reading", name: "捕获当前阅读位置", callback: () => void this.capture_current() });
		this.addCommand({ id: "toggle-completion", name: "开启/关闭行内补全", callback: () => void this.set_completion(!this.State.Settings.Completion) });
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
		const VersionChanged = (Path: string | undefined) =>
		{
			if(!Path || !this.Study?.Store.Data.Exercises.some(Value => Value.Source.Path === Path)) { return; }
			if(this.StudyVersionTimer) { clearTimeout(this.StudyVersionTimer); }
			this.StudyVersionTimer = setTimeout(() =>
			{
				this.StudyVersionTimer = null;
				void this.Study?.check_versions().catch(ErrorValue => { this.Status = error_text(ErrorValue); this.refresh(); });
			}, 300);
		};
		this.registerEvent(this.app.vault.on("modify", File => VersionChanged(File.path)));
		this.registerEvent(this.app.workspace.on("editor-change", (_Editor, Info) => VersionChanged(Info?.file?.path)));
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

	async set_completion(Enabled: boolean): Promise<void>
	{
		this.State.Settings.Completion = Enabled;
		this.Inline.clear();
		this.CompletionWorker?.close();
		this.CompletionStatus.setText(Enabled ? "Codex 补全已开启" : "Codex 补全已关闭");
		this.refresh();
		await this.persist();
	}

	private work_instructions(): string
	{
		return environment_instructions(editing_instructions(this.State.Settings.Instructions), {
			Vault: this.app.vault.getName(), Root: this.host_cwd(),
			Cli: this.obsidian_cli()
		}) + (this.Remote.Enabled ? "\n\n这是独立的 iPad/远程 Obsidian 会话. CLI 在 Windows, 用户界面在客户端. 当前笔记与选区以用户随问题提供的源快照为准, Windows vault 副本可能尚未同步. 只读 CLI 工具读到的是电脑副本, 不能声称看到了 iPad 屏幕、未同步文件或桌面其他会话. 不修改笔记, 补全只返回建议供客户端确认." : "");
	}

	private host_cwd(): string
	{
		return this.Remote.Enabled ? this.HostInfo?.cwd ?? "" : (this.app.vault.adapter as FileSystemAdapter).getBasePath();
	}

	save_remote_config(): void
	{
		localStorage.setItem(this.RemoteKey, JSON.stringify(this.Remote));
	}

	async remote_http(Path: string, Method: string, Body?: unknown): Promise<any>
	{
		const Url = remote_url(this.Remote.Url);
		if(!this.Remote.Token.trim())
		{
			throw new Error("请在设置中填写远程配对密钥");
		}
		const Operation = Path === "/rpc" ? (Body as { method?: string })?.method ?? "RPC" : Path.split("?")[0];
		try
		{
			const Params = { url: Url + Path, method: Method, headers: { Authorization: `Bearer ${this.Remote.Token.trim()}`, "Content-Type": "application/json" }, ...(Body === undefined ? {} : { body: JSON.stringify(Body) }) };
			const Response = Platform.isMobileApp
				? await browser_http({ ...Params, timeout: Operation === "bridge/completion" ? 120000 : 30000 })
				: await requestUrl({ ...Params, throw: false });
			const Value = Response.json;
			if(Response.status !== 200)
			{
				throw new Error(Value.error ?? `远程服务错误 (${Response.status})`);
			}
			return Value;
		}
		catch(ErrorValue)
		{
			throw new Error(`远程 ${Method} ${Operation}: ${error_text(ErrorValue)}`);
		}
	}

	private obsidian_cli(): string
	{
		return this.Remote.Enabled ? this.HostInfo?.cli ?? "obsidian" : this.Desktop!.obsidian_cli(this.State.Settings.ObsidianCliPath);
	}

	async request_completion(Input: CompletionInput, Signal: AbortSignal): Promise<string>
	{
		if(Signal.aborted || this.Unloaded || this.StudyAnswerFocused)
		{
			throw new Error("补全已取消");
		}
		await this.ensure_connection();
		const Skill = await this.ensure_math_skill();
		if(Signal.aborted || this.Unloaded || this.StudyAnswerFocused)
		{
			throw new Error("补全已取消");
		}
		const Options = run_options(this.State.Settings, this.Models);
		const Selected = selected_model(this.State.Settings, this.Models);
		Options.effort = Selected?.supportedReasoningEfforts.find(Value => Value.reasoningEffort === "low")?.reasoningEffort ?? Selected?.defaultReasoningEffort ?? "low";
		if(this.Remote.Enabled)
		{
			const Job = crypto.randomUUID();
			const Connection = this.Connection!;
			const Cancel = () => void Connection.request("bridge/completion/cancel", { job: Job }).catch(() => {});
			Signal.addEventListener("abort", Cancel, { once: true });
			try
			{
				const Result = await Connection.request("bridge/completion", { job: Job, input: Input, options: Options });
				if(Signal.aborted)
				{
					throw new Error("补全已取消");
				}
				return Result.text;
			}
			finally
			{
				Signal.removeEventListener("abort", Cancel);
			}
		}
		const Cli = this.State.Settings.CliPath.trim() || await this.Desktop!.discover_cli();
		return this.CompletionWorker!.complete(Cli, this.host_cwd(), Input, Options, Signal, Skill);
	}

	async ensure_math_skill(): Promise<SkillInput>
	{
		if(this.MathWritingSkill)
		{
			return this.MathWritingSkill;
		}
		if(this.LoadingSkill)
		{
			return this.LoadingSkill;
		}
		const Connection = this.Connection;
		if(!Connection)
		{
			throw new Error("请先连接本机 Codex");
		}
		const Work = (async () =>
		{
			try
			{
				const Cwd = this.host_cwd();
				const Result = await Connection.request("skills/list", { cwds: [Cwd], forceReload: true });
				const Skill = math_writing_skill(Result, Cwd);
				if(this.Connection !== Connection || this.Unloaded)
				{
					throw new Error("技能检查已取消");
				}
				if(!this.Remote.Enabled && !this.Desktop!.existsSync(Skill.path))
				{
					throw new Error("math-writing 的 SKILL.md 不存在, 请重新安装技能并重连");
				}
				const Version = this.Remote.Enabled ? this.HostInfo?.mathWritingVersion ?? "未确认" : this.Desktop!.skill_version(Skill.path);
				this.MathWritingSkill = Skill;
				this.SkillStatus = `math-writing 就绪 (${Version}), 每次请求加载${Version === "未确认" ? "; 入门使用内置等效规则" : ""}`;
				this.refresh();
				return Skill;
			}
			catch(ErrorValue)
			{
				if(this.Connection === Connection && !this.Unloaded)
				{
					this.SkillStatus = `math-writing 未就绪: ${error_text(ErrorValue)}`;
					this.refresh();
				}
				throw ErrorValue;
			}
		})();
		this.LoadingSkill = Work;
		try
		{
			return await Work;
		}
		finally
		{
			if(this.LoadingSkill === Work)
			{
				this.LoadingSkill = null;
			}
		}
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
		this.registerDomEvent(DocumentValue, "scroll", () =>
		{
			if(this.Study && !this.Study.Store.Data.Pinned && this.Study.Store.Data.Mode === "reading") { this.queue_capture(); }
		}, { capture: true });
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
			void this.Capture.capture("选区").then(async Snapshot =>
			{
				if(!Snapshot && this.Study && !this.Study.Store.Data.Pinned && this.Study.Store.Data.Mode === "reading")
				{
					Snapshot = await this.Capture.capture("当前位置");
				}
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
			await this.persist();
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
		void this.ensure_connection().then(async () =>
		{
			if(this.Remote.Enabled)
			{
				await this.ensure_thread();
				this.Busy = !!this.TurnId;
				this.refresh();
			}
		}).catch(ErrorValue => this.show_error(ErrorValue));
	}

	refresh(): void
	{
		if(this.Unloaded)
		{
			return;
		}
		this.Ribbon?.toggleClass("is-active", this.app.workspace.getLeavesOfType(ViewType).length > 0);
		this.Study?.consume(this.Session.Messages);
		for(const Leaf of this.app.workspace.getLeavesOfType(ViewType))
		{
			if(Leaf.view instanceof CodexView)
			{
				Leaf.view.refresh();
			}
		}
	}

	persist(SyncRemote = true): Promise<void>
	{
		const Data = JSON.parse(JSON.stringify(this.State));
		const RemoteMode = this.Remote.Enabled;
		const StatePath = this.RemoteStatePath;
		const RemoteConnectionValue = this.Connection instanceof RemoteConnection ? this.Connection : null;
		const RemoteCursor = RemoteConnectionValue?.cursor_snapshot() ?? 0;
		this.SaveQueue = this.SaveQueue.catch(() => {}).then(async () =>
		{
			if(RemoteMode)
			{
				await this.app.vault.adapter.write(StatePath, JSON.stringify(Data));
			}
			else
			{
				await this.saveData(Data);
			}
		});
		return RemoteMode && RemoteConnectionValue && SyncRemote
			? this.SaveQueue.then(() => RemoteConnectionValue.sync_state(Data, RemoteCursor)) : this.SaveQueue;
	}

	async set_remote_mode(Enabled: boolean): Promise<void>
	{
		if(this.Busy)
		{
			throw new Error("请先停止当前回复再切换连接");
		}
		await this.persist(false);
		this.Generation++;
		this.close_connection();
		this.CompletionWorker?.close();
		this.Connecting = null;
		this.Remote.Enabled = Enabled || Platform.isMobileApp;
		this.RemoteStatePath = `${this.manifest.dir}/remote-${this.Remote.CacheId}-state.json`;
		this.save_remote_config();
		const Saved = this.Remote.Enabled ? await this.app.vault.adapter.exists(this.RemoteStatePath) ? JSON.parse(await this.app.vault.adapter.read(this.RemoteStatePath)) : null : await this.loadData();
		this.State = Saved?.Sessions?.length ? Saved : { Settings: { ...this.State.Settings }, Sessions: [new_session()], ActiveId: "" };
		if(!this.State.Sessions.some(Value => Value.Id === this.State.ActiveId))
		{
			this.State.ActiveId = this.State.Sessions[0].Id;
		}
		if(!this.Remote.Enabled)
		{
			this.Desktop ??= await import("./desktop");
			this.CompletionWorker = new this.Desktop.CompletionService();
			this.State.Sessions.forEach(Value => { Value.ThreadId = null; Value.InstructionsHash = ""; });
		}
		this.AnswerQuote = null;
		this.Models = [];
		this.Status = this.Remote.Enabled ? "独立远程会话, 连接后使用" : "本机桌面会话";
		this.refresh();
		await this.persist();
	}

	async configure_remote(Url: string, Token: string): Promise<void>
	{
		remote_url(Url);
		if(this.Busy)
		{
			throw new Error("请先停止当前回复再更换远程连接");
		}
		await this.persist(false);
		this.close_connection();
		if(this.Remote.Url !== Url || this.Remote.Token !== Token)
		{
			this.Remote.CacheId = crypto.randomUUID();
			this.Remote.Cursor = 0;
			this.Remote.Server = "";
		}
		this.Remote.Url = Url;
		this.Remote.Token = Token;
		this.save_remote_config();
		await this.set_remote_mode(true);
		await this.ensure_thread();
		this.Busy = !!this.TurnId;
		this.refresh();
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
		const Selected = selected_model(Settings, this.Models);
		Settings.Effort = ModelChanged && !Selected?.supportedReasoningEfforts.some(Value => Value.reasoningEffort === Effort) ? Selected?.defaultReasoningEffort ?? Selected?.supportedReasoningEfforts[0]?.reasoningEffort ?? "" : Effort;
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
		this.Status = this.Remote.Enabled ? "连接独立远程 Codex..." : "连接本机 Codex...";
		this.refresh();
		const Work = (async () =>
		{
			const CliPath = this.Remote.Enabled ? "" : this.State.Settings.CliPath.trim() || await this.Desktop!.discover_cli();
			if(Generation !== this.Generation || this.Unloaded)
			{
				throw new Error("连接已取消");
			}
			const Adapter = this.app.vault.adapter;
			if(!this.Remote.Enabled && !(Adapter instanceof FileSystemAdapter))
			{
				throw new Error("此插件需要桌面本地 vault");
			}
			const OnMessage = (Message: RpcMessage) =>
				{
					if(Generation === this.Generation)
					{
						this.handle_message(Message);
					}
				};
			const OnClosed = (ErrorValue: Error) =>
				{
					if(Generation === this.Generation && !this.Unloaded)
					{
						this.Connection = null;
						this.MathWritingSkill = null;
						this.LoadingSkill = null;
						this.SkillStatus = "math-writing: 连接后检查";
						this.LoadedThread = null;
						this.LiveThreads.clear();
						this.Busy = false;
						this.TurnId = null;
						this.Activity = "";
						this.Status = `${error_text(ErrorValue)}; 重连后核对会话`;
						this.refresh();
						void this.persist();
					}
				};
			const Connection: RpcConnection = this.Remote.Enabled
				? new RemoteConnection((Path, Method, Body) => this.remote_http(Path, Method, Body), this.Remote, OnMessage, OnClosed, () => this.save_remote_config())
				: new this.Desktop!.CodexConnection(CliPath, this.host_cwd(), OnMessage, OnClosed);
			this.Connection = Connection;
			if(Connection instanceof RemoteConnection)
			{
				await Connection.connect();
				this.HostInfo = Connection.Info;
				if(this.HostInfo?.vault !== this.app.vault.getName())
				{
					throw new Error("远程服务绑定的 vault 与当前库不同");
				}
				const Restored = await this.remote_http("/state", "GET");
				if(Restored.state?.Sessions?.length)
				{
					this.State = Restored.state;
				}
				Connection.set_cursor(Restored.cursor);
				this.refresh();
			}
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
			const Legacy = this.State.Sessions.filter(Value => Value.LegacyThreadId);
			const Archived = new Set<string>();
			if(Legacy.length)
			{
				let Cursor: string | null = null;
				do
				{
					const Page = await Connection.request("thread/list", { archived: true, cwd: this.host_cwd(), limit: 100, cursor: Cursor });
					Page.data.forEach((Value: { id: string }) => Archived.add(Value.id));
					Cursor = Page.nextCursor ?? null;
				} while(Cursor && Legacy.some(Value => !Archived.has(Value.LegacyThreadId!)));
			}
			for(const Session of Legacy)
			{
				if(Session.LegacyThreadId)
				{
					try
					{
						if(!Archived.has(Session.LegacyThreadId))
						{
							await Connection.request("thread/archive", { threadId: Session.LegacyThreadId });
						}
						delete Session.LegacyThreadId;
					}
					catch(ErrorValue)
					{
						new Notice(`旧插件会话未能从 Codex GUI 归档: ${error_text(ErrorValue)}. 新会话仍使用临时后台模式.`, 7000);
					}
				}
			}
			await this.persist(false);
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
				Object.assign(this.State.Settings, initial_selection(this.State.Settings, this.Models));
				this.refresh();
				await this.persist(false);
			}
			catch(ErrorValue)
			{
				this.CatalogError = `模型选项读取失败: ${error_text(ErrorValue)}; 点击重连重试`;
				this.refresh();
			}
			if(Generation !== this.Generation || this.Unloaded)
			{
				throw new Error("连接已取消");
			}
			this.Status = `${this.Remote.Enabled ? "独立远程已连接" : "已连接"} (${Account.account.type === "chatgpt" ? "ChatGPT 登录" : Account.account.type})`;
			await this.ensure_math_skill().catch(() => {});
			this.refresh();
			if(Connection instanceof RemoteConnection)
			{
				Connection.start();
			}
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
		await this.ensure_math_skill();
		const LiveId = this.LiveThreads.get(this.Session.Id);
		if(LiveId)
		{
			this.Session.ThreadId = LiveId;
			this.LoadedThread = LiveId;
			return;
		}
		const Options = run_options(this.State.Settings, this.Models);
		const Instructions = this.work_instructions();
		let Existing: any = null;
		if(this.Remote.Enabled && this.Session.ThreadId)
		{
			Existing = await this.Connection!.request("bridge/resume", { threadId: this.Session.ThreadId });
		}
		const Params =
		{
			cwd: this.host_cwd(),
			...(this.Remote.Enabled ? { clientSessionId: this.Session.Id } : {}),
			ephemeral: true,
			dynamicTools: [ObsidianTool],
			approvalPolicy: "on-request",
			approvalsReviewer: "user",
			sandbox: "read-only",
			developerInstructions: Instructions,
			...(Options.model ? { model: Options.model } : {}),
			serviceTier: Options.serviceTier,
			config: { model_reasoning_summary: "auto", ...(Options.effort ? { model_reasoning_effort: Options.effort } : {}) }
		};
		const Result = Existing ?? await this.Connection!.request("thread/start", Params);
		if(Result.thread.ephemeral !== true || Result.thread.path)
		{
			throw new Error("本机 Codex 未返回临时会话. 已停止发送, 请升级支持 ephemeral 的 CLI.");
		}
		this.Session.ThreadId = Result.thread.id;
		this.Session.Private = true;
		this.LoadedThread = Result.thread.id;
		this.LiveThreads.set(this.Session.Id, Result.thread.id);
		if(!Existing)
		{
			this.Session.InstructionsHash = "";
		}
		const History = history_items(this.Session.Messages);
		if(History.length && !Existing)
		{
			await this.Connection!.request("thread/inject_items", { threadId: Result.thread.id, items: History });
		}
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
		if(this.Busy)
		{
			this.Activity = "保存会话";
			this.refresh();
		}
		await this.persist();
	}

	async send_message(Question: string, Context = this.State.Settings.AttachContext ? this.Capture.Snapshot : null, Quote: AnswerQuote | null = null, Task: TaskSpec | null = null): Promise<boolean>
	{
		if(this.Busy || !Question.trim())
		{
			return false;
		}
		this.Busy = true;
		this.TurnId = null;
		this.Activity = "准备会话";
		this.StartedAt = Date.now();
		this.refresh();
		let Submitted = false;
		try
		{
			await this.ensure_thread();
			this.Activity = "检查 math-writing";
			this.refresh();
			const Skill = await this.ensure_math_skill();
			if(this.TurnId)
			{
				this.Status = "已恢复正在运行的回复, 请等待或点击停止";
				this.refresh();
				return false;
			}
			const Instructions = this.work_instructions();
			this.Activity = "准备工作说明";
			this.refresh();
			const InstructionsHash = await instruction_hash(Instructions);
			if(this.Session.InstructionsHash !== InstructionsHash)
			{
				this.Activity = "加载工作说明";
				this.refresh();
				await this.Connection!.request("thread/inject_items", { threadId: this.Session.ThreadId, items: instruction_items(Instructions) });
				this.Session.InstructionsHash = InstructionsHash;
				this.Activity = "保存工作说明";
				this.refresh();
				await this.persist();
			}
			const Prompt = Task ? task_prompt(Task) : build_prompt(Question.trim(), Context, Quote);
			if(Prompt.length > 95000)
			{
				throw new Error("任务超过远程输入上限, 请缩小来源或已确认样章");
			}
			if(Task)
			{
				this.Study?.register_task(Task);
			}
			const PublicTask = Task ? structuredClone(Task) : undefined;
			if(PublicTask?.Target)
			{
				PublicTask.Target.Before = null;
			}
			const Message: ChatMessage = { Id: crypto.randomUUID(), Role: "user", Text: Task ? question_label(Task) : Question.trim(), Context: Context ? structuredClone(Context) : null, Quote: Quote ? structuredClone(Quote) : null, Prompt, Task: PublicTask, ContextLabel: Quote ? "追问选中的回答 / 渲染选区 + 原回答 Markdown" : Context ? `${Context.Path} / ${Context.Kind} / ${Context.Mapping}` : undefined };
			this.Session.Messages.push(Message);
			if(this.Session.Title === "新会话")
			{
				this.Session.Title = Question.trim().slice(0, 24);
			}
			this.Activity = "保存提问";
			this.refresh();
			await this.persist();
			this.Status = "Codex 正在思考...";
			this.Activity = "思考中";
			this.refresh();
			Submitted = true;
			const Options = run_options(this.State.Settings, this.Models);
			const Result = await this.Connection!.request("turn/start", { threadId: this.Session.ThreadId, input: skill_input(Message.Prompt!, Skill), ...Options });
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
			this.refresh();
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
				this.close_connection();
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
		this.close_connection();
		this.CompletionWorker?.close();
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
		this.AnswerQuote = null;
		this.LoadedThread = null;
		this.TurnId = null;
		this.Model = "";
		this.Activity = "";
		this.Status = this.Session.Messages.length ? "历史会话, 发送后继续" : "新会话, 可以提问";
		await this.persist();
		this.refresh();
	}

	async resend_message(Id: string, Text?: string): Promise<boolean>
	{
		if(this.Busy)
		{
			new Notice("请先停止当前回复");
			return false;
		}
		const Original = this.Session;
		const Message = Original.Messages.find(Value => Value.Id === Id && Value.Role === "user");
		if(!Message || !(Text ?? Message.Text).trim())
		{
			return false;
		}
		if(Message.ContextLabel && Message.Context === undefined)
		{
			new Notice("旧版消息没有保存源上下文. 此次重发仅使用原问题, 不附带当前选区.", 7000);
		}
		const Branch = new_session();
		Branch.Title = `${(Text ?? Message.Text).trim().slice(0, 20)} (重发)`;
		Branch.ParentId = Original.Id;
		Branch.Messages = branch_prefix(Original.Messages, Id);
		this.State.Sessions.push(Branch);
		this.State.ActiveId = Branch.Id;
		this.LoadedThread = null;
		this.Busy = true;
		this.Activity = "准备重发";
		this.StartedAt = Date.now();
		this.refresh();
		try
		{
			await this.persist();
			this.Busy = false;
			const OriginalTask = this.Study?.Store.Data.Tasks.find(Value => Value.Spec.Id === Message.Task?.Id)?.Spec ?? Message.Task;
			const Task = OriginalTask ? this.Study?.replay_task(OriginalTask, Text) ?? { ...structuredClone(OriginalTask), Id: crypto.randomUUID(), Request: Text ?? OriginalTask.Request } : null;
			if(Task?.Target && !this.Study?.Store.Data.Tasks.some(Value => Value.Spec.Id === Message.Task?.Id))
			{
				new Notice("本设备没有原写回基线, 保留原任务仅作只读建议");
				delete Task.Target;
			}
			return this.send_message(Text ?? Message.Text, Message.Context ?? null, Message.Quote ?? null, Task);
		}
		catch(ErrorValue)
		{
			this.Busy = false;
			this.Activity = "";
			this.show_error(ErrorValue);
			return false;
		}
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
		if(Message.method === "skills/changed")
		{
			this.MathWritingSkill = null;
			this.SkillStatus = "math-writing 已变更, 下次请求重新检查";
			this.refresh();
			return;
		}
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
				{
					const User = this.Session.Messages.filter(Value => Value.Role === "user").at(-1);
					if(User && !User.TurnId) { User.TurnId = Params.turn.id; }
				}
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
					this.assistant_message(Params.item.id, Params.turnId).Phase = ["commentary", "final_answer"].includes(Params.item.phase) ? Params.item.phase : null;
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
				for(const Reply of this.Session.Messages.filter(Value => Value.Role === "assistant" && Value.TurnId === Params.turn.id))
				{
					Reply.CompletionStatus = Params.turn.status === "completed" ? "completed" : Params.turn.status === "interrupted" ? "interrupted" : "failed";
				}
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
			if(Message.method === "item/tool/call" && Message.params?.tool === "obsidian_cli_read")
			{
				if(Message.params.threadId !== this.Session.ThreadId)
				{
					Connection?.send({ id: Message.id, error: { code: -32602, message: "工具请求不属于当前会话" } });
					return;
				}
				this.Activity = "正在读取 Obsidian CLI";
				this.refresh();
				try
				{
					Result = await run_obsidian_read(this.obsidian_cli(), this.app.vault.getName(), Message.params.arguments);
				}
				catch(ErrorValue)
				{
					Result = { success: false, contentItems: [{ type: "inputText", text: error_text(ErrorValue) }] };
				}
				this.Activity = this.Busy ? "思考中" : "";
				this.refresh();
			}
			else if(Message.method === "item/commandExecution/requestApproval" || Message.method === "item/fileChange/requestApproval")
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
		this.Inline?.clear();
		this.CompletionWorker?.close();
		if(this.CaptureTimer)
		{
			clearTimeout(this.CaptureTimer);
		}
		if(this.StudyVersionTimer) { clearTimeout(this.StudyVersionTimer); }
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
	private StudyPanel: StudyPanel | null = null;
	private StatusElement!: HTMLElement;
	private ContextElement!: HTMLElement;
	private CompletionElement!: HTMLElement;
	private MessagesElement!: HTMLElement;
	private Input!: HTMLTextAreaElement;
	private QuoteElement!: HTMLElement;
	private SelectedAnswer: AnswerQuote | null = null;
	private SendButton!: HTMLButtonElement;
	private StopButton!: HTMLButtonElement;
	private SessionsElement!: HTMLSelectElement;
	private ModelElement!: HTMLSelectElement;
	private EffortElement!: HTMLSelectElement;
	private FastElement!: HTMLInputElement;
	private UsageToggle!: HTMLInputElement;
	private CompletionToggle!: HTMLInputElement;
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
	private EditingId = "";
	private EditingSession = "";
	private EditText = "";

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
		this.SessionsElement = Root.createEl("select", { cls: "codex-sessions" });
		accessible_name(this.SessionsElement, "Codex 会话");
		this.SessionsElement.addEventListener("change", () => void this.Owner.choose_session(this.SessionsElement.value));
		this.StatusElement = Root.createDiv({ cls: "codex-status" });
		const ContextBar = Root.createDiv({ cls: "codex-context-actions" });
		this.button(ContextBar, "捕获当前位置", () => void this.Owner.capture_current());
		this.button(ContextBar, "解释选区", () => void this.Owner.ask_selection(ExplainPrompt));
		this.button(ContextBar, "检查证明", () => void this.Owner.ask_selection(ProofPrompt));
		this.ContextElement = Root.createDiv({ cls: "codex-context" });
		const StudyContainer = Root.createEl("details", { cls: "codex-study-container" });
		StudyContainer.createEl("summary", { text: "数学学习工作台" });
		if(this.Owner.Study)
		{
			this.StudyPanel = new StudyPanel(StudyContainer.createDiv(), {
				App: this.app, Study: this.Owner.Study, busy: () => this.Owner.Busy,
				current: () => this.Owner.Capture.Snapshot,
				capture: async () =>
				{
					this.Owner.Capture.track_view();
					return await this.Owner.Capture.capture("选区") ?? await this.Owner.Capture.capture("当前位置");
				},
				return_source: async Path =>
				{
					await this.app.workspace.openLinkText(Path, "", false);
				}
			});
		}
		this.CompletionElement = Root.createDiv({ cls: "codex-completion-proposal" });
		this.MessagesElement = Root.createDiv({ cls: "codex-messages", attr: { role: "log" } });
		accessible_name(this.MessagesElement, "Codex 对话");
		this.ActivityElement = Root.createDiv({ cls: "codex-activity", attr: { role: "status", "aria-live": "polite" } });
		this.ActivityElement.createSpan({ cls: "codex-spinner", attr: { "aria-hidden": "true" } });
		this.ActivityLabel = this.ActivityElement.createSpan();
		const Composer = Root.createDiv({ cls: "codex-composer" });
		this.QuoteElement = Composer.createDiv({ cls: "codex-answer-quote" });
		const Controls = Composer.createDiv({ cls: "codex-controls" });
		const ModelLabel = Controls.createEl("label");
		ModelLabel.createSpan({ text: "模型" });
		this.ModelElement = ModelLabel.createEl("select");
		const EffortLabel = Controls.createEl("label");
		EffortLabel.createSpan({ text: "思考档次" });
		this.EffortElement = EffortLabel.createEl("select");
		const Toggles = Composer.createDiv({ cls: "codex-run-toggles" });
		const FastLabel = Toggles.createEl("label");
		this.FastElement = FastLabel.createEl("input", { type: "checkbox" });
		FastLabel.createSpan({ text: "Fast" });
		const UsageLabel = Toggles.createEl("label");
		this.UsageToggle = UsageLabel.createEl("input", { type: "checkbox" });
		UsageLabel.createSpan({ text: "上下文占用" });
		const CompletionLabel = Toggles.createEl("label");
		this.CompletionToggle = CompletionLabel.createEl("input", { type: "checkbox" });
		CompletionLabel.createSpan({ text: "行内补全" });
		this.CompletionToggle.addEventListener("change", () => void this.Owner.set_completion(this.CompletionToggle.checked));
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
		this.Input = Composer.createEl("textarea", { attr: { placeholder: "随时提问... Enter 发送, Shift+Enter 换行" } });
		accessible_name(this.Input, "向 Codex 提问");
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
		const CaptureAnswer = () => this.capture_answer_selection();
		this.registerDomEvent(Root.ownerDocument, "selectionchange", CaptureAnswer);
		this.registerDomEvent(this.MessagesElement, "pointerup", CaptureAnswer);
		this.registerDomEvent(this.MessagesElement, "keyup", CaptureAnswer);
		this.refresh();
	}

	private capture_answer_selection(): void
	{
		if(!this.Opened)
		{
			return;
		}
		const SelectionValue = this.contentEl.ownerDocument.defaultView?.getSelection();
		const RangeValue = SelectionValue?.rangeCount ? SelectionValue.getRangeAt(0) : null;
		const NodeValue = RangeValue?.commonAncestorContainer;
		const ElementValue = NodeValue?.nodeType === 1 ? NodeValue as Element : NodeValue?.parentElement;
		const Body = ElementValue?.closest<HTMLElement>(".codex-assistant .codex-message-body");
		const Card = Body?.closest<HTMLElement>(".codex-message");
		const Message = this.Owner.Session.Messages.find(Value => Value.Id === Card?.dataset.messageId && Value.Role === "assistant");
		this.SelectedAnswer = RangeValue && !RangeValue.collapsed && Body && !Body.dataset.studyStructured && this.MessagesElement.contains(Body) && Message && SelectionValue!.toString().trim()
			? answer_quote(this.Owner.Session.Id, Message.Id, SelectionValue!.toString(), Message.Text) : null;
		this.refresh_quote();
		this.StudyPanel?.refresh();
	}

	private refresh_quote(): void
	{
		if(this.Owner.AnswerQuote?.SessionId !== this.Owner.Session.Id)
		{
			this.Owner.AnswerQuote = null;
		}
		if(this.SelectedAnswer?.SessionId !== this.Owner.Session.Id)
		{
			this.SelectedAnswer = null;
		}
		const Quote = this.Owner.AnswerQuote ?? this.SelectedAnswer;
		this.QuoteElement.hidden = !Quote;
		this.Input.placeholder = this.Owner.AnswerQuote ? "针对选中的回答继续提问..." : "随时提问... Enter 发送, Shift+Enter 换行";
		this.QuoteElement.empty();
		if(!Quote)
		{
			return;
		}
		this.QuoteElement.createDiv({ text: this.Owner.AnswerQuote ? "已引用回答片段" : "已选中回答片段", cls: "codex-message-context" });
		this.QuoteElement.createEl("pre", { text: Quote.SelectedText });
		if(!this.Owner.AnswerQuote)
		{
			const Button = this.button(this.QuoteElement, "追问这段", () =>
			{
				this.Owner.AnswerQuote = structuredClone(Quote);
				this.SelectedAnswer = null;
				this.contentEl.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
				this.refresh_quote();
				this.Input.focus();
			});
			Button.addEventListener("pointerdown", Event => Event.preventDefault());
		}
		else
		{
			this.QuoteElement.createDiv({ text: "围绕这段回答追问, 原回答的数学公式一并保留.", cls: "codex-message-context" });
			this.button(this.QuoteElement, "取消引用", () => { this.Owner.AnswerQuote = null; this.refresh_quote(); });
		}
		if(Quote.SelectedTruncated || Quote.SourceTruncated)
		{
			this.QuoteElement.createDiv({ text: "引用已按长度限制截断", cls: "codex-message-context" });
		}
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
		const Selected = selected_model(Settings, this.Owner.Models);
		const ModelOptions = this.Owner.Models.map(Value => ({ Value: Value.model, Label: Value.displayName }));
		if(Settings.Model && !ModelOptions.some(Value => Value.Value === Settings.Model))
		{
			ModelOptions.push({ Value: Settings.Model, Label: `${Settings.Model} (${this.Owner.Models.length ? "当前不可用" : "加载中"})` });
		}
		if(!ModelOptions.length)
		{
			ModelOptions.push({ Value: "", Label: "加载模型..." });
		}
		this.set_options(this.ModelElement, ModelOptions, Settings.Model);
		const EffortOptions = (Selected?.supportedReasoningEfforts ?? []).map(Value => ({ Value: Value.reasoningEffort, Label: Value.reasoningEffort }));
		if(Settings.Effort && !EffortOptions.some(Value => Value.Value === Settings.Effort))
		{
			EffortOptions.push({ Value: Settings.Effort, Label: `${Settings.Effort} (请重新选择)` });
		}
		if(!EffortOptions.length)
		{
			EffortOptions.push({ Value: "", Label: "加载思考档次..." });
		}
		this.set_options(this.EffortElement, EffortOptions, Settings.Effort);
		this.ModelElement.disabled = this.Owner.Busy || !this.Owner.Models.length;
		this.EffortElement.disabled = this.Owner.Busy || !Selected;
		this.FastElement.disabled = this.Owner.Busy || (!fast_tier(Selected) && !Settings.Fast);
		this.FastElement.checked = Settings.Fast;
		this.UsageToggle.checked = Settings.ShowUsage;
		this.CompletionToggle.checked = Settings.Completion;
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
					const Progress = this.UsageElement.createEl("progress", { attr: { max: "100" } });
					accessible_name(Progress, "上下文占用估计");
					Progress.value = Usage.Percent;
				}
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
		const Quote = this.Owner.AnswerQuote;
		const Accepted = await this.Owner.send_message(Text, Quote ? null : this.Owner.State.Settings.AttachContext ? this.Owner.Capture.Snapshot : null, Quote);
		if(Accepted && this.Input.value === Text)
		{
			this.Input.value = "";
			if(this.Owner.AnswerQuote === Quote)
			{
				this.Owner.AnswerQuote = null;
				this.refresh_quote();
			}
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
		this.StatusElement.setText(`${this.Owner.Status}${Effective ? ` | 最近请求: ${Effective}` : ""} | ${this.Owner.SkillStatus}`);
		this.refresh_activity();
		this.refresh_controls();
		this.refresh_completion();
		this.refresh_quote();
		this.StudyPanel?.refresh();
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
		if(this.EditingSession !== this.Owner.Session.Id)
		{
			this.EditingId = "";
		}
		const Signature = this.message_signature();
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
				const Structured = structured_task(Messages, Message);
				Card.dataset.messageId = Message.Id;
				const Header = Card.createDiv({ cls: "codex-message-label" });
				Header.createSpan({ text: Message.Role === "user" ? "你" : Message.Role === "assistant" ? "Codex" : Message.Role === "reasoning" ? "思考摘要" : "状态" });
				if(Message.Role === "assistant")
				{
					this.button(Header, Structured ? "复制原始输出 (可能含答案)" : "复制", () =>
					{
						if(!navigator.clipboard?.writeText)
						{
							new Notice("当前环境无法访问剪贴板, 请选中文字后使用系统复制");
							return;
						}
						void navigator.clipboard.writeText(Message.Text).then(() => { if(Structured) { this.Owner.Study?.reveal_raw(Structured); this.Owner.refresh(); } }).catch(() => new Notice("复制失败, 请使用系统复制"));
					});
				}
				if(Message.Role === "user")
				{
					this.button(Header, "编辑", () =>
					{
						if(this.Owner.Busy)
						{
							return;
						}
						this.EditingId = Message.Id;
						this.EditingSession = this.Owner.Session.Id;
						this.EditText = Message.Text;
						this.refresh();
					}).disabled = this.Owner.Busy;
					this.button(Header, "重新发送", () => void this.Owner.resend_message(Message.Id)).disabled = this.Owner.Busy;
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
				if(Message.Role === "user" && this.EditingId === Message.Id)
				{
					const Editor = Body.createEl("textarea", { cls: "codex-edit-message" });
					accessible_name(Editor, "编辑已发送内容");
					Editor.value = this.EditText;
					Editor.addEventListener("input", () => { this.EditText = Editor.value; });
					const Actions = Body.createDiv({ cls: "codex-edit-actions" });
					this.button(Actions, "保存并重发", () =>
					{
						if(this.Owner.Busy || !this.EditText.trim() || this.EditingSession !== this.Owner.Session.Id)
						{
							return;
						}
						const Text = this.EditText;
						this.EditingId = "";
						void this.Owner.resend_message(Message.Id, Text);
					}).disabled = this.Owner.Busy;
					this.button(Actions, "取消", () => { this.EditingId = ""; this.refresh(); });
					Body.createDiv({ cls: "codex-message-context", text: "将使用原消息上下文创建分支, 原会话保留." });
				}
				else if(Structured)
				{
					Body.dataset.studyStructured = "true";
					Body.createEl("p", { text: Message.CompletionStatus === "completed" ? "工作台任务已回复. 练习、反馈或稿件在上方工作台中查看; 格式未通过时显示具体原因." : "正在生成工作台内容..." });
					const Raw = Body.createEl("details"); Raw.createEl("summary", { text: "查看原始输出 (可能包含全部提示和答案)" });
					Raw.createEl("pre", { text: Message.Text });
					Raw.addEventListener("toggle", () => { if(Raw.open) { this.Owner.Study?.reveal_raw(Structured); this.Owner.refresh(); } });
				}
				else if(Message.Role === "assistant" || Message.Role === "reasoning")
				{
					const WorkTask = Messages.find(Value => Value.Role === "user" && Value.TurnId === Message.TurnId)?.Task;
					if(WorkTask && !safe_math_markdown(Message.Text)) { Body.createEl("pre", { text: Message.Text }); }
					else { await MarkdownRenderer.render(this.app, Message.Text || "...", Body, this.Owner.Capture.LastView?.file?.path ?? "", RenderComponent); }
				}
				else
				{
					Body.setText(Message.Task ? question_label(Message.Task) : Message.Text);
				}
			}
			this.LastRendered = Signature;
			this.MessagesElement.scrollTop = AtBottom ? this.MessagesElement.scrollHeight : OldScroll;
		}
		finally
		{
			this.Rendering = false;
			if(this.Opened && Signature !== this.message_signature())
			{
				this.refresh();
			}
		}
	}

	private refresh_completion(): void
	{
		const Proposal = this.Owner.Inline.get_suggestion();
		const Signature = JSON.stringify(Proposal ? [Proposal.Path, Proposal.Text] : null);
		if(this.CompletionElement.dataset.signature === Signature)
		{
			return;
		}
		this.CompletionElement.dataset.signature = Signature;
		this.CompletionElement.empty();
		this.CompletionElement.hidden = !Proposal;
		if(!Proposal)
		{
			return;
		}
		this.CompletionElement.createEl("strong", { text: "待确认补全" });
		this.CompletionElement.createDiv({ cls: "codex-message-context", text: Proposal.Path });
		this.CompletionElement.createEl("pre", { text: Proposal.Text });
		const Actions = this.CompletionElement.createDiv({ cls: "codex-edit-actions" });
		this.button(Actions, "确认插入", () =>
		{
			if(!this.Owner.Inline.accept(Proposal.View))
			{
				new Notice("建议已失效, 请在笔记中重新请求补全");
			}
			this.refresh();
		}).addClass("mod-cta");
		this.button(Actions, "取消", () => { this.Owner.Inline.dismiss_suggestion(Proposal.View); this.refresh(); });
	}

	async onClose(): Promise<void>
	{
		this.StudyPanel?.close(); this.StudyPanel = null;
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

	private message_signature(): string
	{
		return JSON.stringify([this.Owner.Session.Id, this.Owner.Session.Messages, this.Owner.Busy, this.EditingId]);
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
		new Setting(this.containerEl).setName("独立远程连接").setDesc("iPad 使用独立后台 Codex 进程和会话记录. 桌面本机会话单独保留.").addToggle(Toggle => Toggle.setValue(this.Owner.Remote.Enabled).setDisabled(Platform.isMobileApp).onChange(async Value =>
		{
			try
			{
				await this.Owner.set_remote_mode(Value);
				this.display();
			}
			catch(ErrorValue)
			{
				new Notice(error_text(ErrorValue));
			}
		}));
		let RemoteUrl = this.Owner.Remote.Url;
		let RemoteToken = this.Owner.Remote.Token;
		new Setting(this.containerEl).setName("远程服务地址").setDesc("填写电脑私有 HTTPS 地址. 地址与密钥只保存在此设备, 不写入同步的桌面设置.").addText(Value => Value.setValue(RemoteUrl).setPlaceholder("https://电脑地址:8445").onChange(Text => { RemoteUrl = Text.trim(); }));
		new Setting(this.containerEl).setName("配对密钥").addText(Value =>
		{
			Value.inputEl.type = "password";
			Value.setValue(RemoteToken).onChange(Text => { RemoteToken = Text.trim(); });
		});
		new Setting(this.containerEl).setName("连接独立远程 Agent").addButton(Button => Button.setButtonText("保存并连接").onClick(async () =>
		{
			Button.setDisabled(true).setButtonText("连接中...");
			try
			{
				await this.Owner.configure_remote(RemoteUrl, RemoteToken);
				new Notice("独立远程会话已连接");
				this.display();
			}
			catch(ErrorValue)
			{
				this.Owner.Status = error_text(ErrorValue);
				this.Owner.refresh();
				new Notice(error_text(ErrorValue));
			}
			finally
			{
				Button.setDisabled(false).setButtonText("保存并连接");
			}
		}));
		new Setting(this.containerEl).setName("math-writing 技能").setDesc(`${this.Owner.SkillStatus}. 从${this.Owner.Remote.Enabled ? "Windows 服务端" : "本机"} Codex 的 skills/list 自动发现, 聊天与补全每次通过 skill 输入加载. 技能未安装或被禁用时明确报错; 不更改全局配置.`).addButton(Button => Button.setButtonText("重新检查").onClick(async () =>
		{
			try
			{
				await this.Owner.ensure_connection();
				this.Owner.MathWritingSkill = null;
				await this.Owner.ensure_math_skill();
			}
			catch(ErrorValue)
			{
				new Notice(error_text(ErrorValue));
			}
			this.display();
		}));
		new Setting(this.containerEl).setName("数学内容修改准则").setDesc("题目可判断并标注补充条件; 完整答案最小修补, 需推倒重来时先由你决定; 解题思路严格沿原路线证明; 模仿原稿语言. 固定随请求注入, 自定义工作提示词仍保留.");
		new Setting(this.containerEl).setName("行内补全").setDesc("编辑停顿后显示灰色建议. 在侧栏确认插入, Esc 取消, Ctrl+Alt+Space 手动请求. 保留 Obsidian 原生 Tab. 自动请求会消耗 Codex 用量, 使用当前模型的 low 档次.").addToggle(Toggle => Toggle.setValue(this.Owner.State.Settings.Completion).onChange(Value => this.Owner.set_completion(Value)));
		new Setting(this.containerEl).setName("补全等待时间 (毫秒)").setDesc("默认 1200, 最小 500. 继续输入或移动光标会取消旧请求.").addText(TextValue => TextValue.setValue(String(this.Owner.State.Settings.CompletionDelay)).onChange(async Value =>
		{
			const Delay = Number(Value);
			if(Number.isFinite(Delay) && Delay >= 500 && Delay <= 30000)
			{
				this.Owner.State.Settings.CompletionDelay = Math.round(Delay);
				await this.Owner.persist();
			}
		}));
		if(!this.Owner.Remote.Enabled)
		{
			new Setting(this.containerEl).setName("Obsidian CLI 路径").setDesc("默认检测当前 Obsidian 安装的 Obsidian.com, 将实际路径和 vault 注入工作提示词. 也可填写自定义路径.").addText(TextValue => TextValue.setValue(this.Owner.State.Settings.ObsidianCliPath).onChange(async Value =>
			{
				this.Owner.State.Settings.ObsidianCliPath = Value.trim();
				await this.Owner.persist();
			}));
			new Setting(this.containerEl).setName("Codex 可执行文件").setDesc("留空时从 PATH 查找 codex.exe. 使用本机 Codex 登录.").addText(TextValue => TextValue
				.setValue(this.Owner.State.Settings.CliPath).setPlaceholder("C:\\...\\codex.exe").onChange(async Value =>
				{
					this.Owner.State.Settings.CliPath = Value.trim();
					await this.Owner.persist();
				}));
		}
		new Setting(this.containerEl).setName("模型与思考档次").setDesc("在侧栏直接选择. 选择状态自动保存, 收起后重开或重载插件都会恢复上次选择.");
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
