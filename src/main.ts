import {
	Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Notice,
	MarkdownRenderer, MarkdownView, Component, FileSystemAdapter, Modal, editorInfoField, Platform, requestUrl, parseYaml, type App
} from "obsidian";
import { ContextCapture } from "./context";
import { build_prompt, DefaultInstructions, client_instructions, migrate_instructions, instruction_items, type ContextSnapshot, type AnswerQuote } from "./prompt";
import { answer_quote, answer_status } from "./quote";
import { followup_summary } from "./followup";
import { branch_prefix, history_items, type ChatMessage } from "./history";
import type { CompletionService, CompletionInput } from "./completion";
import { InlineCompletions } from "./inline";
import { sidebar_panel, reveal_sidebar_panel, type SidebarPanel } from "./sidebar-layout";
import { observe_sidebar_footer } from "./sidebar-footer";
import { ObsidianTool, run_obsidian_read } from "./obsidian-tool";
import type { RpcMessage } from "./rpc";
import { RemoteConnection, remote_url, type RemoteConfig, type RpcConnection } from "./remote";
import { browser_http } from "./browser-http";
import { native_http } from "./native-http";
import { math_writing_skill, skill_input, type SkillInput } from "./skills";
import { selected_model, initial_selection, fast_tier, run_options, context_usage, type ModelInfo } from "./controls";
import { ObsidianWriteHost } from "./edit/obsidian-host";
import { task_prompt, type TaskSpec } from "./edit/task";
import { structured_task, question_label } from "./edit/presentation";
import { safe_math_markdown } from "./edit/safe-markdown";
import { BrowserPdfImages, type PdfImages } from "./pdf/image-store";
import { image_inputs, message_pdf_refs, history_pdf_refs } from "./pdf/inputs";
import { pdf_reference, jpeg_info, type PdfImageRef } from "./pdf/types";
import { PdfPageModal, pdf_preview, PdfInstructions } from "./pdf/panel";
import { ChatEdits } from "./edit/controller";
import { open_edit_store } from "./edit/database";
import { type EditRole, type EditScope } from "./edit/protocol";
import { render_edit, export_edits } from "./edit/panel";
import { edit_scope, EditScopeOptions } from "./edit/options";
import { ComposerActions, type ComposeAction } from "./edit/composer";
import { MessageList, type MessageNode } from "./message-list";
import { SelectionPreview, selection_in_source } from "./selection-preview";
import { NoteSessions, note_file_path } from "./note-sessions";
import { new_session, prune_sessions, restore_sessions, delete_session_plan, type ChatSession, type SessionState } from "./sessions";
import { DeleteSessionDialog } from "./session-dialog";
import type { CacheContext } from "./edit/cache";

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
	EditScope: EditScope;
}

interface SavedState extends SessionState
{
	Settings: SidebarSettings;
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
	Edits: ChatEdits | null = null;
	ChatPreparing = false;
	State!: SavedState;
	Capture!: ContextCapture;
	PdfImages!: PdfImages;
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
	private HostInfo: { cwd: string; vault: string; cli: string; client: string; mathWritingVersion?: string; pdfPageImages?: number } | null = null;
	private Connecting: Promise<void> | null = null;
	private LoadingSkill: Promise<SkillInput> | null = null;
	private LoadedThread: string | null = null;
	private Generation = 0;
	private Unloaded = false;
	private CompletedTurns = new Set<string>();
	private ApprovalItems = new Map<string, unknown>();
	private SaveQueue: Promise<void> = Promise.resolve();
	private SessionDeletion: Promise<void> | null = null;
	private CaptureTimer: ReturnType<typeof setTimeout> | null = null;
	private Modals = new Set<Modal>();
	private BoundDocuments = new Set<Document>();
	private CompletionWorker: CompletionService | null = null;
	Inline!: InlineCompletions;
	private CompletionStatus!: HTMLElement;
	private LiveThreads = new Map<string, string>();
	NoteSessions: NoteSessions | null = null;
	NoteSessionError = "";

	get Session(): ChatSession
	{
		return this.State.Sessions.find(Value => Value.Id === this.State.ActiveId)!;
	}
	get SessionDeleting(): boolean { return !!this.SessionDeletion; }

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
		this.State = prune_sessions({
			Settings: { CliPath: "", Model: "", Effort: "", Fast: false, ShowUsage: true, Instructions: DefaultInstructions, AttachContext: true, AutoCapture: true, Completion: true, CompletionDelay: 1200, ObsidianCliPath: "", ...Saved?.Settings, EditScope: edit_scope(Saved?.Settings?.EditScope) },
			Sessions,
			ActiveId: Sessions.some(Value => Value.Id === Saved?.ActiveId) ? Saved!.ActiveId! : Sessions[0].Id,
			...(Saved?.DeletedSessionIds !== undefined ? { DeletedSessionIds: Saved.DeletedSessionIds } : {})
		});
		this.State.Settings.Instructions = migrate_instructions(this.State.Settings.Instructions);
		if(!this.State.Settings.Model)
		{
			this.State.Settings.Model = this.Session.EffectiveModel ?? "";
			this.State.Settings.Effort ||= this.Session.EffectiveEffort ?? "";
		}
		this.CompletionStatus = this.addStatusBarItem();
		this.CompletionStatus.setText(this.State.Settings.Completion ? "Codex 补全已开启" : "Codex 补全已关闭");
		this.Inline = new InlineCompletions({
			Enabled: () => this.State.Settings.Completion && !this.Unloaded,
			Delay: () => Math.max(500, this.State.Settings.CompletionDelay),
			Path: View => View.state.field(editorInfoField, false)?.file?.path ?? null,
			Request: (Input, Signal) => this.request_completion(Input, Signal),
			Status: Text => this.CompletionStatus.setText(Text),
			Changed: () => this.refresh()
		});
		this.registerEditorExtension(this.Inline.Extension);
		this.PdfImages = new BrowserPdfImages(this.app.vault.getName());
		this.Capture = new ContextCapture(this.app, this.PdfImages);
		try
		{
			const Host = new ObsidianWriteHost(this.app);
			this.Edits = new ChatEdits(await open_edit_store(localStorage, this.app.vault.getName()), {
				read_current: Path => Host.read_current(Path), compare_write: (Path, Before, After) => Host.compare_write(Path, Before, After),
				protected_source: Task => this.protected_edit(Task), send: Task => this.send_message(Task.Request, Task.Source, null, Task), changed: () => this.refresh(), cache_context: Key => this.edit_cache_context(Key)
			});
		}
		catch(ErrorValue) { this.Status = error_text(ErrorValue); }
		this.configure_note_sessions();
		this.registerView(ViewType, Leaf => new CodexView(Leaf, this));
		this.Ribbon = this.addRibbonIcon("bot", "Codex 聊天 (打开/收起)", () => void this.toggle_sidebar());
		this.Ribbon.addClass("codex-sidebar-ribbon");
		this.addCommand({ id: "toggle", name: "打开/收起聊天栏", callback: () => void this.toggle_sidebar() });
		this.addCommand({ id: "explain-selection", name: "解释选区", callback: () => void this.ask_selection(ExplainPrompt) });
		this.addCommand({ id: "check-proof", name: "检查选区证明", callback: () => void this.ask_selection(ProofPrompt) });
		this.addCommand({ id: "capture-reading", name: "捕获当前阅读位置", callback: () => void this.capture_current() });
		this.addCommand({ id: "capture-pdf-page", name: "捕获 PDF 页", callback: () => this.open_pdf() });
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
			this.observe_note_file(); this.refresh();
		}));
		this.registerEvent(this.app.workspace.on("file-open", () => this.observe_note_file()));
		this.registerEvent(this.app.vault.on("rename", (File, Old) =>
		{
			try { this.NoteSessions?.rename(Old, File.path); this.observe_note_file(); } catch(ErrorValue) { this.NoteSessionError = error_text(ErrorValue); this.refresh(); }
		}));
		this.registerEvent(this.app.vault.on("delete", File =>
		{
			try { this.NoteSessions?.forget(File.path); } catch(ErrorValue) { this.NoteSessionError = error_text(ErrorValue); this.refresh(); }
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
			this.observe_note_file();
			this.bind_document(document);
			if(this.Capture.LastView)
			{
				this.bind_document(this.Capture.LastView.containerEl.ownerDocument);
				if(this.Capture.LastView instanceof MarkdownView && this.Capture.LastView.getMode() === "preview")
				{
					this.Capture.LastView.previewMode.rerender(true);
				}
			}
		});
	}

	private configure_note_sessions(): void
	{
		this.NoteSessions?.dispose(); this.NoteSessions = null; this.NoteSessionError = "";
		try
		{
			this.NoteSessions = new NoteSessions(localStorage, this.app.vault.getName(), this.Remote.Enabled ? `remote:${this.Remote.CacheId}` : "desktop", {
				active: () => this.State.ActiveId, exists: Id => this.State.Sessions.some(Value => Value.Id === Id), blocked: () => this.note_switch_blocked(), changed: () => this.refresh(),
				activate: async (Id, Path) =>
				{
					if(this.note_switch_blocked()) { throw new Error("当前会话尚未空闲, 未自动切换"); }
					if(!this.State.Sessions.some(Value => Value.Id === Id)) { this.State.Sessions.push({ ...new_session(), Id, Title: Path.split("/").at(-1)!.replace(/\.(md|pdf)$/i, "") }); }
					await this.choose_session(Id, true);
					if(this.CaptureTimer) { clearTimeout(this.CaptureTimer); this.CaptureTimer = null; }
					this.Capture.clear(); this.Capture.track_view();
					const View = this.Capture.LastView;
					if(this.State.Settings.AutoCapture && note_file_path(View) === Path) { await this.Capture.capture("选区", View) ?? await this.Capture.capture("当前位置", View); }
				}
			});
		}
		catch(ErrorValue) { this.NoteSessionError = error_text(ErrorValue); }
	}
	private note_switch_blocked(): string
	{
		if(this.SessionDeleting) { return "正在删除会话"; }
		if(this.Unloaded) { return "插件已关闭"; }
		if(this.Busy || this.ChatPreparing) { return "正在回复, 完成后切换"; }
		if(this.Edits?.Writer.is_busy()) { return "正在写回或撤销"; }
		if(this.AnswerQuote) { return "有回答引用, 发送或取消后切换"; }
		if(this.app.workspace.getLeavesOfType(ViewType).some(Leaf => Leaf.view instanceof CodexView && Leaf.view.has_pending_input())) { return "有草稿或正在编辑消息, 发送/清空或取消后切换"; }
		return "";
	}
	observe_note_file(): void { this.NoteSessions?.observe(note_file_path(this.app.workspace.activeLeaf?.view)); }
	async set_note_sessions(Enabled: boolean): Promise<void>
	{
		if(!this.NoteSessions) { throw new Error(this.NoteSessionError || "笔记会话关联不可用"); }
		this.NoteSessionError = "";
		this.NoteSessions.set_enabled(Enabled); this.observe_note_file(); await this.NoteSessions.flush(); this.refresh();
	}
	bind_note_session(): void
	{
		if(this.Busy || this.ChatPreparing || this.NoteSessions?.Switching) { throw new Error("请等待当前操作完成后绑定"); }
		if(!this.NoteSessions) { throw new Error(this.NoteSessionError || "笔记会话关联不可用"); }
		this.NoteSessions.bind_current(); this.NoteSessionError = ""; this.refresh();
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
		return client_instructions(this.State.Settings.Instructions, this.Remote.Enabled ? null : {
			Vault: this.app.vault.getName(), Root: this.host_cwd(),
			Cli: this.obsidian_cli()
		}, PdfInstructions);
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
			const Timeout = Operation === "bridge/completion" ? 120000 : 30000;
			const Response = Platform.isMobileApp
				? this.Remote.Transport === "native"
					? await native_http(Params, Value => requestUrl({ ...Value, throw: false }), Timeout)
					: await browser_http({ ...Params, timeout: Timeout })
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
		if(Signal.aborted || this.Unloaded)
		{
			throw new Error("补全已取消");
		}
		await this.ensure_connection();
		const Skill = await this.ensure_math_skill();
		if(Signal.aborted || this.Unloaded)
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
		this.registerDomEvent(DocumentValue, "selectionchange", () => { if(selection_in_source(this.Capture.LastView?.containerEl, DocumentValue)) { this.queue_capture(); } });
		this.registerDomEvent(DocumentValue, "pointerup", EventValue => { if(selection_in_source(this.Capture.LastView?.containerEl, DocumentValue, EventValue.target)) { this.queue_capture(); } });
		this.registerDomEvent(DocumentValue, "keyup", EventValue => { if(selection_in_source(this.Capture.LastView?.containerEl, DocumentValue, EventValue.target)) { this.queue_capture(); } });
	}

	private queue_capture(): void
	{
		if(!this.State.Settings.AutoCapture || this.Capture.Suspended || this.NoteSessions?.Pending || this.NoteSessions?.Switching)
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
			if(this.NoteSessions?.Pending || this.NoteSessions?.Switching) { return; }
			if(this.Capture.PdfPending) { this.queue_capture(); return; }
			void this.Capture.capture("选区").then(Snapshot =>
			{
				if(Snapshot && !this.Unloaded)
				{
					this.refresh();
				}
			}).catch(() => {});
		}, 150);
	}
	clear_context(): void
	{
		if(this.CaptureTimer) { clearTimeout(this.CaptureTimer); this.CaptureTimer = null; }
		this.Capture.clear(); this.refresh();
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

	private edit_cache_context(Key?: string): CacheContext | null
	{
		const Device = this.Remote.Enabled ? this.Remote.CacheId : "desktop";
		let Id = this.State.ActiveId;
		if(Key)
		{
			try { const Parts = JSON.parse(Key); if(!Array.isArray(Parts) || Parts.length !== 2 || Parts[0] !== Device) { return null; } Id = Parts[1]; } catch { return null; }
		}
		const Session = this.State.Sessions.find(S => S.Id === Id);
		return Session ? { Key: JSON.stringify([Device, Id]), Turns: [...new Set(Session.Messages.filter(M => M.Role !== "reasoning" && M.TurnId && M.CompletionStatus === "completed").map(M => M.TurnId!))] } : null;
	}

	refresh(): void
	{
		if(this.Unloaded)
		{
			return;
		}
		this.Edits?.consume(this.Session.Messages);
		this.Edits?.Cache.poll();
		this.Ribbon?.toggleClass("is-active", this.app.workspace.getLeavesOfType(ViewType).length > 0);
		for(const Leaf of this.app.workspace.getLeavesOfType(ViewType))
		{
			if(Leaf.view instanceof CodexView)
			{
				Leaf.view.refresh();
			}
		}
		void this.NoteSessions?.flush();
	}

	persist(SyncRemote = true): Promise<void>
	{
		if(this.SessionDeletion) { return this.SessionDeletion.then(() => this.persist(SyncRemote)); }
		return this.persist_snapshot(this.State, SyncRemote);
	}
	private persist_snapshot(State: SavedState, SyncRemote: boolean): Promise<void>
	{
		const Data = JSON.parse(JSON.stringify(State));
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

	private persist_background(): void
	{
		const Generation = this.Generation;
		void this.persist().catch(ErrorValue =>
		{
			if(!this.Unloaded && Generation === this.Generation) { this.Status = error_text(ErrorValue); this.refresh(); }
		});
	}

	async set_remote_mode(Enabled: boolean): Promise<void>
	{
		if(this.Busy || this.SessionDeleting || this.NoteSessions?.Switching)
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
		this.State = prune_sessions(Saved?.Sessions?.length ? Saved : { Settings: { ...this.State.Settings }, Sessions: [new_session()], ActiveId: "" });
		this.State.Settings.EditScope = edit_scope(this.State.Settings.EditScope);
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
		this.configure_note_sessions(); this.observe_note_file();
		this.Status = this.Remote.Enabled ? "独立远程会话, 连接后使用" : "本机桌面会话";
		this.refresh();
		await this.persist();
	}

	async configure_remote(Url: string, Token: string, Transport = this.Remote.Transport ?? "browser"): Promise<void>
	{
		if(Transport !== "browser" && Transport !== "native") { throw new Error("未知网络传输方式"); }
		remote_url(Url);
		if(this.Busy || this.SessionDeleting)
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
		this.Remote.Transport = Transport;
		this.save_remote_config();
		await this.set_remote_mode(true);
		await this.ensure_thread();
		this.Busy = !!this.TurnId;
		this.refresh();
	}

	async update_run_settings(Model: string, Effort: string, Fast: boolean): Promise<void>
	{
		if(this.Busy || this.SessionDeleting)
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
						this.persist_background();
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
					const PreviousScope = this.State.Settings.EditScope;
					this.State = restore_sessions(this.State, Restored.state, this.NoteSessions?.Data.Enabled ? this.NoteSessions.Data.Links.map(Link => Link.SessionId) : [], !this.NoteSessions?.Manual);
					this.State.Settings.EditScope = edit_scope(PreviousScope);
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
		const History = !Existing ? history_items(this.Session.Messages, await this.prepare_pdf(history_pdf_refs(this.Session.Messages))) : [];
		const Result = Existing ?? await this.Connection!.request("thread/start", Params);
		if(Result.thread.ephemeral !== true || Result.thread.path)
		{
			throw new Error("本机 Codex 未返回临时会话. 已停止发送, 请升级支持 ephemeral 的 CLI.");
		}
		this.Session.ThreadId = Result.thread.id;
		this.Session.Private = true;
		this.LoadedThread = Result.thread.id;
		if(!Existing)
		{
			this.Session.InstructionsHash = "";
		}
		if(History.length && !Existing)
		{
			await this.Connection!.request("thread/inject_items", { threadId: Result.thread.id, items: History });
		}
		this.LiveThreads.set(this.Session.Id, Result.thread.id);
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

	private async prepare_pdf(Refs: PdfImageRef[]): Promise<Map<string, string>>
	{
		const Urls = new Map<string, string>();
		if(!Refs.length) { return Urls; }
		const Model = selected_model(this.State.Settings, this.Models);
		if(Model?.inputModalities && !Model.inputModalities.includes("image")) { throw new Error("当前模型不支持图像, 请明确选择支持图片的模型再提问 PDF"); }
		this.Activity = "准备 PDF 页图快照"; this.refresh();
		let Remote: { present: string[]; epoch: string } | null = null;
		if(this.Remote.Enabled)
		{
			if(this.HostInfo?.pdfPageImages !== 1) { throw new Error("Windows 远程桥尚不支持 PDF 页图, 请更新桥到 0.8.0 后重连; 本轮未提交"); }
			Remote = await this.Connection!.request("bridge/pdf-images", { action: "has", ids: Refs.map(Ref => Ref.Id) });
		}
		for(const Ref of Refs)
		{
			if(!Remote?.present.includes(Ref.Id))
			{
				const Data = await this.PdfImages.get(Ref.Id);
				const Info = jpeg_info(Data);
				if(Info.Width !== Ref.Width || Info.Height !== Ref.Height || Info.Bytes !== Ref.Bytes) { throw new Error("PDF 页图与保存快照不一致"); }
				if(Remote) { await this.Connection!.request("bridge/pdf-images", { action: "put", id: Ref.Id, data: Data, epoch: Remote.epoch }); }
				else { Urls.set(Ref.Id, Data); }
			}
			if(Remote) { Urls.set(Ref.Id, pdf_reference(Ref.Id)); }
		}
		return Urls;
	}

	private protected_edit(Task: TaskSpec): boolean
	{
		const Path = Task.Target?.Path;
		if(!Path || !Task.Target?.Range || Task.Target.Before === null) { return true; }
		const File = this.app.vault.getFileByPath?.(Path);
		const Frontmatter = File ? this.app.metadataCache?.getFileCache(File)?.frontmatter : null;
		if(Frontmatter?.["codex-readonly"] === true || ["source-excerpt", "teacher-problem", "源书摘录", "教师原题"].includes(Frontmatter?.["study-role"] ?? Frontmatter?.role ?? Frontmatter?.note_type)) { return true; }
		const Yaml = Task.Target.Before.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
		if(Yaml)
		{
			try
			{
				const Value = parseYaml(Yaml[1]);
				if(Value?.["codex-readonly"] === true || ["source-excerpt", "teacher-problem", "源书摘录", "教师原题"].includes(Value?.["study-role"] ?? Value?.role ?? Value?.note_type)) { return true; }
			}
			catch { return true; }
		}
		return false;
	}

	async send_chat(Question: string, Context: ContextSnapshot | null, Quote: AnswerQuote | null, Options: { Mode?: ComposeAction; Scope?: EditScope; Role?: EditRole } = {}): Promise<boolean>
	{
		if(this.Busy || this.ChatPreparing || this.SessionDeleting || this.Capture.Suspended || this.NoteSessions?.Switching) { return false; }
		const Edit = Options.Mode === "edit";
		if(!Edit) { return this.send_message(Question, Context, Quote); }
		this.ChatPreparing = true; this.StartedAt = Date.now(); this.Activity = "准备修改目标"; this.refresh();
		try
		{
			if(!Question.trim()) { throw new Error("请写明修改要求"); }
			if(!this.Edits) { throw new Error("本设备修改记录不可用, 请先导出检查, 不会覆盖旧数据"); }
			if(Quote) { throw new Error("当前引用的是助手回答, 请取消引用并捕获要修改的笔记"); }
			if(!this.State.Settings.AttachContext) { throw new Error("修改需要附带目标原文, 请打开附带上下文并捕获笔记"); }
			if(!Context)
			{
				this.Capture.track_view(); Context = await this.Capture.capture("选区") ?? await this.Capture.capture("当前位置");
			}
			if(!Context) { throw new Error("请先打开 Markdown 并捕获需要修改的选区或段落"); }
			return await this.Edits.request(Question.trim(), Context, Options.Scope ?? edit_scope(this.State.Settings.EditScope), Options.Role ?? "auto");
		}
		catch(ErrorValue) { this.show_error(ErrorValue); return false; }
		finally { this.ChatPreparing = false; if(!this.Busy) { this.Activity = ""; } this.refresh(); }
	}

	async send_message(Question: string, Context = this.State.Settings.AttachContext ? this.Capture.Snapshot : null, Quote: AnswerQuote | null = null, Task: TaskSpec | null = null): Promise<boolean>
	{
		if(Task && Task.Action !== "edit")
		{
			new Notice("旧版学习任务仅保留历史记录. 请通过提问或生成修改预览发起新请求.");
			return false;
		}
		if(this.Unloaded || this.Busy || this.SessionDeleting || this.NoteSessions?.Switching || (this.ChatPreparing && Task?.Action !== "edit") || this.Capture.Suspended || !Question.trim())
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
				throw new Error("任务超过远程输入上限, 请缩小来源或修改范围");
			}
			if(Task?.Action === "edit") { await this.Edits?.register(Task); }
			const PublicTask = Task ? structuredClone(Task) : undefined;
			if(PublicTask?.Target)
			{
				PublicTask.Target.Before = null;
			}
			const Message: ChatMessage = { Id: crypto.randomUUID(), Role: "user", Text: Task ? question_label(Task) : Question.trim(), Context: Context ? structuredClone(Context) : null, Quote: Quote ? structuredClone(Quote) : null, Prompt, Task: PublicTask, ContextLabel: Quote ? "追问选中的回答 / 渲染选区 + 原回答 Markdown" : Context ? `${Context.Path} / ${Context.Kind} / ${Context.Mapping}` : undefined };
			const Refs = message_pdf_refs(Message);
			if(Refs.length > 2) { throw new Error("每轮最多两张 PDF 页图, 请减少来源后明确重试"); }
			const Images = image_inputs(Refs, await this.prepare_pdf(Refs));
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
			const Result = await this.Connection!.request("turn/start", { threadId: this.Session.ThreadId, input: [...skill_input(Message.Prompt!, Skill), ...Images], ...Options });
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
		if(this.Busy || this.ChatPreparing || this.SessionDeleting)
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

	open_delete_session(): void
	{
		const Reason = this.note_switch_blocked() || (this.NoteSessions?.Switching ? "正在切换笔记会话" : this.Connecting ? "正在连接, 完成后删除" : "");
		if(Reason) { new Notice(Reason); return; }
		const Dialog = new DeleteSessionDialog(this.app, this.Session, (Id, Stamp) => this.delete_session(Id, Stamp), () => this.Modals.delete(Dialog));
		this.Modals.add(Dialog); Dialog.open();
	}
	async delete_session(Id: string, Stamp: string): Promise<void>
	{
		const Reason = this.note_switch_blocked() || (this.NoteSessions?.Switching ? "正在切换笔记会话" : this.Connecting ? "正在连接, 完成后删除" : "");
		if(Reason) { throw new Error(Reason); }
		const Work = Promise.resolve().then(async () =>
		{
			const Notes = this.NoteSessions, Link = Notes?.Data.Links.find(Value => Value.Path === Notes.Path);
			const Fresh = this.State.ActiveId === Id && Notes?.Data.Enabled && Link?.SessionId === Id;
			const Plan = delete_session_plan(this.State, Id, Stamp, Fresh ? Notes!.Path!.split("/").at(-1)!.replace(/\.(md|pdf)$/i, "") : undefined, Link?.SessionId);
			await this.persist_snapshot(Plan.State, false);
			this.State = Plan.State;
			if(this.Unloaded) { return; }
			this.LiveThreads.delete(Id); this.LoadedThread = null; this.TurnId = null; this.Model = ""; this.Activity = "";
			let Warning = "";
			try { Notes?.forget_session(Id, Fresh ? Plan.ReplacementId : undefined, Fresh ? Link?.Path : undefined); }
			catch(ErrorValue) { Warning = "会话已删除, 笔记关联清理未完成: " + error_text(ErrorValue); }
			for(const Leaf of this.app.workspace.getLeavesOfType(ViewType)) { if(Leaf.view instanceof CodexView) { Leaf.view.forget_session(Id); } }
			if(this.Connection instanceof RemoteConnection)
			{
				try { await this.Connection.sync_state(JSON.parse(JSON.stringify(this.State))); }
				catch { Warning = "本机已删除会话, 远程同步尚未完成; 重连会保留本机删除标记, 不恢复旧会话"; }
			}
			new Notice(Warning || (Fresh ? "会话已删除, 当前笔记已切换到新的空会话" : "会话已删除"));
		});
		this.SessionDeletion = Work.finally(() => { this.SessionDeletion = null; this.refresh(); });
		this.refresh();
		return this.SessionDeletion;
	}

	async choose_session(Id?: string, Automatic = false): Promise<void>
	{
		if(this.Busy || this.ChatPreparing || this.SessionDeleting || (!Automatic && this.NoteSessions?.Switching))
		{
			new Notice("请先停止当前回复");
			return;
		}
		if(Id)
		{
			if(!this.State.Sessions.some(Value => Value.Id === Id)) { throw new Error("选择的会话已不存在"); }
			this.State.ActiveId = Id;
		}
		else
		{
			const Session = new_session();
			this.State.Sessions.push(Session);
			this.State.ActiveId = Session.Id;
		}
		if(!Automatic)
		{
			this.NoteSessions?.manual();
			if(!Id && this.NoteSessions?.Data.Enabled && this.NoteSessions.Path) { try { this.NoteSessions.bind_current(); } catch(ErrorValue) { this.NoteSessionError = error_text(ErrorValue); } }
		}
		this.AnswerQuote = null;
		this.LoadedThread = null;
		this.TurnId = null;
		this.Model = "";
		this.Activity = "";
		this.Status = this.Session.Messages.length ? "历史会话, 发送后继续" : "新会话, 可以提问";
		await this.persist(!Automatic);
		this.refresh();
	}

	async resend_message(Id: string, Text?: string): Promise<boolean>
	{
		if(this.Busy || this.ChatPreparing || this.SessionDeleting)
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
		if(Message.Task && Message.Task.Action !== "edit")
		{
			new Notice("旧版学习任务仅保留历史记录. 请通过提问或生成修改预览发起新请求.");
			return false;
		}
		let EditReplay: TaskSpec | null = null;
		try
		{
			if(Message.Task?.Action === "edit")
			{
				if(!this.Edits) { throw new Error("本设备修改记录不可用"); }
				EditReplay = this.Edits.replay(Message.Task, Text);
			}
		}
		catch(ErrorValue) { this.show_error(ErrorValue); return false; }
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
		this.NoteSessions?.manual();
		this.LoadedThread = null;
		this.Busy = true;
		this.Activity = "准备重发";
		this.StartedAt = Date.now();
		this.refresh();
		try
		{
			await this.persist();
			this.Busy = false;
			return this.send_message(Text ?? Message.Text, Message.Context ?? null, Message.Quote ?? null, EditReplay);
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
		try
		{
			this.Capture.track_view();
			const Snapshot = await this.Capture.capture("当前位置");
			if(!Snapshot)
			{
				new Notice("请先打开 Markdown 或 PDF. 无法定位 PDF 页时可点击“选择 PDF 页”");
				return;
			}
			this.State.Settings.AttachContext = true;
			this.refresh();
			await this.persist();
		}
		catch(ErrorValue) { this.show_error(ErrorValue); }
	}

	open_pdf(): void
	{
		new PdfPageModal(this.app, this.Capture, async () =>
		{
			this.State.Settings.AttachContext = true; this.refresh(); await this.persist(); await this.open_sidebar();
		}).open();
	}

	async clear_pdf_images(): Promise<void>
	{
		if(this.Busy || this.Capture.PdfPending || this.Capture.Suspended) { throw new Error("请等待当前提问或 PDF 捕获结束后清除"); }
		if(this.CaptureTimer) { clearTimeout(this.CaptureTimer); this.CaptureTimer = null; }
		this.Capture.Suspended = true;
		try
		{
			if(this.Remote.Enabled)
			{
				await this.ensure_connection();
				if(this.HostInfo?.pdfPageImages === 1) { await this.Connection!.request("bridge/pdf-images", { action: "clear" }); }
			}
			await this.PdfImages.clear();
			this.Status = "PDF 页图缓存已清除, 聊天与学习记录保留; 原页图缺失的请求不能换图重发"; this.refresh();
		}
		finally { this.Capture.Suspended = false; }
	}

	async ask_selection(Prompt: string): Promise<void>
	{
		try
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
		catch(ErrorValue) { this.show_error(ErrorValue); }
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
				this.persist_background();
				break;
			case "thread/settings/updated":
				this.Model = Params.threadSettings.model;
				this.Session.EffectiveModel = Params.threadSettings.model;
				this.Session.EffectiveEffort = Params.threadSettings.effort;
				this.Session.EffectiveTier = Params.threadSettings.serviceTier ?? "default";
				this.persist_background();
				break;
			case "thread/compacted":
				this.Session.InstructionsHash = "";
				this.persist_background();
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
				this.persist_background();
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
				for(const Reply of this.Session.Messages.filter(Value => Value.Role !== "reasoning" && Value.TurnId === Params.turn.id))
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
				this.persist_background();
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
		void this.Edits?.Store.close();
		this.NoteSessions?.dispose();
		this.Generation++;
		this.Inline?.clear();
		this.CompletionWorker?.close();
		this.Capture?.close();
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
	private NoteSessionBind!: HTMLButtonElement;
	private NavigationSummary: HTMLElement | null = null;
	private ComposePanel: SidebarPanel | null = null;
	private ContextSummary: HTMLElement | null = null;
	private OptionsSummary: HTMLElement | null = null;
	private StatusElement!: HTMLElement;
	private ContextElement!: HTMLElement;
	private ContextKey = "";
	private SelectionPreview!: SelectionPreview;
	private CompletionElement!: HTMLElement;
	private MessagesElement!: HTMLElement;
	private Input!: HTMLTextAreaElement;
	private QuoteElement!: HTMLElement;
	private SelectedAnswer: AnswerQuote | null = null;
	private ComposeActions!: ComposerActions;
	private SessionsElement!: HTMLSelectElement;
	private DeleteSessionButton!: HTMLButtonElement;
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
	private MessageList: MessageList | null = null;
	private RenderTimer: ReturnType<typeof setTimeout> | null = null;
	private LastRendered = "";
	private Rendering = false;
	private Opened = false;
	private ReleaseFooter: (() => void) | null = null;
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
		this.ReleaseFooter?.();
		this.ReleaseFooter = observe_sidebar_footer(Root);
		const Mobile = Platform.isMobile || Root.ownerDocument.body.classList.contains("is-mobile");
		const Panel = (Parent: HTMLElement, ClassName: string, Label: string) => sidebar_panel(Parent, ClassName, Label, Mobile, { Storage: localStorage, Key: `codex-sidebar-folds:v1:${this.app.vault.getName()}:${ClassName}` });
		const Toolbar = Root.createDiv({ cls: "codex-toolbar" });
		const Navigation = Panel(Toolbar, "codex-navigation", "会话与连接");
		this.NavigationSummary = Navigation.Summary;
		const Header = Navigation.Body.createDiv({ cls: "codex-header" });
		Header.createEl("strong", { text: "Codex" });
		this.button(Header, "新会话", () => void this.Owner.choose_session());
		this.button(Header, "重连", () => void this.Owner.reconnect());
		const SessionRow = Navigation.Body.createDiv({ cls: "codex-session-row" });
		this.SessionsElement = SessionRow.createEl("select", { cls: "codex-sessions" });
		accessible_name(this.SessionsElement, "Codex 会话");
		this.SessionsElement.addEventListener("change", () => void this.Owner.choose_session(this.SessionsElement.value));
		this.DeleteSessionButton = this.button(SessionRow, "删除会话", () => this.Owner.open_delete_session());
		this.DeleteSessionButton.addClass("codex-session-delete");
		this.NoteSessionBind = this.button(Navigation.Body, "将当前会话绑定此笔记", () =>
		{
			try { this.Owner.bind_note_session(); } catch(ErrorValue) { this.Owner.NoteSessionError = error_text(ErrorValue); this.Owner.refresh(); new Notice(error_text(ErrorValue)); }
		});
		this.StatusElement = Root.createDiv({ cls: "codex-status" });
		this.SelectionPreview = new SelectionPreview(Root, () => this.Owner.clear_context());
		const ContextPanel = Panel(Toolbar, "codex-context-tools", "上下文");
		this.ContextSummary = ContextPanel.Summary;
		const ContextBar = ContextPanel.Body.createDiv({ cls: "codex-context-actions" });
		this.button(ContextBar, "捕获当前位置", () => void this.Owner.capture_current());
		this.button(ContextBar, "选择 PDF 页", () => this.Owner.open_pdf());
		this.button(ContextBar, "解释选区", () => void this.Owner.ask_selection(ExplainPrompt));
		this.button(ContextBar, "检查证明", () => void this.Owner.ask_selection(ProofPrompt));
		this.ContextElement = ContextPanel.Body.createDiv({ cls: "codex-context" });
		this.CompletionElement = Root.createDiv({ cls: "codex-completion-proposal" });
		this.MessagesElement = Root.createDiv({ cls: "codex-messages", attr: { role: "log" } });
		accessible_name(this.MessagesElement, "Codex 对话");
		this.ActivityElement = Root.createDiv({ cls: "codex-activity", attr: { role: "status", "aria-live": "polite" } });
		this.ActivityElement.createSpan({ cls: "codex-spinner", attr: { "aria-hidden": "true" } });
		this.ActivityLabel = this.ActivityElement.createSpan();
		const Composer = Root.createDiv({ cls: "codex-composer" });
		this.QuoteElement = Composer.createDiv({ cls: "codex-answer-quote" });
		const OptionsPanel = Panel(Toolbar, "codex-options", "模型与选项");
		this.OptionsSummary = OptionsPanel.Summary;
		const Controls = OptionsPanel.Body.createDiv({ cls: "codex-controls" });
		const ModelLabel = Controls.createEl("label");
		ModelLabel.createSpan({ text: "模型" });
		this.ModelElement = ModelLabel.createEl("select");
		const EffortLabel = Controls.createEl("label");
		EffortLabel.createSpan({ text: "思考档次" });
		this.EffortElement = EffortLabel.createEl("select");
		const Toggles = OptionsPanel.Body.createDiv({ cls: "codex-run-toggles" });
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
		this.UsageElement = OptionsPanel.Body.createDiv({ cls: "codex-usage" });
		this.ComposePanel = Panel(Composer, "codex-send-tools", "提问与发送");
		this.Input = this.ComposePanel.Body.createEl("textarea", { attr: { placeholder: "随时提问... Enter 提问, Shift+Enter 换行" } });
		accessible_name(this.Input, "向 Codex 提问");
		this.Input.addEventListener("input", () => { this.refresh_compose_summary(); void this.Owner.NoteSessions?.flush(); });
		const Actions = this.ComposePanel.Body.createDiv({ cls: "codex-compose-actions" });
		this.ComposeActions = new ComposerActions(Actions, this.Input, Mode => void this.send_input(Mode), () => void this.Owner.stop_turn());
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
		this.SelectedAnswer = RangeValue && !RangeValue.collapsed && Body && !Body.dataset.editStructured && this.MessagesElement.contains(Body) && Message && SelectionValue!.toString().trim()
			? answer_quote(this.Owner.Session.Id, Message.Id, SelectionValue!.toString(), Message.Text, answer_status(Message, this.Owner.TurnId, this.Owner.Busy)) : null;
		this.refresh_quote();
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
		this.ComposeActions?.refresh(this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || !!this.Owner.NoteSessions?.Switching, this.Owner.Busy && !!this.Owner.TurnId, !!this.Owner.AnswerQuote);
		this.refresh_compose_summary();
		this.QuoteElement.hidden = !Quote;
		this.Input.placeholder = this.Owner.AnswerQuote ? "针对选中的回答继续提问... Enter 提问, Shift+Enter 换行" : "随时提问... Enter 提问, Shift+Enter 换行";
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
				reveal_sidebar_panel(this.ComposePanel);
				this.Input.focus();
			});
			Button.addEventListener("pointerdown", Event => Event.preventDefault());
		}
		else
		{
			this.QuoteElement.createDiv({ text: followup_summary(Quote), cls: "codex-message-context" });
			this.button(this.QuoteElement, "取消引用", () => { this.Owner.AnswerQuote = null; this.refresh_quote(); void this.Owner.NoteSessions?.flush(); });
		}
		if(Quote.SelectedTruncated || Quote.SourceTruncated)
		{
			this.QuoteElement.createDiv({ text: "引用已按长度限制截断", cls: "codex-message-context" });
		}
	}

	private refresh_compose_summary(): void
	{
		this.ComposePanel?.Summary?.setText(this.Input.value.trim() ? "提问与发送 · 有草稿" : this.Owner.AnswerQuote ? "提问与发送 · 已引用" : "提问与发送");
	}

	private refresh_activity(): void
	{
		this.ActivityElement.hidden = !this.Owner.Busy && !this.Owner.ChatPreparing;
		if(this.Owner.Busy || this.Owner.ChatPreparing)
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
		this.OptionsSummary?.setText(`模型与选项 · ${[Settings.Model || "加载中", Settings.Effort, Settings.Fast ? "Fast" : ""].filter(Boolean).join(" / ")}`);
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
		this.ModelElement.disabled = this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || !this.Owner.Models.length;
		this.EffortElement.disabled = this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || !Selected;
		this.FastElement.disabled = this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || (!fast_tier(Selected) && !Settings.Fast);
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

	private async send_input(Mode: ComposeAction): Promise<void>
	{
		const Text = this.Input.value;
		const Quote = this.Owner.AnswerQuote;
		const Accepted = await this.Owner.send_chat(Text, Quote ? null : this.Owner.State.Settings.AttachContext ? this.Owner.Capture.Snapshot : null, Quote, { Mode, Scope: edit_scope(this.Owner.State.Settings.EditScope), Role: "auto" });
		if(Accepted && this.Input.value === Text)
		{
			this.Input.value = "";
			if(this.Owner.AnswerQuote === Quote)
			{
				this.Owner.AnswerQuote = null;
				this.refresh_quote();
			}
		}
		void this.Owner.NoteSessions?.flush();
	}
	has_pending_input(): boolean { return !!this.Input?.value.trim() || !!this.EditingId; }

	refresh(): void
	{
		if(!this.Opened || !this.StatusElement)
		{
			return;
		}
		const Session = this.Owner.Session;
		this.NavigationSummary?.setText(`会话与连接 · ${Session.Title}`);
		const Effective = [Session.EffectiveModel, Session.EffectiveEffort, Session.EffectiveTier === "priority" || Session.EffectiveTier === "fast" ? "Fast" : ""].filter(Boolean).join(" / ");
		this.StatusElement.setText(`${this.Owner.Status}${Effective ? ` | 最近请求: ${Effective}` : ""} | ${this.Owner.SkillStatus}`);
		const Notes = this.Owner.NoteSessions;
		this.NoteSessionBind.disabled = !Notes?.Path || this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || !!Notes?.Switching;
		if(this.DeleteSessionButton) { this.DeleteSessionButton.disabled = this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || !!Notes?.Switching; }
		this.refresh_activity();
		this.refresh_controls();
		this.refresh_completion();
		this.refresh_quote();
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
		this.SessionsElement.disabled = this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || !!Notes?.Switching;
		const Snapshot = this.Owner.Capture.Snapshot;
		this.SelectionPreview.update(Snapshot, this.Owner.State.Settings.AttachContext);
		this.refresh_compose_summary();
		this.ContextSummary?.setText(Snapshot ? `上下文 · ${Snapshot.Kind}${Snapshot.Truncated ? " (已截断)" : ""}` : "上下文");
		const ContextKey = JSON.stringify(Snapshot);
		if(ContextKey !== this.ContextKey)
		{
			this.ContextKey = ContextKey; this.ContextElement.empty();
			if(Snapshot)
			{
				const Label = this.ContextElement.createEl("label", { cls: "codex-context-label" });
				const Checkbox = Label.createEl("input", { type: "checkbox" });
				Checkbox.checked = this.Owner.State.Settings.AttachContext;
				Checkbox.addEventListener("change", () =>
				{
					this.Owner.State.Settings.AttachContext = Checkbox.checked;
					this.SelectionPreview.update(this.Owner.Capture.Snapshot, Checkbox.checked);
					void this.Owner.persist();
				});
				Label.createSpan({ text: `附带 ${Snapshot.Kind} (${Snapshot.Mode}, ${Snapshot.Mapping})` });
				const Details = this.ContextElement.createEl("details");
				Details.createEl("summary", { text: `${Snapshot.Path}${Snapshot.LineStart !== null ? `:${Snapshot.LineStart + 1}` : ""}` });
				Details.createDiv({ text: Snapshot.Heading || "未定位标题", cls: "codex-context-heading" });
				Details.createEl("pre", { text: Snapshot.Text });
				pdf_preview(Details, Snapshot, this.Owner.PdfImages);
				if(Snapshot.Truncated)
				{
					Details.createDiv({ text: "内容已截断到上下文长度限制" });
				}
				this.button(this.ContextElement, "清除上下文", () =>
				{
					this.Owner.clear_context();
				});
			}
			else
			{
				this.ContextElement.setText("在笔记中选中文字, 或捕获当前阅读位置");
			}
		}
		const ContextCheckbox = this.ContextElement.querySelector<HTMLInputElement>(".codex-context-label input");
		if(ContextCheckbox) { ContextCheckbox.checked = this.Owner.State.Settings.AttachContext; }

		if(!this.RenderTimer)
		{
			this.RenderTimer = setTimeout(() =>
			{
				this.RenderTimer = null;
				void this.render_messages();
			}, 100);
		}
		void this.Owner.NoteSessions?.flush();
	}

	forget_session(Id: string): void
	{
		this.Version++; this.LastRendered = "";
		if(this.SelectedAnswer?.SessionId === Id) { this.SelectedAnswer = null; }
		if(this.EditingSession === Id) { this.EditingSession = ""; this.EditingId = ""; this.EditText = ""; }
		this.MessageList?.forget(JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", Id]));
	}
	private async render_messages(): Promise<void>
	{
		if(this.Rendering || !this.Opened) { return; }
		const Session = this.Owner.Session, Messages = Session.Messages.map(Message => ({ ...Message }));
		const SourcePath = this.Owner.Capture.LastView?.file?.path ?? "";
		const Context = JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", Session.Id]);
		if(this.EditingSession !== Session.Id) { this.EditingId = ""; }
		const Signature = this.message_signature();
		if(Signature === this.LastRendered && this.MessageList) { return; }
		this.Rendering = true;
		const Version = ++this.Version;
		this.MessageList ??= new MessageList(this.MessagesElement);
		try
		{
			const Items = Messages.map(Message =>
			{
				const Task = structured_task(Messages, Message), Record = Task?.Action === "edit" ? this.Owner.Edits?.Store.Data.Records.find(Value => Value.Spec.Id === Task.Id) : null;
				const EditState = Task?.Action === "edit" ? [this.Owner.Edits?.Error, this.Owner.Edits?.ErrorTaskId, Record?.Status, Record?.Error, this.Owner.Edits?.Store.Data.Writes.filter(Value => Value.TaskId === Task.Id).map(Value => [Value.Id, Value.State, Value.Error])] : null;
				return { Id: Message.Id, Key: JSON.stringify([Message, SourcePath, Message.Role === "user" ? [this.Owner.Busy, this.EditingId === Message.Id] : null, EditState]), Render: () => this.render_card(Message, Messages) };
			});
			if(!Items.length)
			{
				Items.push({ Id: "welcome", Key: "welcome", Render: async () =>
				{
					const Element = this.MessagesElement.ownerDocument.createElement("div"); Element.className = "codex-welcome";
					Element.textContent = "可以直接提问, 或选中笔记内容后点击解释选区 / 检查证明. 阅读模式会附带原始 Markdown 源块.";
					return { Element, Dispose: () => {} };
				} });
			}
			if(await this.MessageList.update(Context, Items, () => this.Opened && Version === this.Version && this.Owner.Session.Id === Session.Id && SourcePath === (this.Owner.Capture.LastView?.file?.path ?? "") && Context === JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", this.Owner.Session.Id]))) { this.LastRendered = Signature; }
			else if(this.Opened) { this.refresh(); }
		}
		finally
		{
			this.Rendering = false;
			if(this.Opened && Signature !== this.message_signature()) { this.refresh(); }
		}
	}

	private async render_card(Message: ChatMessage, Messages: ChatMessage[]): Promise<MessageNode>
	{
		const RenderComponent = new Component(); RenderComponent.load();
		try
		{
			const Card = this.MessagesElement.ownerDocument.createElement("div");
			Card.className = `codex-message codex-${Message.Role}`;
			const Structured = structured_task(Messages, Message);
			Card.dataset.messageId = Message.Id;
			const Header = Card.createDiv({ cls: "codex-message-label" });
			Header.createSpan({ text: Message.Role === "user" ? "你" : Message.Role === "assistant" ? "Codex" : Message.Role === "reasoning" ? "思考摘要" : "状态" });
			if(Message.Role === "assistant")
			{
				this.button(Header, "复制", () =>
				{
					if(!navigator.clipboard?.writeText)
					{
						new Notice("当前环境无法访问剪贴板, 请选中文字后使用系统复制");
						return;
					}
					void navigator.clipboard.writeText(Message.Text).catch(() => new Notice("复制失败, 请使用系统复制"));
				});
			}
			if(Message.Role === "user" && (!Message.Task || Message.Task.Action === "edit"))
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
			else if(Structured?.Action === "edit")
			{
				await render_edit(this.app, Body, this.Owner.Edits, Structured, RenderComponent, () => this.Owner.refresh(), () => this.Owner.Edits!.retry_result(Structured.Id, this.Owner.Session.Messages));
				const Raw = Body.createEl("details"); Raw.createEl("summary", { text: "查看原始修改输出" }); Raw.createEl("pre", { text: Message.Text });
			}
			else if(Message.Role === "assistant" || Message.Role === "reasoning")
			{
				const WorkTask = Messages.find(Value => Value.Role === "user" && Value.TurnId === Message.TurnId)?.Task;
				if(WorkTask && (WorkTask.Action !== "edit" || !safe_math_markdown(Message.Text))) { Body.createEl("pre", { text: Message.Text }); }
				else { await MarkdownRenderer.render(this.app, Message.Text || "...", Body, this.Owner.Capture.LastView?.file?.path ?? "", RenderComponent); }
			}
			else
			{
				Body.setText(Message.Task ? question_label(Message.Task) : Message.Text);
			}
			return { Element: Card, Dispose: () => RenderComponent.unload() };
		}
		catch(ErrorValue) { RenderComponent.unload(); throw ErrorValue; }
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
		this.ReleaseFooter?.(); this.ReleaseFooter = null;
		this.Opened = false;
		this.Version++;
		if(this.RenderTimer)
		{
			clearTimeout(this.RenderTimer);
			this.RenderTimer = null;
		}
		if(this.ActivityTimer)
		{
			clearInterval(this.ActivityTimer);
			this.ActivityTimer = null;
		}
		this.MessageList?.dispose(); this.MessageList = null; this.ContextKey = "";
		this.Owner.refresh();
	}

	private message_signature(): string
	{
		return JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", this.Owner.Capture.LastView?.file?.path ?? "", this.Owner.Session.Id, this.Owner.Session.Messages, this.Owner.Busy, this.EditingId, this.Owner.Edits?.Error, this.Owner.Edits?.ErrorTaskId, this.Owner.Edits?.Store.Data.Records.map(Value => [Value.Spec.Id, Value.Status, Value.Error]), this.Owner.Edits?.Store.Data.Writes.map(Value => [Value.Id, Value.State, Value.Error])]);
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
		const Notes = this.Owner.NoteSessions;
		const NoteError = this.Owner.NoteSessionError || Notes?.Error;
		new Setting(this.containerEl).setName("随笔记切换会话").setDesc(NoteError || "打开 Markdown 笔记或 PDF 时切换到对应会话. 已有会话和关联保留; 有草稿或正在回复时等待当前操作结束.")
			.addToggle(Toggle => Toggle.setValue(!!Notes?.Data.Enabled).setDisabled(!Notes).onChange(async Value =>
			{
				try { await this.Owner.set_note_sessions(Value); }
				catch(ErrorValue) { this.Owner.NoteSessionError = error_text(ErrorValue); new Notice(error_text(ErrorValue)); }
				this.display();
			}));
		new Setting(this.containerEl).setName("修改范围").setDesc("用于新发起的“生成修改预览”. 原文类型由 AI 辨识; 已发送任务重发时保留原范围. 采用修改前仍需确认差异.")
			.addDropdown(Dropdown =>
			{
				for(const [Value, Label] of EditScopeOptions) { Dropdown.addOption(Value, Label); }
				Dropdown.setValue(edit_scope(this.Owner.State.Settings.EditScope)).onChange(async Value =>
				{
					this.Owner.State.Settings.EditScope = edit_scope(Value);
					await this.Owner.persist();
				});
			});
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
		let RemoteTransport = this.Owner.Remote.Transport ?? "browser";
		new Setting(this.containerEl).setName("远程服务地址").setDesc("填写电脑私有 HTTPS 地址. 地址与密钥只保存在此设备, 不写入同步的桌面设置.").addText(Value => Value.setValue(RemoteUrl).setPlaceholder("https://电脑地址:8445").onChange(Text => { RemoteUrl = Text.trim(); }));
		new Setting(this.containerEl).setName("配对密钥").addText(Value =>
		{
			Value.inputEl.type = "password";
			Value.setValue(RemoteToken).onChange(Text => { RemoteToken = Text.trim(); });
		});
		if(Platform.isMobileApp)
		{
			new Setting(this.containerEl).setName("移动网络传输").setDesc("浏览器请求超时时可手动切换原生请求, 绕过网页 CORS 预检. 两种方式都不自动重发; 原生请求超时后可能仍在服务端进行.").addDropdown(Value => Value.addOption("browser", "浏览器 Fetch").addOption("native", "Obsidian 原生请求").setValue(RemoteTransport).onChange(Text => { RemoteTransport = Text as "browser" | "native"; }));
		}
		new Setting(this.containerEl).setName("连接独立远程 Agent").addButton(Button => Button.setButtonText("保存并连接").onClick(async () =>
		{
			Button.setDisabled(true).setButtonText("连接中...");
			try
			{
				await this.Owner.configure_remote(RemoteUrl, RemoteToken, RemoteTransport);
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
		new Setting(this.containerEl).setName("修改与还原缓存保留轮数").setDesc("默认 1. 修改预览生成后, 或采用/安全还原后重新计时, 在同一会话后续完成 N 轮对话时清理对应预览和还原数据. 输入 1-1000 或“永不”. 未采用预览也会到期; 聊天和笔记保留, 旧记录不追溯清理. " + (this.Owner.Edits?.Cache.Error ?? "")).addText(Value => Value.setValue(this.Owner.Edits?.Cache.Turns === 0 ? "永不" : String(this.Owner.Edits?.Cache.Turns ?? 1)).setPlaceholder("1 或 永不").onChange(async Text =>
		{
			const Input = Text.trim(), Turns = ["永不", "never", "0"].includes(Input.toLowerCase()) ? 0 : /^\d+$/.test(Input) ? Number(Input) : NaN;
			if(!Number.isSafeInteger(Turns) || Turns < 0 || Turns > 1000) { Value.inputEl.setCustomValidity?.("输入 1-1000 或 永不"); return; }
			Value.inputEl.setCustomValidity?.("");
			try { await this.Owner.Edits?.Cache.set_turns(Turns); } catch(ErrorValue) { new Notice(error_text(ErrorValue)); }
		}));
		let ConfirmEdits = false;
		new Setting(this.containerEl).setName("本设备修改记录").setDesc("普通聊天的修改提案、原文基线与撤销记录仅存本设备, 不随远程聊天覆盖. 导出含原文, 请自行保管. 清除后不能采用或安全撤销旧提案, 不会改动笔记.")
			.addButton(Button => Button.setButtonText("导出记录").onClick(() => { if(this.Owner.Edits) { export_edits(this.app, this.Owner.Edits.Store.export_records()); } }))
			.addButton(Button => Button.setButtonText("清除记录...").onClick(async () =>
			{
				if(!ConfirmEdits) { ConfirmEdits = true; Button.setButtonText("确认清除此设备记录"); return; }
				try { await this.Owner.Edits?.clear(); this.Owner.refresh(); new Notice("本设备修改记录已清除, 笔记未改动"); }
				catch(ErrorValue) { new Notice(error_text(ErrorValue)); }
				this.display();
			}));
		let ConfirmClear = false;
		new Setting(this.containerEl).setName("PDF 页图缓存").setDesc("页图在当前设备单独保存, 远程桥按配对设备隔离. 清除会保留聊天和修改记录, 但缺少原图的请求不能重发. 不会删除 PDF 或撤回模型已收到的图片.").addButton(Button => Button.setButtonText("清除页图缓存...").onClick(async () =>
		{
			if(!ConfirmClear) { ConfirmClear = true; Button.setButtonText("确认清除本设备页图"); return; }
			Button.setDisabled(true);
			try { await this.Owner.clear_pdf_images(); new Notice(this.Owner.Status); }
			catch(ErrorValue) { new Notice(error_text(ErrorValue)); }
			finally { this.display(); }
		}));
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
