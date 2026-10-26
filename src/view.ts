import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, Component, Platform } from "obsidian";
import type { SidebarOwner } from "./view-owner";
import type { AnswerQuote } from "./prompt";
import { answer_quote, answer_status, bind_answer_blocks, quote_blocks } from "./quote";
import { followup_summary } from "./followup";
import type { ChatMessage } from "./history";
import { sidebar_panel, reveal_sidebar_panel, type SidebarPanel } from "./sidebar-layout";
import { observe_sidebar_footer } from "./sidebar-footer";
import { selected_model, fast_tier, context_usage } from "./controls";
import { structured_task, question_label } from "./edit/presentation";
import { safe_math_markdown } from "./edit/safe-markdown";
import { pdf_preview } from "./pdf/panel";
import { render_edit } from "./edit/panel";
import { edit_scope } from "./edit/options";
import { ComposerActions, type ComposeAction } from "./edit/composer";
import { MessageList, type MessageNode } from "./message-list";
import { SelectionPreview, selection_in_source } from "./selection-preview";
import { accessible_name, error_text } from "./ui-helpers";
import { HistoryWindow } from "./history-window";
import { answer_sources, source_path, source_key, render_sources } from "./sources";
import { followup_index, history_source_index, operation_label } from "./history-view-state";
import { render_sync_conflicts } from "./conflict-view";
import { ComposerDraftStore, type ComposerMaterial } from "./composer-draft";

const ViewType = "codex-sidebar-view";
const ExplainPrompt = "请解释选中的内容. 说明符号、所需前置知识和关键推导, 保留原来的数学符号, 用中文回答.";
const ProofPrompt = "请检查选中的证明或推导. 逐项核对假设、量词、适用定理和每个非平凡步骤, 指出具体缺口与最小修正. 不擅自重写原证明, 用中文回答.";

export class CodexView extends ItemView
{
	private NoteSessionBind!: HTMLButtonElement;
	private ConflictsElement!: HTMLElement;
	private ConflictsKey = "";
	private DraftStore: ComposerDraftStore | null = null;
	private DraftRevision = 0;
	private DraftMaterial: ComposerMaterial = { Context: null, Quote: null };
	private DraftRestore = false;
	private DraftError = "";
	private DraftBlocked = false;
	private DraftStatus!: HTMLElement;
	private DraftStatusKey = "";
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
	private HistoryWindow = new HistoryWindow();
	private RenderTimer: ReturnType<typeof setTimeout> | null = null;
	private LastRendered = "";
	private Rendering = false;
	private Opened = false;
	private ReleaseFooter: (() => void) | null = null;
	private Version = 0;
	private EditingId = "";
	private EditingSession = "";
	private EditText = "";

	constructor(Leaf: WorkspaceLeaf, private Owner: SidebarOwner)
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
		const PreviousText = this.Input?.value ?? "", PreviousKey = this.DraftStore?.Key;
		if(this.Opened) { this.save_draft(); }
		this.DraftStore = null; this.DraftRevision = 0; this.DraftStatusKey = "";
		this.Opened = true;
		const Root = this.contentEl;
		Root.empty();
		this.ConflictsKey = "";
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
		this.ConflictsElement = Navigation.Body.createDiv({ cls: "codex-sync-conflicts" });
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
		if(PreviousText && PreviousKey === this.draft_key()) { this.Input.value = PreviousText; }
		accessible_name(this.Input, "向 Codex 提问");
		this.DraftStatus = this.ComposePanel.Body.createDiv({ cls: "codex-draft-state", attr: { role: "status" } });
		this.Input.addEventListener("input", () => { this.save_draft(); this.refresh_compose_summary(); this.refresh_draft_status(); void this.Owner.NoteSessions?.flush(); });
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
		const Previous = Message?.TurnId ? this.Owner.Session.Messages.find(M => M.Role === "user" && M.TurnId === Message.TurnId)?.Quote : null;
		this.SelectedAnswer = RangeValue && !RangeValue.collapsed && Body && !Body.dataset.editStructured && this.MessagesElement.contains(Body) && Message && SelectionValue!.toString().trim()
			? answer_quote(this.Owner.Session.Id, Message.Id, SelectionValue!.toString(), Message.Text, answer_status(Message, this.Owner.TurnId, this.Owner.Busy), { ...quote_blocks(Body, RangeValue, Message.Text), SourcePath: source_path(this.Owner.Session.Messages, Message), RootMessageId: Previous?.RootMessageId ?? Previous?.MessageId ?? Message.Id, ...(Previous ? { ParentMessageId: Previous.MessageId } : {}), SourceReferences: answer_sources(this.Owner.Session.Messages, Message) }) : null;
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
		const CanStop = (this.Owner as SidebarOwner & { CanStop?: boolean }).CanStop ?? (this.Owner.Busy && !!this.Owner.TurnId);
		this.ComposeActions?.refresh(this.input_blocked(), CanStop, !!this.Owner.AnswerQuote);
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
		this.button(this.QuoteElement, "返回被引用回答", () => void this.reveal_message(Quote.MessageId));
		if(!this.Owner.AnswerQuote)
		{
			const Button = this.button(this.QuoteElement, "追问这段", () =>
			{
				this.Owner.AnswerQuote = structuredClone(Quote);
				this.SelectedAnswer = null;
				this.contentEl.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
				this.refresh_quote();
				this.save_draft(); this.refresh_draft_status();
				reveal_sidebar_panel(this.ComposePanel);
				this.Input.focus();
			});
			Button.addEventListener("pointerdown", Event => Event.preventDefault());
		}
		else
		{
			this.QuoteElement.createDiv({ text: followup_summary(Quote), cls: "codex-message-context" });
			this.button(this.QuoteElement, "取消引用", () => { this.Owner.AnswerQuote = null; this.refresh_quote(); this.save_draft(); this.refresh_draft_status(); void this.Owner.NoteSessions?.flush(); });
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
		const Stage = this.Owner.RuntimeState?.Stage, Active = this.Owner.Busy || this.Owner.ChatPreparing || (!!Stage && !["idle", "offline"].includes(Stage));
		this.ActivityElement.hidden = !Active;
		if(Active)
		{
			const Seconds = this.Owner.StartedAt ? Math.max(0, Math.floor((Date.now() - this.Owner.StartedAt) / 1000)) : null;
			const Label = ({ connecting: "正在连接", preparing: "准备请求", "submission-unknown": "提交结果待核对", generating: "正在生成", stopping: "正在停止", recovering: "正在恢复" } as Record<string, string>)[Stage ?? ""];
			this.ActivityLabel.setText(`${this.Owner.Activity || Label || "思考中"}${Seconds !== null ? " · " + Seconds + " 秒" : ""}`);
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
		this.ModelElement.disabled = this.input_blocked() || !this.Owner.Models.length;
		this.EffortElement.disabled = this.input_blocked() || !Selected;
		this.FastElement.disabled = this.input_blocked() || (!fast_tier(Selected) && !Settings.Fast);
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
	private input_blocked(): boolean
	{
		const Stage = this.Owner.RuntimeState?.Stage;
		return this.Owner.Busy || this.Owner.ChatPreparing || this.Owner.SessionDeleting || !!this.Owner.NoteSessions?.Switching || (!!Stage && !["idle", "offline"].includes(Stage));
	}
	private draft_scope(): string
	{
		return this.Owner.draft_scope?.() ?? JSON.stringify([this.app?.vault?.getName?.() ?? "legacy", this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop"]);
	}
	private draft_key(): string
	{
		return new ComposerDraftStore(localStorage, this.draft_scope(), this.Owner.Session.Id).Key;
	}
	private current_material(): ComposerMaterial
	{
		const Quote = this.Owner.AnswerQuote?.SessionId === this.Owner.Session.Id ? this.Owner.AnswerQuote : null;
		return { Context: !Quote && this.Owner.State.Settings.AttachContext ? this.Owner.Capture.Snapshot : null, Quote };
	}
	private sync_draft(): void
	{
		if(!this.Input) { return; }
		try
		{
			const Next = new ComposerDraftStore(localStorage, this.draft_scope(), this.Owner.Session.Id);
			if(this.DraftStore?.Key === Next.Key)
			{
				if(!this.DraftRestore && !this.DraftError)
				{
					const Current = this.current_material(), Changed = Current.Context !== this.DraftMaterial.Context || Current.Quote !== this.DraftMaterial.Quote;
					this.DraftMaterial = Current;
					if(Changed && (this.Input.value || Current.Quote)) { this.save_draft(); }
				}
				return;
			}
			if(this.DraftStore && !this.save_draft()) { return; }
			const Draft = Next.load(), Existing = this.Input.value, First = !this.DraftStore;
			this.DraftStore = Next; this.DraftRevision = Draft?.Revision ?? 0; this.DraftError = ""; this.DraftRestore = false; this.DraftBlocked = false;
			this.DraftMaterial = Draft ? { Context: Draft.Context, Quote: Draft.Quote } : this.current_material();
			if(First && Existing && Draft && Existing !== Draft.Text)
			{
				this.DraftError = "当前输入与已保存草稿不同, 已保留当前输入; 请先复制内容后重新打开核对";
				this.DraftBlocked = true;
				return;
			}
			this.Input.value = First && Existing ? Existing : Draft?.Text ?? "";
			if(Draft && (Draft.Text || Draft.Quote))
			{
				const Current = this.current_material();
				if(!Current.Context && !Current.Quote && !Existing)
				{
					this.Owner.Capture.Snapshot = structuredClone(Draft.Context); this.Owner.AnswerQuote = structuredClone(Draft.Quote);
					if(Draft.Context) { this.Owner.State.Settings.AttachContext = true; }
				}
				else { this.DraftRestore = JSON.stringify(Current) !== JSON.stringify(this.DraftMaterial); }
			}
		}
		catch(ErrorValue) { this.DraftError = error_text(ErrorValue); }
	}
	private save_draft(UseCurrent = false): boolean
	{
		if(this.DraftBlocked) { return false; }
		if(!this.Input || !this.DraftStore) { return !this.DraftError; }
		try
		{
			const Matches = this.DraftStore.Key === this.draft_key();
			if(UseCurrent && !Matches) { throw Error("输入仍属于上一会话, 草稿未安全切换; 请先复制输入并处理保存错误"); }
			if(Matches && (UseCurrent || !this.DraftRestore)) { this.DraftMaterial = this.current_material(); }
			const Saved = this.DraftStore.save(this.Input.value, this.DraftMaterial, this.DraftRevision);
			this.DraftRevision = Saved?.Revision ?? 0; this.DraftError = "";
			if(UseCurrent) { this.DraftRestore = false; }
			return true;
		}
		catch(ErrorValue) { this.DraftError = error_text(ErrorValue); return false; }
	}
	private refresh_draft_status(): void
	{
		if(!this.DraftStatus) { return; }
		const Key = JSON.stringify([this.DraftStore?.Key, this.DraftError, this.DraftRestore, this.DraftMaterial, this.input_blocked()]);
		if(Key === this.DraftStatusKey) { return; }
		this.DraftStatusKey = Key; this.DraftStatus.empty(); this.DraftStatus.hidden = !this.DraftError && !this.DraftRestore;
		if(this.DraftError) { this.DraftStatus.createDiv({ text: "草稿未保存: " + this.DraftError }); }
		if(this.DraftRestore)
		{
			this.DraftStatus.createDiv({ text: "已恢复输入; 草稿原来源/引用与当前位置不同, 发送将使用当前可见来源" });
			const Details = this.DraftStatus.createEl("details"); Details.createEl("summary", { text: "查看草稿原来源/引用" });
			Details.createEl("pre", { text: this.DraftMaterial.Quote?.SelectedText ?? this.DraftMaterial.Context?.Path ?? "原草稿未附来源" });
			const Restore = this.button(this.DraftStatus, "恢复草稿来源/引用", () =>
			{
				if(this.input_blocked() || this.DraftStore?.Key !== this.draft_key()) { return; }
				this.Owner.Capture.Snapshot = structuredClone(this.DraftMaterial.Context); this.Owner.AnswerQuote = structuredClone(this.DraftMaterial.Quote);
				if(this.DraftMaterial.Context) { this.Owner.State.Settings.AttachContext = true; }
				this.DraftRestore = false; this.save_draft(); this.refresh();
			});
			Restore.disabled = this.input_blocked();
		}
	}

	private async send_input(Mode: ComposeAction): Promise<void>
	{
		this.sync_draft();
		if(!this.save_draft(true)) { this.refresh_draft_status(); return; }
		const Text = this.Input.value;
		const Quote = this.Owner.AnswerQuote;
		const Identity = this.DraftStore?.Key;
		const Accepted = await this.Owner.send_chat(Text, Quote ? null : this.Owner.State.Settings.AttachContext ? this.Owner.Capture.Snapshot : null, Quote, { Mode, Scope: edit_scope(this.Owner.State.Settings.EditScope), Role: "auto" });
		if(Accepted && this.Input.value === Text && this.DraftStore?.Key === Identity && this.DraftStore?.Scope === this.draft_scope() && this.DraftStore?.SessionId === this.Owner.Session.Id)
		{
			this.Input.value = "";
			if(this.Owner.AnswerQuote === Quote)
			{
				this.Owner.AnswerQuote = null;
				this.refresh_quote();
			}
			this.DraftRestore = false; this.DraftMaterial = { Context: null, Quote: null }; this.save_draft();
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
		this.sync_draft(); this.refresh_draft_status();
		const Conflicts = [...new Map([...(this.Owner.State.Sync?.Conflicts ?? []), ...(this.Owner.State.MessageConflicts ?? [])].map(C => [JSON.stringify(C), C])).values()];
		const ConflictKey = JSON.stringify([this.Owner.State.Sync?.Scope, Conflicts, this.Owner.State.Sessions.map(S => [S.Id, S.Title]), this.Owner.State.DeletedSessionIds]);
		if(this.ConflictsElement && ConflictKey !== this.ConflictsKey)
		{
			this.ConflictsKey = ConflictKey;
			render_sync_conflicts(this.ConflictsElement, Conflicts, this.Owner.State, (Key, Choice) => this.Owner.resolve_message_conflict(Key, Choice));
		}
		this.NavigationSummary?.setText(`会话与连接 · ${Session.Title}`);
		const Effective = [Session.EffectiveModel, Session.EffectiveEffort, Session.EffectiveTier === "priority" || Session.EffectiveTier === "fast" ? "Fast" : ""].filter(Boolean).join(" / ");
		this.StatusElement.setText(`${this.Owner.Status}${Effective ? ` | 最近请求: ${Effective}` : ""} | ${this.Owner.SkillStatus}`);
		const Notes = this.Owner.NoteSessions;
		this.NoteSessionBind.disabled = !Notes?.Path || this.input_blocked();
		if(this.DeleteSessionButton) { this.DeleteSessionButton.disabled = this.input_blocked(); }
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
		this.SessionsElement.disabled = this.input_blocked();
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
		this.HistoryWindow.forget(JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", Id]));
	}
	private async render_messages(): Promise<void>
	{
		if(this.Rendering || !this.Opened) { return; }
		const Session = this.Owner.Session, Messages = Session.Messages.map(Message => ({ ...Message }));
		const Context = JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", Session.Id]);
		if(this.EditingSession !== Session.Id) { this.EditingId = ""; }
		const Signature = this.message_signature();
		if(Signature === this.LastRendered && this.MessageList) { return; }
		this.Rendering = true;
		const Version = ++this.Version;
		this.MessageList ??= new MessageList(this.MessagesElement);
		const Visible = this.HistoryWindow.select(Context, Messages, this.MessageList.has_context(Context));
		const PreparedSignature = this.message_signature(), Sources = history_source_index(Messages), Followups = followup_index(Messages);
		try
		{
			const Items = Visible.Items.map(Message =>
			{
				const Task = structured_task(Messages, Message), Record = Task?.Action === "edit" ? this.Owner.Edits?.Store.Data.Records.find(Value => Value.Spec.Id === Task.Id) : null;
				const EditState = Task?.Action === "edit" ? [this.Owner.Edits?.Error, this.Owner.Edits?.ErrorTaskId, Record?.Status, Record?.Error, Record?.Cache, this.Owner.Edits?.Cache?.Turns, this.Owner.Edits?.Store.Data.Writes.filter(Value => Value.TaskId === Task.Id).map(Value => [Value.Id, Value.State, Value.Error])] : null;
				return { Id: Message.Id, Key: JSON.stringify([Message, Sources.get(Message.Id), Followups.get(Message.Id), Message.OperationId ? this.Owner.operation_state?.(Message.OperationId) : null, Message.Role === "user" ? [this.input_blocked(), this.EditingId === Message.Id] : null, EditState]), Render: () => this.render_card(Message, Messages, Followups) };
			});
			if(Visible.Earlier || Visible.Later)
			{
				Items.unshift({ Id: "history-controls:" + Context, Key: "history-controls:" + Visible.Earlier + ":" + Visible.Later, Render: async () =>
				{
					const Element = this.MessagesElement.ownerDocument.createElement("div"); Element.className = "codex-history-load"; Element.dataset.historyControls = "true";
					if(Visible.Earlier) { this.button(Element, `加载更早 ${Math.min(this.HistoryWindow.Batch, Visible.Earlier)} 条 (还有 ${Visible.Earlier} 条)`, () =>
					{
						this.HistoryWindow.older(Context, this.Owner.Session.Messages); this.Version++; this.LastRendered = ""; this.refresh();
					}); }
					if(Visible.Later) { this.button(Element, `回到最新回答 (后续 ${Visible.Later} 条)`, () => { this.HistoryWindow.latest(Context); this.Version++; this.LastRendered = ""; this.refresh(); }); }
					return { Element, Dispose: () => {} };
				} });
			}
			if(!Items.length)
			{
				Items.push({ Id: "welcome", Key: "welcome", Render: async () =>
				{
					const Element = this.MessagesElement.ownerDocument.createElement("div"); Element.className = "codex-welcome";
					Element.textContent = "可以直接提问, 或选中笔记内容后点击解释选区 / 检查证明. 阅读模式会附带原始 Markdown 源块.";
					return { Element, Dispose: () => {} };
				} });
			}
			if(await this.MessageList.update(Context, Items, () => this.Opened && Version === this.Version && this.Owner.Session.Id === Session.Id && Context === JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", this.Owner.Session.Id]))) { this.LastRendered = PreparedSignature; }
			else if(this.Opened) { this.refresh(); }
		}
		finally
		{
			this.Rendering = false;
			if(this.Opened && PreparedSignature !== this.message_signature()) { this.refresh(); }
		}
	}

	private async render_card(Message: ChatMessage, Messages: ChatMessage[], Followups = followup_index(Messages)): Promise<MessageNode>
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
			const Operation = Message.OperationId ? this.Owner.operation_state?.(Message.OperationId) : null;
			if(Operation)
			{
				Card.createDiv({ cls: "codex-operation-state", text: operation_label(Operation.Status), attr: { role: "status" } });
				if(Operation.Error) { const Details = Card.createEl("details"); Details.createEl("summary", { text: "操作详情" }); Details.createDiv({ text: Operation.Error }); }
				if(["local", "received"].includes(Operation.Status) && Operation.Attempted === false && Message.OperationId)
				{
					const OpId = Message.OperationId, Resume = this.button(Card, "继续发送已保存问题", () =>
					{
						Resume.disabled = true; void this.Owner.resume_operation(OpId).catch(E => new Notice(error_text(E))).finally(() => { Resume.disabled = false; });
					});
					Resume.disabled = this.input_blocked();
				}
				if(["local", "queued", "received", "unknown", "submission-unknown", "submitting", "running"].includes(Operation.Status) && Message.OperationId)
				{
					const OpId = Message.OperationId, Check = this.button(Card, "核对操作状态", () =>
					{
						Check.disabled = true; void this.Owner.reconcile_operation(OpId).catch(E => new Notice(error_text(E))).finally(() => { Check.disabled = false; });
					});
				}
			}
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
					if(this.input_blocked())
					{
						return;
					}
					this.EditingId = Message.Id;
					this.EditingSession = this.Owner.Session.Id;
					this.EditText = Message.Text;
					this.refresh();
				}).disabled = this.input_blocked();
				this.button(Header, "重新发送", () => void this.Owner.resend_message(Message.Id)).disabled = this.input_blocked();
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
					if(this.input_blocked() || !this.EditText.trim() || this.EditingSession !== this.Owner.Session.Id)
					{
						return;
					}
					const Text = this.EditText;
					this.EditingId = "";
					void this.Owner.resend_message(Message.Id, Text);
				}).disabled = this.input_blocked();
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
				else
				{
					const Path = source_path(Messages, Message);
					await MarkdownRenderer.render(this.app, Message.Text || "...", Body, Path, RenderComponent);
					const Directory = (P: string) => P.slice(0, P.lastIndexOf("/") + 1), Moved = answer_sources(Messages, Message).some(Ref => Ref.Path === Path && Ref.CurrentPath && Directory(Ref.CurrentPath) !== Directory(Path)), Missing = !!Path && typeof this.app?.vault?.getFileByPath === "function" && !this.app.vault.getFileByPath(Path);
					if(!Path || Moved || Missing)
					{
						RenderComponent.registerDomEvent(Body, "click", Event =>
						{
							const Node = Event.target as Element | null, Link = Node?.closest?.("a"), Href = Link?.getAttribute("href") ?? "";
							if(Link && (Link.classList.contains("internal-link") || (!!Href && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(Href)))) { Event.preventDefault(); Event.stopImmediatePropagation(); new Notice(Moved || Missing ? "原来源已移动或缺失, 这条回答仍保留产生时的相对链接基准; 请从来源清单核对目标, 未按新目录或同名文件猜测跳转" : "这条旧回答缺少可靠来源路径, 请从原快照核对链接; 未按当前笔记或同名文件猜测跳转"); }
						}, { capture: true });
					}
					if(Message.Role === "assistant") { bind_answer_blocks(Body, Message.Text); }
				}
			}
			else
			{
				Body.setText(Message.Task ? question_label(Message.Task) : Message.Text);
			}
			if(Message.Role === "assistant")
			{
				render_sources(this.app, Card, answer_sources(Messages, Message));
				const Related = Followups.get(Message.Id);
				if(Related)
				{
					const Chain = Card.createEl("details", { cls: "codex-followup-chain" }); Chain.createEl("summary", { text: "追问关联" });
					if(Related.RootId !== Message.Id) { this.button(Chain, "原始说明", () => void this.reveal_message(Related.RootId)); }
					if(Related.ParentId && Related.ParentId !== Related.RootId) { this.button(Chain, "上次引用的回答", () => void this.reveal_message(Related.ParentId!)); }
					if(Related.LatestId && Related.LatestId !== Message.Id) { this.button(Chain, "最新整合说明", () => void this.reveal_message(Related.LatestId!)); }
				}
			}
			return { Element: Card, Dispose: () => RenderComponent.unload() };
		}
		catch(ErrorValue) { RenderComponent.unload(); throw ErrorValue; }
	}
	private async reveal_message(Id: string): Promise<void>
	{
		const Session = this.Owner.Session, Context = JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", Session.Id]);
		if(!this.HistoryWindow.focus(Context, Session.Messages, Id)) { new Notice("本会话没有这条原消息, 未跳转其他会话或补造内容"); return; }
		this.Version++; this.LastRendered = "";
		for(let I = 0; I < 200 && this.Rendering; I++) { await new Promise(R => setTimeout(R, 10)); }
		if(!this.Opened || this.Owner.Session.Id !== Session.Id) { return; }
		await this.render_messages();
		const Card = [...this.MessagesElement.querySelectorAll<HTMLElement>("[data-message-id]")].find(E => E.dataset.messageId === Id);
		Card?.scrollIntoView({ block: "center", behavior: "auto" });
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
		this.save_draft();
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
		this.MessageList?.dispose(); this.MessageList = null; this.HistoryWindow.clear(); this.ContextKey = "";
		this.Owner.refresh();
	}

	private message_signature(): string
	{
		const Context = JSON.stringify([this.Owner.Remote?.Enabled ? this.Owner.Remote.CacheId : "desktop", this.Owner.Session.Id]);
		return JSON.stringify([Context, this.HistoryWindow.key(Context), this.Owner.Session.Messages, [...history_source_index(this.Owner.Session.Messages)], this.Owner.Session.Messages.map(M => M.OperationId ? this.Owner.operation_state?.(M.OperationId) : null), this.Owner.Busy, this.Owner.RuntimeState?.Stage, this.EditingId, this.Owner.Edits?.Error, this.Owner.Edits?.ErrorTaskId, this.Owner.Edits?.Store.Data.Records.map(Value => [Value.Spec.Id, Value.Status, Value.Error, Value.Cache]), this.Owner.Edits?.Store.Data.Writes.map(Value => [Value.Id, Value.State, Value.Error])]);
	}
}
