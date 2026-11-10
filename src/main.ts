import {
	Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Notice,
	MarkdownRenderer, MarkdownView, Component, FileSystemAdapter, Modal, editorInfoField, Platform, requestUrl, parseYaml, type App, type FileView, type TFile
} from "obsidian";
import { ContextCapture } from "./context";
import { build_prompt, derived_message_prompt, assert_quote_read_capability, DefaultInstructions, client_instructions, migrate_instructions, instruction_items, type ContextSnapshot, type AnswerQuote } from "./prompt";
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
import { browser_http, type BrowserRequest } from "./browser-http";
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
import { is_pdf_view } from "./pdf/reader";
import { select_pdf_box, type PdfBox } from "./pdf/box";
import { PdfBoxToolbar } from "./pdf/toolbar";
import { ChatEdits } from "./edit/controller";
import { open_edit_store } from "./edit/database";
import { type EditRole, type EditScope } from "./edit/protocol";
import { render_edit, export_edits } from "./edit/panel";
import { edit_scope, EditScopeOptions } from "./edit/options";
import { ComposerActions, type ComposeAction } from "./edit/composer";
import { MessageList, type MessageNode } from "./message-list";
import { SelectionPreview, selection_in_source } from "./selection-preview";
import { NoteSessions, note_file_path } from "./note-sessions";
import { new_session, prune_sessions, restore_sessions, delete_session_plan, message_deleted, type ChatSession, type SessionState } from "./sessions";
import { DeleteSessionDialog } from "./session-dialog";
import type { CacheContext } from "./edit/cache";
import { CodexView } from "./view";
import { CodexSettings } from "./settings";
import { environment_diagnostics, type DiagnosticProbe } from "./diagnostics";
import { RunLifecycle, PreparationCancelled, preparation_step, type PreparationTicket } from "./runtime/lifecycle";
import { send_intent, validate_outbox, normalize_outbox, type SendIntent } from "./runtime/outbox";
import { ensure_sync, create_send_operation, update_operation } from "./sync/operations";
import type { SendOperation, OperationStatus } from "./sync/types";
import { content_digest, canonical_json } from "./sync/types";
import { load_state_file, validate_saved_state, write_state_file } from "./runtime/state-store";
import { build_history_input, plan_history_input, HistoryReadTool, history_read_tool, read_history_page, type HistoryBudgetOptions } from "./history-budget";
import { source_reference, tool_read_reference, rename_sources, type SourceReference } from "./sources";
import { write_late_receipt, apply_late_receipts } from "./runtime/receipts";
import { message_checkpoint } from "./runtime/message-events";
import { merge_sync_metadata } from "./sync/metadata";
import { SnapshotQueue, StreamCheckpoints } from "./runtime/checkpoints";
import { OperationViewIndex } from "./runtime/operation-view";
import { MessageIndex } from "./runtime/message-index";
import { prepare_conflict_resolution, pending_conflicts, preserve_durable_resolved_messages, resolution_set_signature, assert_resolution_fresh, require_conflict_finalization, apply_conflict_resolution, effective_conflict_resolutions, conflict_evidence_key } from "./sync/conflicts";
import { authenticate_api_key, openai_api_key } from "./api-auth";
import { BackendConnection, type BackendDriver } from "./backend";
import { backend_capabilities } from "./backend-capabilities";
import type { BackendResult } from "./backend-result";
import { backend_profile, backend_name, backend_identity, backend_model, api_reasoning_supported, select_api_model, api_image_status, type ApiCatalogModel, type BackendProfile } from "./backend-profile";
import { backend_model_choices } from "./backend-models";
import { list_api_models } from "./api-models";
import { google_reasoning } from "./google-reasoning";
import { direct_api, direct_api_key } from "./direct-api";
import { snapshot_instructions } from "./prompt";
import { MathCompletionInstructions, completion_prompt, parse_completion } from "./completion-prompt";
import { ConnectionProfiles, ConnectionCredentials } from "./connection-profiles";
import { ApiSecretBindings } from "./api-secret-bindings";
import { verify_quoted_body, quote_input_ready } from "./quote-input";
import { preserve_terminal_messages } from "./runtime/terminal-messages";
import { apply_backend_evidence, type BackendEvidence } from "./backend-events";
import { ResultSaves } from "./runtime/result-saves";
import { IncompleteOperationEvidenceError } from "./sync/client";
import { capture_history_ledger, record_history_read } from "./history-ledger";
import type { BackendHistoryResult } from "./backend-result";

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
	Outbox?: SendIntent[];
	SchemaVersion?: 2;
}

interface StateTarget { Scope: string; Remote: boolean; Path: string; State: SavedState; Connection: RpcConnection | null; OperationId?: string; Archive?: boolean; }

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
	private readonly Writes = new SnapshotQueue();
	private readonly Checkpoints = new StreamCheckpoints();
	private readonly UnsavedCheckpoints = new Set<string>();
	private readonly BackendSaves = new ResultSaves<{ Target: StateTarget; Event: BackendEvidence }>(() =>
	{
		if(!this.Unloaded && this.State) { this.refresh(); }
	});
	private BackendSaveId = 0;
	get PendingBackendSaves()
	{
		return this.BackendSaves.values.filter(J => J.Value.Target.Scope === this.local_scope() && J.Value.Event.sessionId === this.State.ActiveId).map(J => ({
			Key: J.Key, Scope: J.Value.Target.Scope, SessionId: J.Value.Event.sessionId, MessageId: J.Value.Event.itemId,
			Text: J.Value.Event.result.Text, Status: J.Value.Event.result.Status, Saving: J.Saving, Error: J.Error
		}));
	}
	get BackendSaveBlocked(): boolean
	{
		return this.BackendSaves.values.some(J => J.Value.Target.Scope === this.local_scope() && J.Value.Event.sessionId === this.State.ActiveId && !J.Value.Target.Archive && !(J.Value.Event.result.Status === "unknown" && !J.Value.Event.result.Text && J.Value.Event.result.Metadata.Wait === "stopped"));
	}
	async retry_backend_saves(): Promise<void> { await this.BackendSaves.retry(); }
	private readonly OperationViews = new OperationViewIndex();
	private readonly MessagesById = new MessageIndex();
	private EditHistoryDirty = true;
	private LastEditData: unknown;
	private LastEditSession: ChatSession | null = null;
	private SessionChoice = 0;
	private history_changed(SessionId?: string, Ids?: readonly string[], EditRelevant = true): void
	{
		if(EditRelevant) { this.EditHistoryDirty = true; }
		for(const Leaf of this.app.workspace.getLeavesOfType(ViewType))
		{
			if(Leaf.view instanceof CodexView) { for(const Id of SessionId ? [SessionId] : this.State.Sessions.map(S => S.Id)) { Leaf.view.history_changed(Id, Ids); } }
		}
	}
	readonly Runtime = new RunLifecycle();
	private Diagnosing = false;
	private LastInputLedger = new Map<string, ChatMessage["InputLedger"]>();
	private thread_session(ThreadId: string): ChatSession | undefined { return this.State.Sessions.find(S => S.ThreadId === ThreadId || this.LiveThreads.get(S.Id) === ThreadId); }
	private local_operation_version(Operation: SendOperation): Partial<SendOperation>
	{
		return Operation.Scope.startsWith("backend:") ? { Origin: Operation.Scope, Revision: (Operation.Revision ?? 0) + 1 } : {};
	}
	private update_run_operation(Target: StateTarget, Id: string, Status: OperationStatus, Details: Partial<SendOperation> = {}): void
	{
		const State = this.target_state(Target), Operation = State.Sync?.Operations.find(O => O.Id === Id), Intent = State.Outbox?.find(O => O.Id === Id);
		if(Operation) { update_operation(State.Sync!, Id, Status, { ...Details, ...this.local_operation_version(Operation) }); }
		if(Intent && !["completed", "cancelled", "failed"].includes(Intent.Status)) { Intent.Status = Status; if(Details.Error) { Intent.Error = Details.Error; } }
	}

	private completed_key(Scope: string, ThreadId: string, TurnId: string): string { return JSON.stringify([Scope, ThreadId, TurnId]); }
	private async commit_send_receipt(Target: StateTarget, Operation: SendOperation, Result: any, Remote?: SendOperation): Promise<any>
	{
		const State = this.target_state(Target), Current = State.Sync?.Operations.find(O => O.Id === Operation.Id) ?? Operation;
		if(Current.Digest !== Operation.Digest) { throw new Error("接收凭证的原始输入身份已变化, 不覆盖"); }
		const Terminal = ["completed", "cancelled", "failed"].includes(Current.Status), TerminalStatus = Current.Status;
		if(Remote && State.Sync) { update_operation(State.Sync, Current.Id, Remote.Status, Remote); }
		if(Terminal) { Current.Status = TerminalStatus; }
		if(Result?.turn?.id)
		{
			Object.assign(Current, this.local_operation_version(Current));
			Current.Result = structuredClone(Result); Current.TurnId = Result.turn.id; Current.ThreadId = (Current.Request as any)?.threadId ?? Current.ThreadId;
			if(!Remote && !["completed", "cancelled", "failed"].includes(Current.Status)) { Current.Status = this.CompletedTurns.has(this.completed_key(Target.Scope, Current.ThreadId ?? "", Result.turn.id)) ? "completed" : "running"; }
			const Session = State.Sessions.find(S => S.Id === Current.SessionId), Message = Session?.Messages.find(M => M.Id === Current.MessageId);
			if(Message) { Message.TurnId = Result.turn.id; } else if(!Session) { Current.SessionDeleted = true; } else if(message_deleted(State, Current.SessionId, Current.MessageId)) { Current.MessageDeleted = true; }
			if(this.Unloaded && Current.Status === "running") { Current.Status = "submission-unknown"; Current.Error = "插件已关闭, 原接收凭证保留, 运行结果需恢复后核对"; }
		}
		Object.assign(Operation, Current); this.history_changed(Current.SessionId); await this.save_target(Target); return Result;
	}
	get RuntimeState() { return { Stage: this.Runtime.Stage }; }
	get CanStop(): boolean { return this.Runtime.CanStop || this.Busy || this.ChatPreparing || !!this.Connecting || !!this.TurnId; }
	operation_state(Id: string): Pick<SendOperation, "Status" | "Error" | "TurnId" | "Attempted"> | null
	{
		return this.OperationViews.get(Id, this.State.Sync?.Operations, this.State.Outbox);
	}
	async resume_operation(Id: string): Promise<void>
	{
		const Operation = this.State.Sync?.Operations.find(O => O.Id === Id), Intent = this.State.Outbox?.find(O => O.Id === Id), Status = Operation ?? Intent;
		if(!Status || !["local", "received"].includes(Status.Status) || Operation?.Attempted === true || Operation?.Conflicts?.length) { throw new Error("原提交结果未知或已有终态, 不能盲目继续发送; 请先核对"); }
		const Session = this.State.Sessions.find(S => S.Id === Status.SessionId), Message = Session?.Messages.find(M => M.Id === Status.MessageId && M.OperationId === Id);
		if(!Session || !Message || this.State.ActiveId !== Session.Id) { throw new Error("请先返回原会话核对这条已保存问题"); }
		const Task = Message.Task ? this.Edits?.Store.Data.Records.find(R => R.Spec.Id === Message.Task!.Id)?.Spec : null;
		if(Message.Task && !Task) { throw new Error("原修改基线已到期或缺失, 请明确重新捕获后生成新预览"); }
		if(Task) { await this.Edits!.Store.change(Data => { const R = Data.Records.find(R => R.Spec.Id === Task.Id); if(R && R.Status === "rejected") { R.Status = "pending"; delete R.Error; } }); }
		await this.send_message(Message.Text, Message.Context ?? null, Message.Quote ?? null, Task, { MessageId: Message.Id, OperationId: Id });
	}
	async resolve_message_conflict(Key: string, Choice: "local" | "remote"): Promise<void>
	{
		if(!["local", "remote"].includes(Choice) || this.Busy || this.ChatPreparing) { throw new Error("请先等待当前请求完成"); }
		const Conflicts = this.State.Sync?.Conflicts ?? this.State.MessageConflicts ?? [], Matching = Conflicts.filter(C => C.Key === Key);
		if(Matching.length !== 1) { throw new Error("同一身份存在多份冲突, 请先导出双方完整记录逐一核对, 未猜选其中一份"); }
		const C = Matching[0], Parts = JSON.parse(Key), SessionId = Parts[0] === "message" ? Parts[1] : Parts[0], MessageId = Parts[0] === "message" ? Parts[2] : Parts[1];
		const Session = this.State.Sessions.find(S => S.Id === SessionId), Index = Session?.Messages.findIndex(M => M.Id === MessageId) ?? -1;
		if(!Session || Index < 0 || this.State.DeletedSessionIds?.includes(SessionId)) { throw new Error("目标消息或会话已不存在, 不恢复已删除数据"); }
		const Candidate = Choice === "local" ? C.Local : C.Remote;
		if(!Candidate || typeof Candidate !== "object" || (Candidate as ChatMessage).Id !== MessageId || typeof (Candidate as ChatMessage).Text !== "string" || !["user", "assistant", "system", "reasoning"].includes((Candidate as ChatMessage).Role)) { throw new Error("此冲突不是可确认的单条消息, 请保留导出记录核对"); }
		const Scope = this.local_scope(), DecisionScope = this.State.Sync?.Scope ?? Scope;
		if(this.Remote.Enabled) { require_conflict_finalization((this.HostInfo as any)?.capabilities); }
		const Decisions = structuredClone(this.State.Sync?.Resolutions ?? []), Signature = resolution_set_signature(DecisionScope,C,Decisions);
		const Stamp = JSON.stringify(C), MessageStamp = JSON.stringify(Session.Messages[Index]);
		const Accepted = await new Promise<boolean>(Resolve =>
		{
			const Dialog = new Modal(this.app); this.Modals.add(Dialog); let Done = false;
			Dialog.contentEl.createEl("h3", { text: "确认会话消息冲突" }); Dialog.contentEl.createEl("p", { text: `只替换原会话中的这一条消息为${Choice === "local" ? "本机" : "远端"}版本. 双方原记录保留审计, 不写入笔记或重发推理.` });
			const Heads=effective_conflict_resolutions(Decisions).filter(R=>conflict_evidence_key(R.Conflict)===conflict_evidence_key(C));
			if(Heads.length){Dialog.contentEl.createEl("p",{text:"本次裁定将取代以下已核对的有效决议，旧记录仍保留审计："});Dialog.contentEl.createEl("pre",{text:Heads.map(R=>R.Id+" · "+R.Choice).join("\n")});}
			Dialog.contentEl.createEl("pre", { text: (Candidate as ChatMessage).Text.slice(0, 16000) });
			const Button = Dialog.contentEl.createEl("button", { text: "确认采用此消息版本" }); Button.addEventListener("click", () => { Done = true; Resolve(true); Dialog.close(); });
			Dialog.onClose = () => { this.Modals.delete(Dialog); if(!Done) { Resolve(false); } }; Dialog.open();
		});
		if(!Accepted) { return; }
		if(Scope !== this.local_scope() || !Conflicts.includes(C) || JSON.stringify(C) !== Stamp || JSON.stringify(Session.Messages[Index]) !== MessageStamp || !this.State.Sessions.includes(Session)) { throw new Error("确认期间冲突或消息发生变化, 未覆盖后续内容"); }
		assert_resolution_fresh(DecisionScope,C,this.State.Sync?.Resolutions ?? [],Signature);
		const Resolution = await prepare_conflict_resolution(DecisionScope, C, Choice, Decisions), Target = this.state_target();
		await this.Writes.enqueue(async () =>
		{
			const CurrentConflicts = this.State.Sync?.Conflicts ?? this.State.MessageConflicts ?? [];
			if(Scope !== this.local_scope() || !CurrentConflicts.some(Current => JSON.stringify(Current) === Stamp) || this.State.Sessions.find(S => S.Id === SessionId)?.Messages.find(M => M.Id === MessageId) !== Session.Messages[Index] || JSON.stringify(Session.Messages[Index]) !== MessageStamp || JSON.stringify(C) !== Stamp) { throw new Error("保存前原消息或冲突已变化, 请重新核对"); }
			const Next = apply_conflict_resolution(this.State,Resolution,Signature,canonical_json(JSON.parse(MessageStamp)));
			await write_state_file(this.app.vault.adapter, Target.Path, Next);
			if(Scope === this.local_scope() && !this.Unloaded) { this.merge_restored(Next); }
		});
		if(Scope === this.local_scope() && !this.Unloaded) { this.history_changed(SessionId); this.refresh(); await this.persist(); }
	}
	async ensure_session_history(Id: string): Promise<void>
	{
		if(this.State.Sync?.History?.[Id]?.Status !== "unloaded") { return; }
		const Scope = this.local_scope();
		await this.ensure_connection();
		if(Scope !== this.local_scope() || this.Unloaded) { throw new Error("历史加载前连接已切换, 未读取新连接中的同名会话"); }
		const Connection = this.Connection;
		if(!(Connection instanceof RemoteConnection)) { throw new Error("原会话正文尚未加载, 需要原远程连接; 未当作空会话"); }
		const State = await Connection.hydrate_session(this.State, Id);
		if(Connection !== this.Connection || Scope !== this.local_scope() || this.Unloaded) { throw new Error("读取期间连接已切换, 未把原会话合并到新连接"); }
		this.merge_restored(State);
		if(this.State.Sync?.History?.[Id]?.Status === "unloaded") { throw new Error("会话正文仍未完整加载, 请核对连接"); }
		await this.persist(false); this.refresh();
	}
	async export_conversations(): Promise<string>
	{
		const HasUnsaved = () => this.BackendSaves.values.some(J => J.Value.Target.Scope === this.local_scope());
		if(HasUnsaved()) { await this.retry_backend_saves(); if(HasUnsaved()) { throw new Error("仍有回答尚未保存，未生成完整导出；请重试保存"); } }
		const Scope = this.local_scope();
		if(this.Remote.Enabled) { await this.ensure_connection(); }
		if(Scope !== this.local_scope() || this.Unloaded) { throw new Error("导出前连接已切换, 请重新导出当前连接"); }
		const Connection = this.Connection;
		if(Connection instanceof RemoteConnection)
		{
			try
			{
				const Complete = await Connection.hydrate_all(this.State);
				if(Connection !== this.Connection || Scope !== this.local_scope() || this.Unloaded) { throw new Error("导出期间连接已变化, 未导出不完整记录"); }
				this.merge_restored(Complete); await this.persist(false);
			}
			catch(E)
			{
				if(E instanceof IncompleteOperationEvidenceError && Connection === this.Connection && Scope === this.local_scope() && !this.Unloaded)
				{
					this.merge_restored({ ...this.State, ...E.IncompleteState }); await this.persist(false);
				}
				throw E;
			}
		}
		if(this.State.Sessions.some(S => !this.State.DeletedSessionIds?.includes(S.Id) && this.State.Sync?.History?.[S.Id]?.Status === "unloaded")) { throw new Error("仍有未加载正文, 未导出不完整记录"); }
		return JSON.stringify({ SchemaVersion: 2, Scope: this.State.Sync?.Scope ?? "desktop", Sessions: this.State.Sessions, ActiveId: this.State.ActiveId, DeletedSessionIds: this.State.DeletedSessionIds, DeletedMessages: this.State.DeletedMessages, Sync: this.State.Sync, Outbox: this.State.Outbox, ResolvedConflicts: (this.State as any).ResolvedConflicts }, null, 2);
	}
	private local_scope(): string { return this.Backend ? "backend:" + this.backend_state_id() : this.Remote.Enabled ? "remote-local:" + this.Remote.CacheId : "desktop:" + this.app.vault.getName(); }
	draft_scope(): string { return this.local_scope() + ":" + (this.Remote.CacheId ?? "local"); }
	private backend_state_id(Id = this.BackendId): string { return this.BackendDeviceId + "-" + Id; }
	private state_path(Remote = this.Remote.Enabled, BackendId = Remote ? "" : this.BackendId, CacheId = this.Remote.CacheId): string { return `${this.manifest.dir}/${Remote ? "remote-" + CacheId : BackendId ? "backend-" + this.backend_state_id(BackendId) : "desktop"}-state-v2.json`; }
	private legacy_state_path(Remote = this.Remote.Enabled, BackendId = Remote ? "" : this.BackendId, CacheId = this.Remote.CacheId): string
	{
		return `${this.manifest.dir}/${Remote ? "remote-" + CacheId + "-state.json" : BackendId ? "backend-" + this.backend_state_id(BackendId) + "-state.json" : "data.json"}`;
	}
	private state_target(): StateTarget { return { Scope: this.local_scope(), Remote: this.Remote.Enabled, Path: this.state_path(), State: this.State, Connection: this.Connection }; }
	private target_state(Target: StateTarget): SavedState { if(Target.Scope === this.local_scope()) { Target.State = this.State; } return Target.State; }
	private async save_target(Target: StateTarget, SyncRemote = false): Promise<void>
	{
		const State = this.target_state(Target);
		if(this.Unloaded || Target.Scope !== this.local_scope())
		{
			const Record = State.Sync?.Operations.find(O => O.Id === Target.OperationId) ?? State.Outbox?.find(O => O.Id === Target.OperationId);
			if(Record) { await write_late_receipt(this.app.vault.adapter, Target.Path, Record, State.Outbox?.find(I => I.Id === Record.Id)); } return;
		}
		return this.persist_snapshot(State, SyncRemote, Target);
	}
	async reconcile_operation(Id: string): Promise<void>
	{
		if(await apply_late_receipts(this.app.vault.adapter, this.state_path(), this.State)) { await this.persist(false); }
		if(this.Remote.Enabled && !this.Connection) { this.Runtime.stage("recovering"); await this.ensure_connection(); }
		const Operation = this.State.Sync?.Operations.find(O => O.Id === Id);
		if(!Operation) { new Notice(this.State.Outbox?.find(O => O.Id === Id)?.Status === "cancelled" ? "准备已取消, 没有自动重发" : "此问题只保存在本机, 尚无服务端提交凭证; 可明确重发为新分支"); return; }
		if(this.Connection instanceof RemoteConnection)
		{
			const Current = await this.Connection.operation_status(Id);
			if(!Current) { new Notice("没有查到接收凭证, 不能据此断言请求已停止, 不自动重发"); return; }
			update_operation(this.State.Sync!, Id, Current.Status, Current); await this.persist(false); await this.recover_remote(this.Connection); this.refresh();
			new Notice(`发送状态: ${{ local: "仅本机", received: "服务端已接收", "submission-unknown": "推理结果待核对", running: "生成中", completed: "已完成", cancelled: "已取消", failed: "失败" }[Current.Status]}`); return;
		}
		new Notice(["completed", "cancelled", "failed"].includes(Operation.Status) ? "已保存此操作的终态" : "本机临时进程不提供跨重启提交核对; 原问题保留, 未自动重发. 请核对已有回答, 必要时明确重发为新分支");
	}
	private async recover_remote(Connection: RemoteConnection): Promise<void>
	{
		if(this.Connection !== Connection || this.Unloaded) { return; }
		const OldInfo = this.HostInfo as any, Info = Connection.Info;
		if(Info && OldInfo && (Info.server !== OldInfo.server || (Info.agentInstance && OldInfo.agentInstance && Info.agentInstance !== OldInfo.agentInstance)))
		{
			this.LiveThreads.clear(); this.LoadedThread = null; this.LastInputLedger.clear();
			for(const S of this.State.Sessions) { S.ThreadId = null; S.InstructionsHash = ""; }
		}
		this.HostInfo = Info;
		const Restored = await Connection.restore_state(this.State, this.NoteSessions?.Data.Enabled ? this.NoteSessions.Data.Links.map(L => L.SessionId) : [], !this.NoteSessions?.Manual);
		if(this.Connection !== Connection || this.Unloaded) { return; }
		this.merge_restored(Restored);
		for(const Id of this.State.Sync?.Operations.filter(O => ["received", "submission-unknown", "running"].includes(O.Status)).map(O => O.Id) ?? [])
		{
			if(Connection.Info?.capabilities?.operationStatus !== 1) { break; }
			const Current = await Connection.operation_status(Id);
			if(this.Connection !== Connection || this.Unloaded) { return; }
			if(Current && this.State.Sync?.Operations.some(O => O.Id === Id)) { update_operation(this.State.Sync, Id, Current.Status, Current); }
		}
		await this.persist(false); this.restore_runtime(); this.Status = "已恢复状态与事件监听, 未重发推理"; this.refresh();
	}
	private merge_restored(Restored: SavedState, Bootstrap = false): void
	{
		const Fresh = this.State, Merged = restore_sessions(Fresh, Restored, this.NoteSessions?.Data.Enabled ? this.NoteSessions.Data.Links.map(L => L.SessionId) : [], !this.NoteSessions?.Manual);
		if(Restored.Sync) { Merged.Sync = merge_sync_metadata(Merged.Sync, Restored.Sync); }
		this.State = { ...Fresh, ...Merged, Settings: Bootstrap && !Fresh.Settings.Model ? { ...Fresh.Settings, Model: Restored.Settings.Model, Effort: Restored.Settings.Effort } : Fresh.Settings, Outbox: Fresh.Outbox };
		this.history_changed();
	}

	async diagnose_environment(): Promise<void>
	{
		if(this.Diagnosing) { return; }
		this.Diagnosing = true;
		const Dialog = new Modal(this.app); this.Modals.add(Dialog); Dialog.onClose = () => { this.Modals.delete(Dialog); Dialog.contentEl.empty(); };
		Dialog.contentEl.createEl("h3", { text: "Codex 环境检查" }); const Body = Dialog.contentEl.createDiv({ attr: { role: "status" } }); Body.setText("正在检查, 不提交推理请求..."); Dialog.open();
		const Ready = this.ensure_connection();
		void Ready.catch(() => {});
		const Probes: DiagnosticProbe[] = [
			{ Name: "完整 Codex 运行包", Run: async () =>
			{
				if(this.Backend) { return { Status: "unavailable", Detail: "当前连接使用 " + backend_name(this.Backend) }; }
				if(this.Remote.Enabled) { return { Status: "unavailable", Detail: "运行包在 Windows 桥主机, 客户端无法逐文件核验", Action: "在 Windows 使用同一检查入口核验 CLI 与配套程序" }; }
				this.Desktop ??= await import("./desktop"); const Cli = this.State.Settings.CliPath || await this.Desktop.discover_cli(), Info = await this.Desktop.runtime_info(Cli);
				return { Status: Info.Complete ? "ok" : "warning", Detail: `${Info.Version}; ${Info.Complete ? "配套工具程序齐全" : "当前目录未找到全部配套程序"}${Info.Resolved ? "; 已为插件进程定位完整应用运行包" : ""}`, Action: Info.Complete ? undefined : "在设置中选择完整 CLI 安装目录, 不仅复制单个 exe" };
			} },
			{ Name: "登录", Run: async () => { await Ready; if(this.Backend) { return { Status: "warning", Detail: "已配置连接, 模型权限由实际问答验证" }; } const Account = await this.Connection!.request("account/read", { refreshToken: false }); return { Status: Account.account ? "ok" : "error", Detail: Account.account ? "Codex 已登录" : "尚未登录", Action: Account.account ? undefined : "在 Codex 应用或 CLI 完成登录, 不向插件粘贴认证文件" }; } },
			{ Name: "模型目录", Run: async () => { await Ready; return { Status: this.Models.length ? "ok" : "error", Detail: this.Models.length ? `读取到 ${this.Models.length} 个模型, 不等同于推理额度验收` : this.CatalogError || "目录为空", Action: this.Models.length ? undefined : "连接恢复后重查目录" }; } },
			{ Name: "math-writing", Run: async () => { await Ready; if(!this.Backend) { await this.ensure_math_skill(); } return { Status: "ok", Detail: this.SkillStatus }; } },
			{ Name: "Obsidian CLI 与当前库", Run: async () =>
			{
				await Ready;
				if(this.Backend) { return { Status: "unavailable", Detail: "当前使用客户端提供的笔记快照" }; }
				if(this.Remote.Enabled) { return { Status: this.HostInfo?.vault === this.app.vault.getName() ? "ok" : "error", Detail: "读取发生在 Windows 同步副本; 客户端快照保持独立", Action: this.HostInfo?.vault === this.app.vault.getName() ? undefined : "核对桥绑定的库, 不跨库重定向" }; }
				const Result = await run_obsidian_read(this.obsidian_cli(), this.app.vault.getName(), { command: "vault", params: { info: "name" } });
				const Matched = Result.success && Result.contentItems[0].text.trim() === this.app.vault.getName();
				return { Status: Matched ? "ok" : "error", Detail: Matched ? "CLI 可访问当前笔记库" : Result.success ? "CLI 返回的库名与当前库不一致" : "CLI 无法读取当前库", Action: Matched ? undefined : "保持当前 Obsidian 库已打开, 核对 CLI 路径与库名" };
			} },
			{ Name: "远程能力", Run: async () => { if(!this.Remote.Enabled) { return { Status: "ok", Detail: "本机模式, 不需要独立远程桥" }; } await Ready; const Info = this.HostInfo as any; return { Status: Info?.protocolVersion >= 2 ? "ok" : "warning", Detail: `桥产品版本 ${Info?.bridgeVersion ?? "旧桥未报告"}; 协议 ${Info?.protocolVersion ?? "legacy"}`, Action: Info?.protocolVersion >= 2 ? undefined : "新同步、操作核对及 PDF 局部图需要新桥; 此检查不会自动重启或更新" }; } }
		];
		try
		{
			const Report = await environment_diagnostics(Probes); if(!this.Modals.has(Dialog)) { return; }
			Body.empty(); for(const Item of Report) { Body.createEl("h4", { text: `${({ ok: "正常", warning: "待核对", error: "缺项", unavailable: "此端不可验" })[Item.Status]} · ${Item.Name}` }); Body.createEl("p", { text: Item.Detail }); if(Item.Action) { Body.createEl("p", { text: Item.Action }); } }
		}
		finally { this.Diagnosing = false; }
	}
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
	private LocalApiKey: string | undefined;
	Backend: BackendProfile | null = null;
	private BackendId = "";
	private BackendStorage = "";
	private BackendDeviceId = "";
	private BackendKey = "";
	private Profiles: ConnectionProfiles | null = null;
	private readonly Credentials = new ConnectionCredentials();
	ApiSecrets?: ApiSecretBindings;
	private BackendCatalog: ApiCatalogModel[] = [];
	private BackendReasoning = new Map<string, ApiCatalogModel["Reasoning"]>();
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
	private PdfBoxCapture: { View: FileView; File: TFile; Abort: AbortController } | null = null;
	private PdfToolbar = new PdfBoxToolbar(View =>
	{
		if(this.PdfBoxCapture?.View === View) { this.cancel_pdf_box(); }
		else { this.open_pdf_box(View); }
	});
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
		this.LastInputLedger.clear();
		this.MathWritingSkill = null;
		this.LoadingSkill = null;
		this.SkillStatus = "math-writing: 连接后检查";
	}

	connection_choices(): { Id: string; Label: string; Active: boolean }[]
	{
		const Choices = this.Profiles?.list().filter(P=>!Platform.isMobileApp || P.Profile.Kind==="api").map(P=>({ Id:P.Id, Label:P.Name, Active:!!this.Backend && canonical_json(P.Profile)===canonical_json(this.Backend) })) ?? [];
		if(this.Remote.Enabled) { Choices.unshift({Id:"current-remote",Label:"独立远程 Codex",Active:true}); }
		else if(!this.Backend) { Choices.unshift({Id:"current-local",Label:"本机 Codex",Active:true}); }
		else if(!Choices.some(P=>P.Active)) { Choices.unshift({Id:"current-backend",Label:this.connection_label(),Active:true}); }
		return Choices;
	}
	connection_label(): string { return this.Backend ? backend_name(this.Backend)+" · "+backend_model(this.Backend) : this.Remote.Enabled ? "独立远程 Codex" : "本机 Codex"; }
	save_connection_profile(Profile: unknown, Name = "", Catalog?: ApiCatalogModel[]): void
	{
		if(!this.Profiles) { throw new Error("本设备连接配置不可用，原数据保留"); }
		this.Profiles.save(Profile, Name, Catalog); this.refresh();
	}
	async choose_connection(Id: string): Promise<void>
	{
		if(Id.startsWith("current-")) { return; }
		const Entry = this.Profiles?.list().find(P=>P.Id===Id);
		if(!Entry) { throw new Error("连接配置已变化，请重新选择"); }
		await this.start_backend(Entry.Profile, "", Entry.Catalog);
	}

	private backend_models(Profile: BackendProfile): ModelInfo[]
	{
		return backend_model_choices(Profile, this.BackendCatalog);
	}
	private backend_secret(Profile: BackendProfile): string
	{
		const Memory = this.Credentials.get(Profile);
		if(Memory || Profile.Kind !== "api" || !this.ApiSecrets) { return Memory; }
		const Alias = this.ApiSecrets.alias(Profile);
		return Alias ? this.ApiSecrets.read(Alias) : "";
	}

	private async prepare_backend(Profile: BackendProfile, Secret: string, Catalog?: ApiCatalogModel[], Refresh=false): Promise<{ Profile: BackendProfile; Driver: BackendDriver; Catalog: ApiCatalogModel[]; Reasoning: Map<string, ApiCatalogModel["Reasoning"]>; Error: string }>
	{
		const Send = (Value: BrowserRequest)=>requestUrl({...Value,throw:false});
		let Entries = Catalog !== undefined ? Catalog : !Refresh && this.Backend && backend_identity(this.Backend)===backend_identity(Profile) ? this.BackendCatalog : undefined;
		let ErrorText = "";
		if(Profile.Kind==="api" && Entries === undefined)
		{
			try { Entries=await list_api_models(Profile.Provider,Profile.Base,Secret,Send,6000); }
			catch { ErrorText="模型目录暂不可用，保留手动模型；未知能力需在配置中明确选择"; }
		}
		const Reasoning = new Map((Entries ?? []).map(M=>[M.Id,M.Reasoning]));
		if(Profile.Kind==="api")
		{
			const Selected = select_api_model(Profile, Profile.Model, Entries), Entry = Entries?.find(M => M.Id === Profile.Model);
			// Existing unannotated profiles keep their original model's enablement, not invented verification.
			Profile = !Profile.Selection && typeof Entry?.Vision !== "boolean" ? { ...Profile, Protocol: Selected.Profile.Protocol } : Selected.Profile;
			Reasoning.set(Profile.Model, Selected.Reasoning);
		}
		const Driver = Profile.Kind==="api" ? direct_api(Profile,Secret,Send,Reasoning.get(Profile.Model)) : await (await import("./headless-agents")).headless_agent(Profile,Secret);
		return {Profile,Driver,Catalog:Entries ?? [],Reasoning,Error:ErrorText};
	}

	connection_capabilities(): string
	{
		if(!this.Backend) { return this.Remote.Enabled ? "独立远程桥 · 能力由握手核对" : "本机 Codex · 只读宿主工具"; }
		const C=this.Connection instanceof BackendConnection ? this.Connection.Capabilities : backend_capabilities(this.Backend);
		const Stream=this.Backend.Kind==="api"&&this.Backend.Stream==="buffered"?"整段响应":C.Streaming===true?"真实流式":C.Streaming===false?"整段响应":"流式待首轮核实";
		return [Stream,C.HistoryRead===true?"可受限补读历史":"宿主预算预取",C.Images===true?"支持本轮图像":C.Images===false?"仅文本":"图像能力未确认","停止等待不保证服务端取消"].join(" · ");
	}

	private backend_history_tools(): boolean
	{
		return !!this.Backend && backend_capabilities(this.Backend,{HistoryRead:true}).HistoryRead===true;
	}

	private make_backend_connection(Profile: BackendProfile, Driver: BackendDriver, Efforts?: readonly string[]): BackendConnection
	{
		const Generation=this.Generation, Target=this.state_target();
		const Connection = new BackendConnection(Profile,Driver,Message=>
		{
			if(Generation===this.Generation && !this.Unloaded) { this.handle_message(Message); }
			else if(Message.method === "backend/result") { void this.accept_backend_event({ ...Target, Archive: true }, Message.params); }
		},Efforts,{ Catalog: this.BackendCatalog, HistoryRead: async (Args,SessionId) =>
		{
			if(Generation!==this.Generation || Target.Scope!==this.local_scope() || this.Unloaded || this.State.ActiveId!==SessionId || this.Connection!==Connection) { throw new Error("历史读取作用域或连接已变化"); }
			const Session=this.State.Sessions.find(S=>S.Id===SessionId);
			if(!Session || this.State.DeletedSessionIds?.includes(SessionId)) { throw new Error("原会话已删除"); }
			const OperationId = this.Runtime.Active?.SessionId === SessionId ? this.Runtime.Active.OperationId : undefined;
			const Result=await read_history_page(SessionId,Session.Messages,Args,Target.Scope);
			if(Generation!==this.Generation || Target.Scope!==this.local_scope() || this.Connection!==Connection) { throw new Error("读取期间连接已切换"); }
			if(OperationId) { this.record_history_success(Session, OperationId, Args, Result); }
			return Result;
		} });
		return Connection;
	}
	private record_history_success(Session: ChatSession, OperationId: string, Args: unknown, Result: BackendHistoryResult): void
	{
		const Operation = this.State.Sync?.Operations.find(O => O.Id === OperationId && O.SessionId === Session.Id);
		const User = Operation && Session.Messages.find(M => M.Id === Operation.MessageId && M.OperationId === OperationId);
		if(!Operation || !User?.InputLedger || this.State.DeletedSessionIds?.includes(Session.Id) || message_deleted(this.State, Session.Id, User.Id)) { return; }
		const Next = record_history_read(User.InputLedger, { Scope: Operation.Scope, SessionId: Session.Id, OperationId }, Args, Result, Session.Messages);
		if(Next !== User.InputLedger) { User.InputLedger = Next; this.history_changed(Session.Id, [User.Id], false); this.persist_background(); }
	}

	async onload(): Promise<void>
	{
		this.RemoteKey = `codex-sidebar-remote:${this.app.vault.getName()}`;
		this.BackendStorage = `codex-sidebar-backend:${this.app.vault.getName()}`;
		if(typeof this.app.secretStorage?.getSecret === "function") { this.ApiSecrets = new ApiSecretBindings(localStorage, this.BackendStorage + ":secret:", this.app.secretStorage); }
		try { this.Profiles = new ConnectionProfiles(localStorage, this.app.vault.getName()); }
		catch(E) { new Notice(error_text(E)); }
		const Device = localStorage.getItem(this.BackendStorage + ":device") ?? "";
		this.BackendDeviceId = /^[0-9a-f-]{36}$/i.test(Device) ? Device : crypto.randomUUID();
		localStorage.setItem(this.BackendStorage + ":device", this.BackendDeviceId);
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
		try
		{
			const Raw = localStorage.getItem(this.BackendStorage);
			if(Raw)
			{
				const Profile = backend_profile(JSON.parse(Raw));
				if(!Platform.isMobileApp || Profile.Kind === "api")
				{
					this.BackendId = await instruction_hash(backend_identity(Profile));
					this.Backend = Profile;
				}
			}
		}
		catch { /* Invalid device-local profiles cannot select a backend. */ }
		if(this.Backend) { this.Remote.Enabled = false; }
		else if(Platform.isMobileApp)
		{
			this.Remote.Enabled = true;
		}
		this.RemoteStatePath = this.state_path(true);
		this.save_remote_config();
		if(!this.Remote.Enabled && !this.Backend)
		{
			this.Desktop = await import("./desktop");
			this.CompletionWorker = new this.Desktop.CompletionService();
		}
		const Saved = await load_state_file(this.app.vault.adapter, this.state_path(), this.legacy_state_path()) as SavedState | null;
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
			...Saved, SchemaVersion: 2 as const,
			Settings: { CliPath: "", Model: "", Effort: "", Fast: false, ShowUsage: true, Instructions: DefaultInstructions, AttachContext: true, AutoCapture: true, Completion: !this.Backend, CompletionDelay: 1200, ObsidianCliPath: "", ...Saved?.Settings, EditScope: edit_scope(Saved?.Settings?.EditScope) },
			Sessions,
			ActiveId: Sessions.some(Value => Value.Id === Saved?.ActiveId) ? Saved!.ActiveId! : Sessions[0].Id,
			...(Saved?.DeletedSessionIds !== undefined ? { DeletedSessionIds: Saved.DeletedSessionIds } : {})
		});
		if(this.State.Outbox) { for(const Intent of this.State.Outbox) { if(await content_digest(Intent.Input) !== Intent.Digest) { throw new Error("待发送原始输入摘要不一致, 未替换会话记录"); } } }
		normalize_outbox(this.State);
		if(await apply_late_receipts(this.app.vault.adapter, this.state_path(), this.State)) { await write_state_file(this.app.vault.adapter, this.state_path(), this.State); }
		this.State.Settings.Instructions = migrate_instructions(this.State.Settings.Instructions);
		this.configure_backend_state();
		if(!this.State.Settings.Model)
		{
			this.State.Settings.Model = this.Session.EffectiveModel ?? "";
			this.State.Settings.Effort ||= this.Session.EffectiveEffort ?? "";
		}
		this.CompletionStatus = this.addStatusBarItem();
		this.CompletionStatus.setText(this.State.Settings.Completion ? "Codex 补全已开启" : "Codex 补全已关闭");
		this.Inline = new InlineCompletions({
			Enabled: () => this.State.Settings.Completion && !this.Unloaded && (!this.Backend || !!this.Connection),
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
		this.addCommand({ id: "capture-pdf-box", name: "框选到 Codex", checkCallback: Checking =>
		{
			if(!this.can_capture_pdf_box()) { return false; }
			if(!Checking) { this.open_pdf_box(); }
			return true;
		} });
		this.addCommand({ id: "toggle-completion", name: "开启/关闭行内补全", callback: () => void this.set_completion(!this.State.Settings.Completion) });
		this.addSettingTab(new CodexSettings(this.app, this));
		this.registerMarkdownPostProcessor((ElementValue, Context) => this.Capture.register_block(ElementValue, Context));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () =>
		{
			const Active = this.app.workspace.activeLeaf?.view;
			if(this.PdfBoxCapture && note_file_path(Active) && Active !== this.PdfBoxCapture.View) { this.cancel_pdf_box(); }
			this.sync_pdf_toolbar();
			this.Capture.track_view();
			if(this.Capture.LastView)
			{
				this.bind_document(this.Capture.LastView.containerEl.ownerDocument);
			}
			this.observe_note_file(); this.refresh();
		}));
		this.registerEvent(this.app.workspace.on("file-open", () => { this.sync_pdf_toolbar(); this.observe_note_file(); }));
		this.registerEvent(this.app.vault.on("rename", (File, Old) =>
		{
			try
			{
				for(const Session of this.State.Sessions) { for(const Message of Session.Messages) { if(Message.Sources) { Message.Sources = rename_sources(Message.Sources, Old, File.path); } if(Message.Quote?.SourceReferences) { Message.Quote.SourceReferences = rename_sources(Message.Quote.SourceReferences, Old, File.path); } } }
				this.history_changed(); this.NoteSessions?.rename(Old, File.path); this.observe_note_file(); this.persist_background();
			}
			catch(ErrorValue) { this.NoteSessionError = error_text(ErrorValue); this.refresh(); }
		}));
		const Resume = () => { if(!this.Unloaded && this.Connection instanceof RemoteConnection && typeof document !== "undefined" && document.visibilityState !== "hidden") { this.Connection.resume(); } };
		if(typeof document !== "undefined") { this.registerDomEvent(document, "visibilitychange", Resume); }
		if(typeof window !== "undefined") { this.registerDomEvent(window, "online", Resume); }
		this.registerEvent(this.app.vault.on("delete", File =>
		{
			try { this.NoteSessions?.forget(File.path); } catch(ErrorValue) { this.NoteSessionError = error_text(ErrorValue); this.refresh(); }
		}));
		this.registerEvent(this.app.workspace.on("layout-change", () => { this.sync_pdf_toolbar(); this.refresh(); }));
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
			this.sync_pdf_toolbar();
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
			this.refresh();
		});
	}

	private configure_note_sessions(): void
	{
		this.NoteSessions?.dispose(); this.NoteSessions = null; this.NoteSessionError = "";
		try
		{
			this.NoteSessions = new NoteSessions(localStorage, this.app.vault.getName(), this.Backend ? `backend:${this.backend_state_id()}` : this.Remote.Enabled ? `remote:${this.Remote.CacheId}` : "desktop", {
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
		if(this.Runtime.BlocksInput || this.Busy || this.ChatPreparing) { return "正在准备、回复或核对提交, 完成后切换"; }
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
		if(this.Backend) { return snapshot_instructions(this.State.Settings.Instructions, PdfInstructions); }
		return client_instructions(this.State.Settings.Instructions, this.Remote.Enabled ? null : {
			Vault: this.app.vault.getName(), Root: this.host_cwd(),
			Cli: this.obsidian_cli()
		}, PdfInstructions);
	}

	private host_cwd(): string
	{
		return this.Backend ? "" : this.Remote.Enabled ? this.HostInfo?.cwd ?? "" : (this.app.vault.adapter as FileSystemAdapter).getBasePath();
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
		if(this.BackendSaveBlocked) { throw new Error("回答尚未保存，请先重试保存后使用补全"); }
		if(Signal.aborted || this.Unloaded)
		{
			throw new Error("补全已取消");
		}
		await this.ensure_connection();
		if(this.Connection instanceof BackendConnection)
		{
			const Text = await this.Connection.complete({ Session: "completion-" + this.Session.Id, Messages: [
				{ Role: "system", Text: MathCompletionInstructions }, { Role: "user", Text: completion_prompt(Input) }
			] }, Signal);
			return parse_completion(Text);
		}
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
		const Generation = this.Generation;
		const Cli = this.State.Settings.CliPath.trim() || await this.Desktop!.discover_cli();
		if(Signal.aborted || Generation !== this.Generation) { throw new Error("补全已取消"); }
		return this.CompletionWorker!.complete(Cli, this.host_cwd(), Input, Options, Signal, Skill, this.LocalApiKey);
	}

	async ensure_math_skill(): Promise<SkillInput>
	{
		if(this.Backend) { throw new Error("当前使用插件内置数学规则; Codex 模式支持加载本机 math-writing 技能"); }
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
		this.cancel_pdf_box();
		if(this.CaptureTimer) { clearTimeout(this.CaptureTimer); this.CaptureTimer = null; }
		for(const {view} of this.app.workspace.getLeavesOfType(ViewType)) { if(view instanceof CodexView) { view.forget_attachment(); } }
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

	async open_sidebar(Connect = true): Promise<void>
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
		if(!Connect) { return; }
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
		const Device = this.Backend ? this.backend_state_id() : this.Remote.Enabled ? this.Remote.CacheId : "desktop";
		let Id = this.State.ActiveId;
		if(Key)
		{
			try { const Parts = JSON.parse(Key); if(!Array.isArray(Parts) || Parts.length !== 2 || Parts[0] !== Device) { return null; } Id = Parts[1]; } catch { return null; }
		}
		const Session = this.State.Sessions.find(S => S.Id === Id);
		return Session ? { Key: JSON.stringify([Device, Id]), Turns: [...new Set(Session.Messages.filter(M => M.Role !== "reasoning" && M.TurnId && M.CompletionStatus === "completed" && !M.ArchivedOnly).map(M => M.TurnId!))] } : null;
	}

	refresh(): void
	{
		if(this.Unloaded)
		{
			return;
		}
		if(this.EditHistoryDirty || this.LastEditSession !== this.Session || this.LastEditData !== this.Edits?.Store.Data)
		{
			this.EditHistoryDirty = false; this.LastEditSession = this.Session; this.LastEditData = this.Edits?.Store.Data;
			this.Edits?.consume(this.Session.Messages); this.Edits?.Cache.poll();
		}
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
	private persist_snapshot(State: SavedState, SyncRemote: boolean, Target = this.state_target(), CheckpointKey?: string, Current?: () => boolean): Promise<void>
	{
		let Data: SavedState = Current ? State : structuredClone(State);
		if(!Current) { normalize_outbox(Data); Data.SchemaVersion = 2; validate_saved_state(Data); }
		const Connection = Target.Connection instanceof RemoteConnection ? Target.Connection : null, Cursor = Connection?.cursor_snapshot() ?? 0;
		const QueueWrite = (Work: () => Promise<void>, Key?: string): Promise<void> => { this.SaveQueue = this.Writes.enqueue(Work, Key); return this.SaveQueue; };
		const Local = QueueWrite(async () =>
		{
			if(Current && !Current()) { return; }
			// A retry captures the latest state only inside its original scope and queue slot.
			if(Current) { Data=structuredClone(this.target_state(Target));normalize_outbox(Data);Data.SchemaVersion=2;validate_saved_state(Data); }
			// Preserve earlier durable acknowledgements, never import a future in-memory terminal state.
			if(await this.app.vault.adapter.exists(Target.Path))
			{
				const Durable = JSON.parse(await this.app.vault.adapter.read(Target.Path));
				if(Durable.Sync) { Data.Sync = merge_sync_metadata(Data.Sync, Durable.Sync); preserve_durable_resolved_messages(Data, Durable); }
				preserve_terminal_messages(Data,Durable);
			}
			await write_state_file(this.app.vault.adapter, Target.Path, Data);
		}, CheckpointKey);
		if(!Target.Remote || !Connection || !SyncRemote) { return Local; }
		return Local.then(async () =>
		{
			try { await Connection.sync_state(Data, Cursor); }
			finally
			{
				if(Data.Sync)
				{
					await QueueWrite(async () =>
					{
						// Merge acknowledgements only, never replay an old whole snapshot.
						const Fresh: SavedState = JSON.parse(await this.app.vault.adapter.read(Target.Path));
						Fresh.Sync = merge_sync_metadata(Fresh.Sync, Data.Sync!); normalize_outbox(Fresh); Fresh.SchemaVersion = 2; validate_saved_state(Fresh);
						await write_state_file(this.app.vault.adapter, Target.Path, structuredClone(Fresh));
						if(Target.Scope === this.local_scope() && !this.Unloaded) { this.State.Sync = merge_sync_metadata(this.State.Sync, Fresh.Sync!); }
					});
				}
			}
		});
	}

	private persist_background(): void
	{
		const Generation = this.Generation;
		void this.persist().catch(ErrorValue =>
		{
			if(!this.Unloaded && Generation === this.Generation) { this.Status = error_text(ErrorValue); this.refresh(); }
		});
	}
	private stream_checkpoint(Session: ChatSession, MessageId: string, AddedBytes: number): void
	{
		const Target = this.state_target(), Message = this.MessagesById.get(Session, MessageId);
		if(!Message || Message.CompletionStatus) { return; }
		const Key = JSON.stringify([Target.Scope, Session.Id, Message.TurnId ?? "", MessageId]);
		this.Checkpoints.offer(Key, AddedBytes, async Gate =>
		{
			if(Gate.Signal.aborted || this.Unloaded || Target.Scope !== this.local_scope() || this.State.DeletedSessionIds?.includes(Session.Id)) { return false; }
			let Wrote=false;
			try
			{
				await this.persist_snapshot(Target.State,false,Target,Key,()=>{const Current=Gate.is_current()&&!this.Unloaded&&Target.Scope===this.local_scope();Wrote=Current;return Current;});
				if(!Wrote){return false;}
				if(Gate.is_current()&&this.UnsavedCheckpoints.delete(Key)&&!this.Unloaded&&Target.Scope===this.local_scope()){this.Status="正文检查点已保存";this.refresh();}
			}
			catch(E)
			{
				this.UnsavedCheckpoints.add(Key);
				if(!this.Unloaded&&Target.Scope===this.local_scope()) { this.Status="正文尚未保存，正在重试存储："+error_text(E); this.refresh(); }
				throw E;
			}
		});
	}

	async set_remote_mode(Enabled: boolean): Promise<void>
	{
		this.check_connection_change();
		this.ChatPreparing = true;
		try { await this.switch_remote_mode(Enabled); }
		finally { this.ChatPreparing = false; this.refresh(); }
	}

	private check_connection_change(): void
	{
		const AlternateUncertain = this.Backend && this.Runtime.Stage === "submission-unknown";
		if((this.Runtime.BlocksInput && !AlternateUncertain) || this.Busy || this.ChatPreparing || this.SessionDeleting || this.NoteSessions?.Switching || this.Connecting)
		{
			throw new Error("请等待当前操作完成或停止回复后再切换连接");
		}
	}

	private configure_backend_state(): void
	{
		if(!this.Backend) { return; }
		const Model = backend_model(this.Backend), Current = this.State.Settings;
		const Effort = this.Backend.Kind === "api" && api_reasoning_supported(this.Backend.Provider) && Current.Model === Model ? Current.Effort : "";
		Object.assign(Current, { Model, Effort, Fast: false });
		for(const Operation of this.State.Sync?.Operations ?? [])
		{
			if(Operation.Status === "running") { update_operation(this.State.Sync!, Operation.Id, "submission-unknown", { ...this.local_operation_version(Operation), Error: "此前的直连或本机进程已关闭, 不自动重发" }); }
		}
		this.SkillStatus = "使用插件内置数学规则";
	}

	private async switch_remote_mode(Enabled: boolean, Backend: BackendProfile | null = null, RemoteOptions: Partial<RemoteConfig> = {}): Promise<void>
	{
		await this.persist(false);
		const Remote = !Backend && (Enabled || Platform.isMobileApp);
		const BackendId = Backend ? await instruction_hash(backend_identity(Backend)) : "";
		const RemoteNext = { ...this.Remote, ...RemoteOptions, Enabled: Remote };
		const Saved = await load_state_file(this.app.vault.adapter, this.state_path(Remote, BackendId, RemoteNext.CacheId), this.legacy_state_path(Remote, BackendId, RemoteNext.CacheId)) as SavedState | null;
		if(this.Unloaded) { throw new Error("插件已关闭"); }
		this.Generation++;
		this.close_connection();
		this.Runtime.finish();
		this.TurnId = null;
		this.Inline.clear();
		this.CompletionWorker?.close();
		this.Connecting = null;
		this.Remote = RemoteNext;
		this.Backend = Backend;
		this.BackendId = BackendId;
		this.BackendKey = "";
		if(this.Remote.Enabled || Backend) { this.LocalApiKey = undefined; }
		this.RemoteStatePath = this.state_path(true);
		this.save_remote_config();
		localStorage.setItem(this.BackendStorage, JSON.stringify(Backend));
		this.State = prune_sessions(Saved?.Sessions?.length ? Saved : { Settings: { ...this.State.Settings, Model: "", Effort: "", Fast: false, Completion: !Backend }, Sessions: [new_session()], ActiveId: "" });
		this.State.Settings.EditScope = edit_scope(this.State.Settings.EditScope);
		if(!this.State.Sessions.some(Value => Value.Id === this.State.ActiveId))
		{
			this.State.ActiveId = this.State.Sessions[0].Id;
		}
		if(!this.Remote.Enabled)
		{
			if(!Backend)
			{
				this.Desktop ??= await import("./desktop");
				this.CompletionWorker = new this.Desktop.CompletionService();
			}
			this.State.Sessions.forEach(Value => { Value.ThreadId = null; Value.InstructionsHash = ""; });
		}
		this.configure_backend_state();
		this.AnswerQuote = null;
		this.Models = [];
		this.CompletionStatus.setText(this.State.Settings.Completion ? "Codex 补全已开启" : "Codex 补全已关闭");
		this.configure_note_sessions(); this.observe_note_file();
		this.Status = Backend ? backend_name(Backend) : this.Remote.Enabled ? "独立远程会话, 连接后使用" : "本机桌面会话";
		this.refresh();
		await this.persist();
	}

	async start_backend(Input: unknown, Key = "", Catalog?: ApiCatalogModel[], SecretLink?: string): Promise<void>
	{
		let Profile = backend_profile(Input);
		if(Profile.Kind === "agent" && Platform.isMobileApp) { throw new Error("本机 Agent 需要 Windows"); }
		if(SecretLink && (Profile.Kind !== "api" || !this.ApiSecrets || Key.trim())) { throw new Error("请选择 Obsidian 密钥或填写临时 API Key，不能同时使用"); }
		const Supplied = Key.trim() || (SecretLink ? this.ApiSecrets!.read(SecretLink) : this.backend_secret(Profile));
		const Secret = Profile.Kind === "api" || Supplied && Profile.Agent !== "claude" ? direct_api_key(Supplied) : "";
		if(Secret && (JSON.stringify(Profile).includes(Secret) || SecretLink?.includes(Secret))) { throw new Error("请只在密钥值栏输入 API Key"); }
		this.check_connection_change();
		this.ChatPreparing = true;
		try
		{
			// Construct and validate the driver before replacing a working connection.
			const Prepared = await this.prepare_backend(Profile, Secret, Catalog);
			Profile = Prepared.Profile;
			const Same = this.Backend && backend_identity(this.Backend) === backend_identity(Profile) && !this.Remote.Enabled;
			await this.persist(false);
			const Id=await instruction_hash(backend_identity(Profile));
			const TargetPath=this.state_path(false,Id);
			const Saved=Same?this.State:await load_state_file(this.app.vault.adapter,TargetPath,this.legacy_state_path(false,Id)) as SavedState|null;
			const Next:SavedState=structuredClone(Saved?.Sessions?.length?Saved:{Settings:{...this.State.Settings,Model:"",Effort:"",Fast:false,Completion:false},Sessions:[new_session()],ActiveId:""});
			await apply_late_receipts(this.app.vault.adapter, TargetPath, Next);
			if(!Next.Sessions.some(S=>S.Id===Next.ActiveId)){Next.ActiveId=Next.Sessions[0].Id;}
			const Model=backend_model(Profile),OldModel=Next.Settings.Model;
			Object.assign(Next.Settings,{Model,Effort:OldModel===Model?Next.Settings.Effort:"",Fast:false});
			for(const S of Next.Sessions){S.ThreadId=null;S.InstructionsHash="";}
			for(const O of Next.Sync?.Operations??[]){if(O.Status==="running"){O.Status="submission-unknown";O.Error="原连接已停止等待，未重新提交";}}
			// Validate and read back the candidate before closing the original live driver.
			await write_state_file(this.app.vault.adapter,TargetPath,Next);
			if(this.Unloaded){throw new Error("插件已关闭，未激活候选连接");}
			localStorage.setItem(this.BackendStorage,JSON.stringify(Profile));
			this.Generation++;this.close_connection();this.Runtime.finish();this.TurnId=null;this.Busy=false;
			this.Inline.clear();this.CompletionWorker?.close();this.CompletionWorker=null;
			this.Remote.Enabled=false;this.Backend=Profile;this.BackendId=Id;this.State=Next;
			this.LocalApiKey=undefined;
			if(!Same) { this.AnswerQuote=null; }
			this.configure_note_sessions();this.observe_note_file();this.history_changed();
			this.BackendKey = Secret;
			this.BackendCatalog = Prepared.Catalog;
			this.BackendReasoning = Prepared.Reasoning;
			this.Connection = this.make_backend_connection(Profile, Prepared.Driver, Prepared.Reasoning.get(Profile.Model)?.Efforts);
			this.Models = this.backend_models(Profile);
			this.CatalogError = Prepared.Error;
			this.Status = `${backend_name(Profile)} · ${backend_model(Profile)}`;
			this.SkillStatus = "使用插件内置数学规则";
			this.Credentials.set(Profile, Secret);
			if(Profile.Kind === "api" && this.ApiSecrets && (SecretLink !== undefined || Key.trim() && this.ApiSecrets.alias(Profile)))
			{
				try { this.ApiSecrets.set(Profile, SecretLink ?? null); }
				catch { this.Status += "；Obsidian 密钥关联未更新，请检查设置"; }
			}
			try { this.Profiles?.save(Profile, "", Prepared.Catalog); }
			catch(E) { this.Status += "；连接可用，但配置尚未保存："+error_text(E); }
		}
		finally { this.ChatPreparing = false; this.refresh(); }
	}

	async start_local_codex(Key?: string): Promise<void>
	{
		if(Platform.isMobileApp) { throw new Error("移动版请连接电脑上的独立 Codex 服务"); }
		const ApiKey = Key === undefined ? undefined : openai_api_key(Key);
		this.check_connection_change();
		this.ChatPreparing = true;
		this.StartedAt = Date.now();
		this.Activity = "准备本机连接";
		this.refresh();
		try
		{
			this.Inline.clear();
			if(this.Remote.Enabled || this.Backend) { await this.switch_remote_mode(false); }
			this.Generation++;
			this.close_connection();
			this.CompletionWorker?.close();
			this.Models = [];
			this.CatalogError = "";
			this.LocalApiKey = ApiKey;
			await this.ensure_connection();
		}
		finally
		{
			this.ChatPreparing = false;
			this.Activity = "";
			this.refresh();
		}
	}

	async configure_remote(Url: string, Token: string, Transport = this.Remote.Transport ?? "browser"): Promise<void>
	{
		if(Transport !== "browser" && Transport !== "native") { throw new Error("未知网络传输方式"); }
		remote_url(Url);
		this.check_connection_change();
		this.ChatPreparing = true;
		try
		{
			const Changed = this.Remote.Url !== Url || this.Remote.Token !== Token;
			await this.switch_remote_mode(true, null, { Url, Token, Transport, ...(Changed ? { CacheId: crypto.randomUUID(), Cursor: 0, Server: "" } : {}) });
			await this.ensure_thread();
			this.Busy = !!this.TurnId;
		}
		finally { this.ChatPreparing = false; }
		this.refresh();
	}

	async update_run_settings(Model: string, Effort: string, Fast: boolean): Promise<void>
	{
		if(this.Runtime.BlocksInput || this.Busy || this.ChatPreparing || this.SessionDeleting)
		{
			return;
		}
		const Settings = this.State.Settings;
		if(this.Backend)
		{
			if(this.Backend.Kind !== "api") { return; }
			if(Model !== Settings.Model)
			{
				const Entry = this.BackendCatalog.find(M=>M.Id===Model);
				if(!Entry) { throw new Error("此模型不在当前连接目录中，请重新加载或保存配置"); }
				const Selected = select_api_model(this.Backend, Model, this.BackendCatalog, Effort);
				await this.start_backend(Selected.Profile, "", this.BackendCatalog);
				Effort = Selected.Effort;
			}
			if(Effort && !this.Models.find(M=>M.model===Model)?.supportedReasoningEfforts.some(Value => Value.reasoningEffort === Effort)) { return; }
			this.State.Settings.Effort = Effort;
			this.refresh();
			await this.persist();
			return;
		}
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

	async ensure_connection(Catalog?: ApiCatalogModel[]): Promise<void>
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
		this.Runtime.stage("connecting");
		this.Status = this.Backend ? `准备 ${backend_name(this.Backend)}...` : this.Remote.Enabled ? "连接独立远程 Codex..." : "连接本机 Codex...";
		this.refresh();
		const Work = (async () =>
		{
			let Backend = this.Backend;
			const ApiKey = this.Remote.Enabled || Backend ? undefined : this.LocalApiKey;
			const CliPath = this.Remote.Enabled || Backend ? "" : this.State.Settings.CliPath.trim() || await this.Desktop!.discover_cli();
			const Send = (Value: BrowserRequest) => requestUrl({ ...Value, throw: false });
			let Reasoning: ApiCatalogModel["Reasoning"], ReasoningError = "";
			const Prepared = Backend ? await this.prepare_backend(Backend, this.BackendKey || this.backend_secret(Backend), Catalog, true) : null;
			if(Prepared) { this.BackendCatalog=Prepared.Catalog; this.BackendReasoning=Prepared.Reasoning; Reasoning=Prepared.Reasoning.get(Backend!.Model); ReasoningError=Prepared.Error; }
			const Driver = Prepared?.Driver ?? null;
			if(Generation !== this.Generation || this.Unloaded)
			{
				throw new Error("连接已取消");
			}
			if(Prepared && Backend) { Backend = Prepared.Profile; this.Backend = Backend; localStorage.setItem(this.BackendStorage, JSON.stringify(Backend)); }
			const Adapter = this.app.vault.adapter;
			if(!this.Remote.Enabled && !Backend && !(Adapter instanceof FileSystemAdapter))
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
						for(const O of this.State.Sync?.Operations ?? []) { if(O.Attempted && ["received", "running"].includes(O.Status)) { update_operation(this.State.Sync!, O.Id, "submission-unknown", { Error: "连接中断, 保留原提交身份待核对" }); } }
						this.Busy = false;
						this.TurnId = null;
						this.Activity = "";
						this.Status = `${error_text(ErrorValue)}; 重连后核对会话`;
						this.Runtime.stage(this.State.Sync?.Operations.some(O => O.SessionId === this.State.ActiveId && O.Status === "submission-unknown") ? "submission-unknown" : "offline");
						this.refresh();
						this.persist_background();
					}
				};
			const Connection: RpcConnection = Backend && Driver ? this.make_backend_connection(Backend, Driver, Reasoning?.Efforts) : this.Remote.Enabled
				? new RemoteConnection((Path, Method, Body) => this.remote_http(Path, Method, Body), this.Remote, OnMessage, OnClosed, () => this.save_remote_config())
				: new this.Desktop!.CodexConnection(CliPath, this.host_cwd(), OnMessage, OnClosed, ApiKey);
			this.Connection = Connection;
			if(Connection instanceof RemoteConnection)
			{
				await Connection.connect();
				this.HostInfo = Connection.Info;
				if(this.HostInfo?.vault !== this.app.vault.getName())
				{
					throw new Error("远程服务绑定的 vault 与当前库不同");
				}
				const Restored = await Connection.restore_state(this.State, this.NoteSessions?.Data.Enabled ? this.NoteSessions.Data.Links.map(Link => Link.SessionId) : [], !this.NoteSessions?.Manual);
				if(Generation !== this.Generation || this.Unloaded) { throw new PreparationCancelled(); }
				this.merge_restored(Restored, true);
				Connection.set_recovery(() => this.recover_remote(Connection));
				this.restore_runtime();
				this.refresh();
			}
			await Connection.request("initialize", { clientInfo: { name: "obsidian_codex_sidebar", title: "Obsidian Codex Sidebar", version: this.manifest.version }, capabilities: { experimentalApi: true } });
			Connection.send({ method: "initialized", params: {} });
			if(ApiKey) { await authenticate_api_key(Connection, this.host_cwd(), ApiKey); }
			const Account = ApiKey ? { account: { type: "apiKey" } } : await Connection.request("account/read", { refreshToken: false });
			if(Generation !== this.Generation || this.Unloaded)
			{
				throw new Error("连接已取消");
			}
			if(!Account.account)
			{
				throw new Error("本机 Codex 尚未登录. 请先在 Codex 应用或 CLI 中登录");
			}
			const Legacy = ApiKey || Backend ? [] : this.State.Sessions.filter(Value => Value.LegacyThreadId);
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
			this.CatalogError = ReasoningError;
			try
			{
				let Cursor: string | null = null;
				do
				{
					const Page = await Connection.request("model/list", { limit: 100, includeHidden: false, cursor: Cursor });
					this.Models.push(...Page.data);
					Cursor = Page.nextCursor ?? null;
				} while(Cursor);
				if(Backend) { this.Models=this.backend_models(Backend); }
				if(!Backend) { Object.assign(this.State.Settings, initial_selection(this.State.Settings, this.Models)); }
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
			const Auth = Account.account.type === "chatgpt" ? "ChatGPT 登录" : Account.account.type === "apiKey" ? "API Key" : Account.account.type;
			this.Status = Backend ? `${backend_name(Backend)} 已配置, 首轮验证推理` : `${this.Remote.Enabled ? "独立远程已连接" : "本机 Codex 已连接"} (${Auth})`;
			if(Backend) { this.SkillStatus = "使用插件内置数学规则"; }
			else { await this.ensure_math_skill().catch(() => {}); }
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
				if(this.Runtime.Stage === "connecting") { this.Runtime.stage(this.Connection ? this.Runtime.Active ? "preparing" : "idle" : "offline"); }
			}
		}
	}

	private quote_ancestors(Session:ChatSession): string[]
	{
		const Ids:string[]=[], Seen=new Set([Session.Id]);let Id=Session.ParentId;
		while(Id&&!Seen.has(Id)) { Seen.add(Id);Ids.push(Id);Id=this.State.Sessions.find(S=>S.Id===Id)?.ParentId; }
		return Ids;
	}

	private async ensure_thread(Ticket?: PreparationTicket, ExcludeMessageId?: string, Target = this.state_target()): Promise<void>
	{
		await this.ensure_connection();
		if(!this.Backend) { await this.ensure_math_skill(); }
		if(Ticket) { this.Runtime.check(Ticket); }
		await this.ensure_session_history(Ticket?.SessionId ?? this.State.ActiveId);
		if(Ticket) { this.Runtime.check(Ticket); }
		if(Target.Scope !== this.local_scope() || this.Unloaded) { throw new PreparationCancelled(); }
		const State = this.target_state(Target), Session = State.Sessions.find(S => S.Id === (Ticket?.SessionId ?? State.ActiveId));
		if(!Session) { throw new PreparationCancelled(); }
		const Connection = this.Connection!; Target.Connection = Connection;
		const Visible = () => !this.Unloaded && Target.Scope === this.local_scope() && this.State.ActiveId === Session.Id && (!Ticket || this.Runtime.current(Ticket));
		const LiveId = this.LiveThreads.get(Session.Id);
		const Alternate = Connection instanceof BackendConnection;
		if(LiveId && !Alternate)
		{
			Session.ThreadId = LiveId;
			if(Visible()) { this.LoadedThread = LiveId; }
			return;
		}
		const Options = this.Backend ? { model: backend_model(this.Backend), serviceTier: "default", effort: undefined } : run_options(this.State.Settings, this.Models);
		const Instructions = this.work_instructions();
		let Existing: any = null;
		if(Target.Remote && Session.ThreadId)
		{
			Existing = await Connection.request("bridge/resume", { threadId: Session.ThreadId });
		}
		const Params =
		{
			cwd: this.host_cwd(),
			...(Target.Remote || Alternate ? { clientSessionId: Session.Id } : {}),
			ephemeral: true,
			dynamicTools: Alternate ? [] : [ObsidianTool, ...(!Target.Remote || (this.HostInfo as any)?.capabilities?.historyRead === 1 ? [history_read_tool(!Target.Remote || (this.HostInfo as any)?.capabilities?.historyReadBodyVersions === 1)] : [])],
			approvalPolicy: Alternate ? "never" : "on-request",
			approvalsReviewer: "user",
			sandbox: "read-only",
			developerInstructions: Instructions,
			...(Options.model ? { model: Options.model } : {}),
			serviceTier: Options.serviceTier,
			config: { model_reasoning_summary: "auto", ...(Options.effort ? { model_reasoning_effort: Options.effort } : {}) }
		};
		const PriorMessages = Session.Messages.filter(M => M.Id !== ExcludeMessageId);
		const Current = Session.Messages.find(M => M.Id === ExcludeMessageId), Required = [Current?.Quote?.MessageId, Current?.Quote?.RootMessageId].filter((Id): Id is string => !!Id && PriorMessages.some(M => M.Id === Id));
		verify_quoted_body(Current?.Quote,Session.Id,Session.Messages,this.quote_ancestors(Session));
		const Budget: HistoryBudgetOptions = { ModelContextWindow: this.BackendCatalog.find(M=>M.Id===Options.model)?.ContextWindow ?? (Session.EffectiveModel === Options.model ? Session.Usage?.modelContextWindow : undefined), ReservedUtf8Bytes: new TextEncoder().encode(Instructions).byteLength, CurrentMessage: Current, SessionId: Session.Id, MaxImages: 8, RequiredMessageIds: Required, UnresolvedMessageIds: State.Sync?.Operations.filter(O => O.SessionId === Session.Id && ["local", "received", "submission-unknown", "running"].includes(O.Status) && PriorMessages.some(M => M.Id === O.MessageId)).map(O => O.MessageId), UserConstraints: ["完整答案最小修补; 思路沿原路线; 工具只读; 只有当前客户端审核后写回. 旧消息来源与未知提交状态不补造."] };
		Budget.HistoryReadAvailable = Alternate ? this.backend_history_tools() : !Target.Remote || (this.HostInfo as any)?.capabilities?.historyRead === 1;
		Budget.HistoryReadBodyVersionsAvailable = Alternate ? this.backend_history_tools() : !Target.Remote || (this.HostInfo as any)?.capabilities?.historyReadBodyVersions === 1;
		if(Alternate && Budget.HistoryReadAvailable) { Budget.ReservedUtf8Bytes=(Budget.ReservedUtf8Bytes??0)+32000; }
		quote_input_ready(Current?.Quote,Session.Id,Session.Messages,Budget.HistoryReadBodyVersionsAvailable===true,this.quote_ancestors(Session));
		const Plan = Existing ? null : plan_history_input(PriorMessages, Budget);
		if(Target.Remote && Plan?.Ledger.OmittedMessageIds.length && (this.HostInfo as any)?.capabilities?.historyRead !== 1) { throw new Error("完整历史已超过保守恢复预算, 当前旧桥没有授权历史分页读取能力; 请升级桥或明确分段/新建会话. 原历史保留"); }
		const History = Plan ? build_history_input(PriorMessages, Budget, await this.prepare_pdf(history_pdf_refs(Plan.Messages), Target)).Items : [];
		if(Plan) { this.LastInputLedger.set(Session.Id, Plan.Ledger); } else { this.LastInputLedger.delete(Session.Id); }
		if(Ticket) { this.Runtime.check(Ticket); }
		const Result = Existing ?? await Connection.request("thread/start", Params);
		if(Result.thread.ephemeral !== true || Result.thread.path)
		{
			throw new Error("本机 Codex 未返回临时会话. 已停止发送, 请升级支持 ephemeral 的 CLI.");
		}
		Session.ThreadId = Result.thread.id;
		Session.Private = true;
		if(Visible()) { this.LoadedThread = Result.thread.id; }
		if(!Existing)
		{
			Session.InstructionsHash = "";
		}
		if(History.length && !Existing)
		{
			await Connection.request("thread/inject_items", { threadId: Result.thread.id, items: History });
		}
		if(Target.Scope === this.local_scope() && Connection === this.Connection) { this.LiveThreads.set(Session.Id, Result.thread.id); }
		Session.EffectiveModel = Result.model ?? Result.thread.model ?? "";
		Session.EffectiveEffort = Result.reasoningEffort ?? Options.effort;
		Session.EffectiveTier = Result.serviceTier ?? "default";
		const Latest = this.target_state(Target).Sessions.find(S => S.Id === Session.Id);
		if(Latest && Latest !== Session) { Object.assign(Latest, { ThreadId: Session.ThreadId, Private: true, InstructionsHash: Session.InstructionsHash, EffectiveModel: Session.EffectiveModel, EffectiveEffort: Session.EffectiveEffort, EffectiveTier: Session.EffectiveTier }); }
		if(Visible()) { this.Model = Session.EffectiveModel ?? ""; }
		for(const Turn of Result.thread.turns ?? [])
		{
			for(const Item of Turn.items ?? [])
			{
				if(Item.type === "agentMessage")
				{
					const Message = this.assistant_message(Item.id, Turn.id, "assistant", Session);
					Message.Text = Item.text;
					if(["commentary", "final_answer"].includes(Item.phase)) { Message.Phase = Item.phase; }
					if(["completed", "interrupted", "failed"].includes(Turn.status)) { Message.CompletionStatus = Turn.status; }
				}
				if(Item.type === "reasoning" && Item.summary?.length)
				{
					this.assistant_message(Item.id, Turn.id, "reasoning", Session).Text = Item.summary.join("\n\n");
				}
			}
			if(Turn.status === "inProgress" && Visible())
			{
				this.TurnId = Turn.id;
				this.Activity = "思考中";
				this.StartedAt = Date.now();
			}
		}
		if(Result.thread.turns?.length) { this.history_changed(Session.Id); }
		if(this.Busy && Visible())
		{
			this.Activity = "保存会话";
			this.refresh();
		}
		await this.save_target(Target, true);
	}

	private async prepare_pdf(Refs: PdfImageRef[], Target?: StateTarget): Promise<Map<string, string>>
	{
		const Urls = new Map<string, string>();
		if(!Refs.length) { return Urls; }
		const Model = selected_model(this.State.Settings, this.Models);
		if(Model?.inputModalities && !Model.inputModalities.includes("image")) { throw new Error("当前模型不支持图像, 请明确选择支持图片的模型再提问 PDF"); }
		this.Activity = "准备 PDF 页图快照"; this.refresh();
		let Remote: { present: string[]; epoch: string } | null = null;
		const RemoteMode = Target?.Remote ?? this.Remote.Enabled, Connection = Target?.Connection ?? this.Connection;
		if(RemoteMode)
		{
			if(this.HostInfo?.pdfPageImages !== 1) { throw new Error("Windows 远程桥尚不支持 PDF 页图, 请更新桥到 0.8.0 后重连; 本轮未提交"); }
			if(Refs.some(R => R.Kind === "region") && (this.HostInfo as any)?.capabilities?.pdfRegions !== 1) { throw new Error("当前 Windows 桥未协商 PDF 局部图能力, 请升级独立桥; 不改用整页或当前页面替代原图"); }
			Remote = await Connection!.request("bridge/pdf-images", { action: "has", ids: Refs.map(Ref => Ref.Id) });
		}
		for(const Ref of Refs)
		{
			if(!Remote?.present.includes(Ref.Id) || Ref.Kind === "region")
			{
				const Data = await this.PdfImages.get(Ref.Id);
				const Info = jpeg_info(Data);
				if(Info.Width !== Ref.Width || Info.Height !== Ref.Height || Info.Bytes !== Ref.Bytes) { throw new Error("PDF 页图与保存快照不一致"); }
				if(Remote) { await Connection!.request("bridge/pdf-images", { action: "put", id: Ref.Id, data: Data, epoch: Remote.epoch, ...(Ref.Kind ? { origin: { Kind: Ref.Kind, ...(Ref.Region ? { Region: Ref.Region } : {}) } } : {}) }); }
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

	async send_chat(Question: string, Context: ContextSnapshot | null, Quote: AnswerQuote | null, Options: { Mode?: ComposeAction; Scope?: EditScope; Role?: EditRole; MaterialOrigin?: "explicit" | "automatic" } = {}): Promise<boolean>
	{
		if(this.BackendSaveBlocked || this.Busy || this.ChatPreparing || this.Runtime.BlocksInput || this.SessionDeleting || this.Capture.Suspended || this.NoteSessions?.Switching) { return false; }
		if(Options.Mode !== "edit") { return this.send_message(Question, Context, Quote, null, undefined, { MaterialOrigin: Options.MaterialOrigin }); }
		const Ticket = this.Runtime.begin(this.local_scope(), this.Session.Id);
		this.ChatPreparing = true; this.StartedAt = Date.now(); this.Activity = "准备修改目标"; this.refresh();
		try
		{
			if(!Question.trim()) { throw new Error("请写明修改要求"); }
			if(!this.Edits) { throw new Error("本设备修改记录不可用, 请先导出检查, 不会覆盖旧数据"); }
			if(Quote) { throw new Error("当前引用的是助手回答, 请取消引用并捕获要修改的笔记"); }
			if(!this.State.Settings.AttachContext) { throw new Error("修改需要附带目标原文, 请打开附带上下文并捕获笔记"); }
			if(!Context)
			{
				this.Capture.track_view(); Context = await preparation_step(this.Capture.capture("选区", undefined, Ticket.Controller.signal), Ticket, this.Runtime) ?? await preparation_step(this.Capture.capture("当前位置", undefined, Ticket.Controller.signal), Ticket, this.Runtime);
			}
			if(!Context) { throw new Error("请先打开 Markdown 并捕获需要修改的选区或段落"); }
			return await preparation_step(this.Edits.request(Question.trim(), structuredClone(Context), Options.Scope ?? edit_scope(this.State.Settings.EditScope), Options.Role ?? "auto", Ticket.Controller.signal), Ticket, this.Runtime);
		}
		catch(ErrorValue)
		{
			if(Ticket.Controller.signal.aborted || ErrorValue instanceof PreparationCancelled) { return false; }
			if(this.Runtime.current(Ticket)) { this.Runtime.finish(Ticket); this.show_error(ErrorValue); } return false;
		}
		finally { if(!this.Runtime.Active || this.Runtime.Active === Ticket) { this.ChatPreparing = false; if(!this.Busy) { this.Activity = ""; } this.refresh(); } }
	}

	async send_message(Question: string, Context = this.State.Settings.AttachContext ? this.Capture.Snapshot : null, Quote: AnswerQuote | null = null, Task: TaskSpec | null = null, Resume?: { MessageId: string; OperationId: string }, Material: { MaterialOrigin?: "explicit" | "automatic"; ContinuesMessageId?: string } = {}): Promise<boolean>
	{
		if(this.BackendSaveBlocked) { this.Status = "回答已收到，尚未保存；请先重试保存"; this.refresh(); return false; }
		if(Task && Task.Action !== "edit") { new Notice("旧版学习任务仅保留历史记录. 请通过提问或生成修改预览发起新请求."); return false; }
		if(this.Unloaded || this.Busy || this.SessionDeleting || this.NoteSessions?.Switching || (this.ChatPreparing && Task?.Action !== "edit") || this.Capture.Suspended || !Question.trim()) { return false; }
		const ParentTicket = Task?.Action === "edit" && this.Runtime.Active?.SessionId === this.Session.Id && this.Runtime.Stage === "preparing" ? this.Runtime.Active : null;
		if(this.Runtime.BlocksInput && !ParentTicket) { return false; }
		const Ticket = ParentTicket ?? this.Runtime.begin(this.local_scope(), this.Session.Id), Target = this.state_target();
		this.Busy = true; this.TurnId = null; this.Activity = "保存原始问题与待发送状态"; this.StartedAt = Date.now(); this.refresh();
		let Submitted = false, Message: ChatMessage | undefined, Intent: SendIntent | undefined, Operation: SendOperation | undefined, RecoveredTurn = false;
		try
		{
			const Session = this.target_state(Target).Sessions.find(S => S.Id === Ticket.SessionId)!;
			const PublicTask = Task ? structuredClone(Task) : undefined; if(PublicTask?.Target) { PublicTask.Target.Before = null; }
			if(Resume)
			{
				Message = Session.Messages.find(M => M.Id === Resume.MessageId && M.OperationId === Resume.OperationId);
				Operation = this.State.Sync?.Operations.find(O => O.Id === Resume.OperationId); Intent = this.State.Outbox?.find(I => I.Id === Resume.OperationId);
				if(!Message || (!Operation && !Intent) || Operation?.Attempted) { throw new Error("原发送记录已变化, 不复用身份盲重发"); }
			}
			else
			{
				const Prompt = Task ? task_prompt(Task) : build_prompt(Question.trim(), Context, Quote);
				if(Prompt.length > 95000) { throw new Error("本轮输入超过已核对的协议上限, 请缩小来源或分段; 历史不删除"); }
				Message = { Id: crypto.randomUUID(), Role: "user", ...Material, Text: Task ? question_label(Task) : Question.trim(), Prompt, Context: Context ? structuredClone(Context) : null, Quote: Quote ? structuredClone(Quote) : null, Task: PublicTask, ContextLabel: Quote ? "追问选中的回答 / 渲染选区 + 原回答 Markdown" : Context ? `${Context.Path} / ${Context.Kind} / ${Context.Mapping}` : undefined, Sources: [...(Context ? source_reference(Context, Target.Remote ? "client-snapshot" : "desktop-read") : []), ...structuredClone(Quote?.SourceReferences??[])] };
				const Refs = message_pdf_refs(Message); if(Refs.length > 2) { throw new Error("每轮最多两张 PDF 图片, 整页和局部图共同占用名额"); }
				Intent = await send_intent(Target.Scope, Session.Id, Message.Id, { Prompt, Context: Message.Context, Quote: Message.Quote, Task: PublicTask, ...(Message.ContinuesMessageId?{ContinuesMessageId:Message.ContinuesMessageId}:{}), ...(Message.MaterialOrigin?{MaterialOrigin:Message.MaterialOrigin}:{}), PdfRefs: Refs, Run: { Model: this.State.Settings.Model, Effort: this.State.Settings.Effort, Fast: this.State.Settings.Fast, Scope: Target.Scope, ...(this.Backend ? { Backend: structuredClone(this.Backend) } : {}) } });
				this.Runtime.check(Ticket); Message.OperationId = Intent.Id; Ticket.OperationId = Intent.Id;
				const Latest = this.target_state(Target).Sessions.find(S => S.Id === Ticket.SessionId);
				if(!Latest) { throw new PreparationCancelled(); }
				Latest.Messages.push(Message); (this.target_state(Target).Outbox ??= []).push(Intent); if(Latest.Title === "新会话") { Latest.Title = Question.trim().slice(0, 24); }
			}
			Ticket.OperationId = Operation?.Id ?? Intent!.Id;
			Target.OperationId = Ticket.OperationId;
			await this.save_target(Target); this.Runtime.check(Ticket);
			this.Activity = "准备会话"; this.refresh();
			await preparation_step(this.ensure_connection(), Ticket, this.Runtime); Target.Connection = this.Connection;
			const State = this.target_state(Target); let CurrentSession = State.Sessions.find(S => S.Id === Ticket.SessionId)!;
			Message = CurrentSession.Messages.find(M => M.Id === Message!.Id)!;
			const Scope = this.Connection instanceof RemoteConnection ? this.Connection.scope() : Target.Scope;
			Operation = State.Sync?.Operations.find(O => O.Id === Ticket.OperationId) ?? await create_send_operation(Scope, CurrentSession.Id, Message.Id, Intent?.Input ?? Operation!.Input, Ticket.OperationId);
			this.Runtime.check(Ticket);
			const Sync = ensure_sync(this.target_state(Target), Scope);
			Operation = Sync.Operations.find(O => O.Id === Operation!.Id) ?? Operation;
			if(!Sync.Operations.some(O => O.Id === Operation!.Id)) { Sync.Operations.push(Operation); }
			await this.save_target(Target); this.Runtime.check(Ticket);
			this.target_state(Target).Outbox = this.target_state(Target).Outbox?.filter(I => I.Id !== Operation!.Id);
			await preparation_step(this.ensure_thread(Ticket, Message.Id, Target), Ticket, this.Runtime);
			CurrentSession = this.target_state(Target).Sessions.find(S => S.Id === Ticket.SessionId)!; Message = CurrentSession?.Messages.find(M => M.Id === Message!.Id);
			Operation = this.target_state(Target).Sync?.Operations.find(O => O.Id === Ticket.OperationId) ?? Operation;
			if(!CurrentSession || !Message) { throw new PreparationCancelled(); }
			if(this.TurnId) { RecoveredTurn = true; throw new Error("已恢复原来正在运行的回复; 新问题仅本地保存, 未提交推理"); }
			this.Activity = this.Backend ? "准备数学工作说明" : "检查 math-writing"; this.refresh();
			const Skill = this.Backend ? null : await preparation_step(this.ensure_math_skill(), Ticket, this.Runtime);
			const Instructions = this.work_instructions(), Hash = await preparation_step(instruction_hash(Instructions), Ticket, this.Runtime);
			if(CurrentSession.InstructionsHash !== Hash)
			{
				this.Activity = "加载工作说明"; this.refresh();
				await preparation_step(Target.Connection!.request("thread/inject_items", { threadId: CurrentSession.ThreadId, items: instruction_items(Instructions) }), Ticket, this.Runtime);
				CurrentSession.InstructionsHash = Hash; await this.save_target(Target);
			}
			if(Task?.Action === "edit") { await this.Edits?.register(Task); }
			const InputLedger = this.LastInputLedger.get(CurrentSession.Id);
			Message.InputLedger = InputLedger ? capture_history_ledger(InputLedger, CurrentSession.Messages, { Scope: Operation!.Scope, SessionId: CurrentSession.Id, OperationId: Operation!.Id }) : undefined;
			const Refs = message_pdf_refs(Message), Images = image_inputs(Refs, await preparation_step(this.prepare_pdf(Refs, Target), Ticket, this.Runtime));
			this.Runtime.check(Ticket); this.Activity = "保存提问与待同步操作"; this.refresh(); await preparation_step(this.save_target(Target, true), Ticket, this.Runtime);
			Operation = this.target_state(Target).Sync?.Operations.find(O => O.Id === Ticket.OperationId);
			if(!Operation || Operation.Conflicts?.length) { throw new Error("原发送操作缺失或有冲突, 不自动提交"); }
			const Chosen = ((Operation.Input as any)?.Run ?? this.State.Settings), Settings = { ...this.State.Settings, Model: Chosen.Model || this.State.Settings.Model,
				Effort: this.Backend ? Chosen.Effort ?? this.State.Settings.Effort : Chosen.Effort || this.State.Settings.Effort, Fast: Chosen.Fast ?? this.State.Settings.Fast };
			const BodyVersions = this.Backend ? this.backend_history_tools() : !Target.Remote || (this.HostInfo as any)?.capabilities?.historyReadBodyVersions === 1;
			quote_input_ready(Message.Quote,CurrentSession.Id,CurrentSession.Messages,BodyVersions,this.quote_ancestors(CurrentSession));
			const DerivedPrompt = derived_message_prompt(Message);
			if(Target.Remote && !BodyVersions && DerivedPrompt !== Message.Prompt) { throw new Error("当前桥不支持已保存引用的派生输入校验, 请升级桥; 原 Prompt 和来源保留"); }
			if(Chosen.Scope && Chosen.Scope !== Target.Scope || Chosen.Backend && JSON.stringify(Chosen.Backend) !== JSON.stringify(this.Backend)) { throw new Error("本轮冻结的连接与活动 driver 不同，请恢复原配置或明确重发；原输入保留"); }
			if(this.Backend && Settings.Model !== backend_model(this.Backend)) { throw new Error("已保存操作使用另一模型, 请恢复原模型或明确建立重发分支"); }
			if(this.Backend && Settings.Effort && !selected_model(Settings, this.Models)?.supportedReasoningEfforts.some(Value => Value.reasoningEffort === Settings.Effort))
			{
				throw new Error("当前目录无法确认本轮的思考档次. 请重连核对, 或用可用档次明确重发.");
			}
			const Options = this.Backend ? { model: Settings.Model, serviceTier: "default", effort: Settings.Effort || undefined } : run_options(Settings, this.Models);
			const Params = { threadId: CurrentSession.ThreadId, input: [...(Skill ? skill_input(DerivedPrompt, Skill) : [{ type: "text", text: DerivedPrompt }]), ...Images], ...Options };
			let Result: any;
			const BeforePost = async () =>
			{
				this.Runtime.check(Ticket);
				Operation!.ThreadId = Params.threadId ?? undefined;
				const Current = this.target_state(Target).Sync!; update_operation(Current, Operation!.Id, "submission-unknown", Operation!);
				await this.save_target(Target); this.Runtime.check(Ticket);
				Submitted = true; Ticket.Submitted = true; this.Runtime.stage("submission-unknown", Ticket); this.Activity = "提交推理, 等待接收凭证"; this.refresh();
			};
			if(Target.Connection instanceof RemoteConnection)
			{
				const Work = Target.Connection.request_operation(Operation, Params, BeforePost, Ticket.Controller.signal).then(Response => this.commit_send_receipt(Target, Operation!, Response.result, Response.operation));
				Result = await preparation_step(Work, Ticket, this.Runtime);
			}
			else
			{
				Operation.Request = structuredClone(Params); Operation.RequestDigest = await content_digest(Params); Operation.Attempted = true; Operation.Status = "submission-unknown"; Operation.ThreadId = CurrentSession.ThreadId ?? undefined;
				await BeforePost(); Result = await preparation_step(Target.Connection!.request("turn/start", Params).then(R => this.commit_send_receipt(Target, Operation!, R)), Ticket, this.Runtime);
			}
			if(!Result?.turn?.id) { throw new Error("提交已有凭证但尚无可确认的回合ID, 请核对操作状态, 不自动重发"); }
			Operation = this.target_state(Target).Sync?.Operations.find(O => O.Id === Ticket.OperationId) ?? Operation;
			Operation.Result = structuredClone(Result); Operation.TurnId = Result.turn.id; Operation.ThreadId = Params.threadId ?? undefined;
			const FinalSession = this.target_state(Target).Sessions.find(S => S.Id === Ticket.SessionId), FinalMessage = FinalSession?.Messages.find(M => M.Id === Message!.Id);
			if(FinalMessage) { FinalMessage.TurnId = Result.turn.id; this.history_changed(Ticket.SessionId, [FinalMessage.Id]); } else if(!FinalSession) { Operation.SessionDeleted = true; } else if(message_deleted(this.target_state(Target), Ticket.SessionId, Operation.MessageId)) { Operation.MessageDeleted = true; }
			if(FinalSession) { FinalSession.EffectiveModel = Options.model; FinalSession.EffectiveEffort = Options.effort; FinalSession.EffectiveTier = Options.serviceTier; }
			await this.save_target(Target);
			if(this.Runtime.current(Ticket) && !this.Unloaded && this.State.ActiveId === Ticket.SessionId)
			{
				this.Model = Options.model; this.Busy = Operation.Status === "running"; this.TurnId = this.Busy ? Result.turn.id : null; this.ChatPreparing = false;
				if(this.Busy) { this.Runtime.stage("generating", Ticket); this.Status = `${this.Backend ? backend_name(this.Backend) : "Codex"} 正在回答...`; this.Activity = "思考中"; } else { this.Runtime.finish(Ticket); this.Activity = ""; }
				this.refresh();
			}
			if(Target.Connection instanceof BackendConnection) { Target.Connection.begin_turn(Result.turn.id); }
			return true;
		}
		catch(ErrorValue)
		{
			const Cancelled = Ticket.Controller.signal.aborted || ErrorValue instanceof PreparationCancelled;
			if(Ticket.OperationId)
			{
				this.update_run_operation(Target, Ticket.OperationId, Submitted ? "submission-unknown" : Cancelled ? "cancelled" : "local", { Error: error_text(ErrorValue) });
				try { await this.save_target(Target); } catch { /* Original disk intent remains recoverable; no inference retry. */ }
			}
			if(this.Runtime.current(Ticket) && !this.Unloaded)
			{
				this.Busy = RecoveredTurn; this.ChatPreparing = false;
				if(RecoveredTurn) { this.Runtime.stage("generating", Ticket); }
				else if(Submitted) { this.Runtime.stage("submission-unknown", Ticket); this.Activity = "结果待核对"; }
				else { this.Runtime.finish(Ticket); this.TurnId = null; this.Activity = ""; }
				this.Status = Submitted ? "推理提交结果待核对, 原问题已保存, 不自动重发" : error_text(ErrorValue); this.refresh();
				if(!Cancelled) { new Notice(this.Status, 7000); }
			}
			return Submitted;
		}
	}

	async stop_turn(): Promise<void>
	{
		const Pending = this.State.Sync?.Operations.find(O => O.Id === this.Runtime.Active?.OperationId) ?? this.State.Sync?.Operations.find(O => O.SessionId === this.State.ActiveId && ["running", "submission-unknown"].includes(O.Status));
		if(["preparing", "connecting", "recovering"].includes(this.Runtime.Stage) && !this.Runtime.Active?.Submitted && !Pending?.Attempted)
		{
			const Ticket = this.Runtime.cancel_preparation(); this.Busy = false; this.ChatPreparing = false; this.Activity = ""; this.Status = "准备已取消, 草稿、引用和来源保留";
			if(Ticket?.OperationId) { const Target = this.state_target(); this.update_run_operation(Target, Ticket.OperationId, "cancelled", { Error: "用户取消准备, 未提交新的推理" }); await this.save_target(Target); }
			this.refresh(); return;
		}
		if(this.Backend && Pending)
		{
			const Target=this.state_target();
			this.update_run_operation(Target,Pending.Id,Pending.Status,{WaitStopped:true});
			if(Pending.TurnId && this.Connection) { await this.Connection.request("turn/interrupt",{threadId:Pending.ThreadId,turnId:Pending.TurnId}).catch(()=>{}); }
			this.update_run_operation(Target,Pending.Id,"submission-unknown",{Error:"已停止本地等待；未确认服务端取消"});
			this.Runtime.finish();this.Busy=false;this.ChatPreparing=false;this.TurnId=null;this.Activity="";this.Status="已停止等待，原结果待核对；不会自动重发";
			await this.save_target(Target);this.refresh();return;
		}
		if(this.Runtime.Stage === "submission-unknown" || this.Runtime.Stage === "recovering" && !this.TurnId)
		{
			const Id = this.Runtime.Active?.OperationId ?? this.State.Sync?.Operations.find(O => O.SessionId === this.State.ActiveId && O.Status === "submission-unknown")?.Id;
			if(Id) { await this.reconcile_operation(Id); } else { new Notice("提交是否成功尚不明确, 请重连核对. 取消本地请求不等于服务端停止"); } return;
		}
		if(!this.TurnId || !this.Connection) { return; }
		const TurnId = this.TurnId, ThreadId = this.Session.ThreadId;
		this.Runtime.stage("stopping"); this.Status = "正在请求停止, 等待后台确认"; this.Activity = "正在停止"; this.refresh();
		try { await this.Connection.request("turn/interrupt", { threadId: ThreadId, turnId: TurnId }); }
		catch(ErrorValue) { this.Status = "停止请求结果需核对: " + error_text(ErrorValue); this.Runtime.stage("submission-unknown"); this.refresh(); }
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
			for(const Intent of Plan.State.Outbox ?? []) { if(Intent.SessionId === Id && ["local", "received"].includes(Intent.Status)) { Intent.Status = "cancelled"; Intent.Error = "原会话已删除, 不恢复或提交"; } }
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
				try { await this.persist_snapshot(this.State, true); }
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
		if((this.Runtime.BlocksInput && (Automatic || this.Runtime.Stage !== "submission-unknown")) || this.Busy || this.ChatPreparing || this.SessionDeleting || (!Automatic && this.NoteSessions?.Switching))
		{
			new Notice("请先停止当前回复");
			return;
		}
		const Choice = ++this.SessionChoice, Scope = this.local_scope();
		if(Id)
		{
			if(!this.State.Sessions.some(Value => Value.Id === Id)) { throw new Error("选择的会话已不存在"); }
			await this.ensure_session_history(Id);
			if(Choice !== this.SessionChoice || Scope !== this.local_scope() || this.Unloaded) { return; }
			if(!this.State.Sessions.some(Value => Value.Id === Id) || this.State.DeletedSessionIds?.includes(Id)) { throw new Error("加载期间会话已删除, 未恢复旧会话"); }
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
		this.Runtime.finish();
		this.LoadedThread = null;
		this.TurnId = null;
		this.Model = "";
		this.Activity = "";
		this.Status = this.Session.Messages.length ? "历史会话, 发送后继续" : "新会话, 可以提问";
		this.restore_runtime();
		if(this.Runtime.Stage === "submission-unknown") { this.Status = "本会话有提交结果待核对; 原问题保留, 不自动重发"; }
		await this.persist(!Automatic);
		this.refresh();
	}

	async continue_answer(Id: string): Promise<boolean>
	{
		const Scope=this.local_scope(), SessionId=this.Session.Id;
		await this.ensure_session_history(SessionId);
		if(Scope!==this.local_scope() || SessionId!==this.Session.Id) { throw new Error("会话已变化，请返回原回答"); }
		const Reply=this.Session.Messages.find(M=>M.Id===Id && M.Role==="assistant");
		if(!Reply || !["partial","unknown"].includes(Reply.CompletionStatus??"") || !Reply.Text) { throw new Error("此回答没有可继续的部分正文"); }
		const Original=this.Session.Messages.find(M=>M.Role==="user" && M.TurnId===Reply.TurnId);
		if(!Original) { throw new Error("原问题缺失，未用当前文档补造"); }
		const Question="请沿原思路继续下面尚未完成的回答。不要重发原请求，不声称此前内容完整或已验证；若需修订请说明。\n\n原问题：\n"+Original.Text+"\n\n已有部分正文：\n"+Reply.Text;
		return this.send_message(Question,Original.Context??null,Original.Quote??null,null,undefined,{MaterialOrigin:Original.MaterialOrigin,ContinuesMessageId:Id});
	}

	async resend_message(Id: string, Text?: string): Promise<boolean>
	{
		const SessionId = this.State.ActiveId, Scope = this.local_scope(), Choice = this.SessionChoice;
		await this.ensure_session_history(SessionId);
		if(Scope !== this.local_scope() || this.State.ActiveId !== SessionId || Choice !== this.SessionChoice || this.Unloaded) { throw new Error("读取期间会话已切换, 未重发其他会话的内容"); }
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
		this.Runtime.finish(); this.restore_runtime();
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
		this.cancel_pdf_box();
		try
		{
			this.Capture.track_view();
			const Scope=this.draft_scope(), SessionId=this.Session.Id;
			const Snapshot = await this.Capture.capture("当前位置");
			if(!Snapshot)
			{
				new Notice("请先打开 Markdown 或 PDF. 无法定位 PDF 页时可点击“选择 PDF 页”");
				return;
			}
			await this.open_sidebar(false);
			if(!this.accept_captured_material(Snapshot,Scope,SessionId)) { return; }
			this.State.Settings.AttachContext = true;
			this.refresh();
			await this.persist();
		}
		catch(ErrorValue) { this.show_error(ErrorValue); }
	}

	open_pdf(): void
	{
		this.cancel_pdf_box();
		const Scope=this.draft_scope(), SessionId=this.Session.Id;
		new PdfPageModal(this.app, this.Capture, async Snapshot =>
		{
			await this.open_sidebar(false);
			if(!this.accept_captured_material(Snapshot,Scope,SessionId)) { throw new Error("捕获期间会话已切换，未附到新问题"); }
			this.State.Settings.AttachContext = true; this.refresh(); await this.persist(); await this.open_sidebar();
		}).open();
	}

	can_capture_pdf_box(): boolean
	{
		return this.pdf_box_view() !== null;
	}

	private pdf_box_view(): (FileView & { file: TFile }) | null
	{
		const Active = this.app.workspace.activeLeaf?.view;
		const View = note_file_path(Active) ? Active : this.app.workspace.getMostRecentLeaf()?.view;
		return is_pdf_view(View) && View.file && View.containerEl.isConnected ? View as FileView & { file: TFile } : null;
	}

	private cancel_pdf_box(): void
	{
		this.PdfBoxCapture?.Abort.abort(); this.PdfBoxCapture = null;
		this.PdfToolbar.set_active(null);
	}

	private sync_pdf_toolbar(): void
	{
		if(this.Unloaded) { return; }
		const Box = this.PdfBoxCapture;
		if(Box && (!Box.View.containerEl.isConnected || Box.View.file !== Box.File)) { this.cancel_pdf_box(); }
		this.PdfToolbar.sync(this.app.workspace.getLeavesOfType("pdf").map(Leaf => Leaf.view).filter(is_pdf_view));
	}

	open_pdf_box(View: FileView | null = this.pdf_box_view()): void
	{
		if(!is_pdf_view(View) || !View.file || !View.containerEl.isConnected) { new Notice("请先打开要框选的 PDF"); return; }
		if(this.Capture.Suspended) { new Notice("请等待当前 PDF 缓存操作结束"); return; }
		this.cancel_pdf_box();
		if(this.CaptureTimer) { clearTimeout(this.CaptureTimer); this.CaptureTimer = null; }
		const Scope=this.draft_scope(), SessionId=this.Session.Id;
		const File = View.file, Abort = new AbortController();
		const Capture = { View, File, Abort };
		const { mtime: Stamp, size: Size } = File.stat, Path = File.path;
		this.PdfBoxCapture = Capture;
		this.PdfToolbar.set_active(View);
		try
		{
			if(Platform.isMobile) { this.app.workspace.rightSplit.collapse(); }
			select_pdf_box(View, Abort.signal, () => this.cancel_pdf_box(), (Box: PdfBox) =>
			{
				void (async () =>
				{
					const Progress = new Notice("正在生成 PDF 局部图…", 0);
					try
					{
						if(View.file !== File || File.path !== Path || File.stat.mtime !== Stamp || File.stat.size !== Size)
						{
							throw new Error("PDF 已变化，请重新框选");
						}
						const Snapshot = await this.Capture.capture_pdf_target(File, Box.Target, View.containerEl.ownerDocument, Abort.signal, undefined, Box.Rotation);
						if(Abort.signal.aborted || this.Unloaded) { return; }
						if(!Snapshot) { throw new Error("上下文已切换，请重新框选"); }
						await this.reveal_pdf_attachment(Abort.signal,Snapshot,Scope,SessionId);
					}
					catch(ErrorValue) { if(!Abort.signal.aborted && !this.Unloaded) { this.show_error(ErrorValue); } }
					finally { Progress.hide(); if(this.PdfBoxCapture === Capture) { this.cancel_pdf_box(); } }
				})();
			});
		}
		catch(ErrorValue) { this.cancel_pdf_box(); this.show_error(ErrorValue); }
	}

	private accept_captured_material(Snapshot: ContextSnapshot,Scope:string,SessionId:string): boolean
	{
		if(this.Unloaded || Scope!==this.draft_scope() || SessionId!==this.Session.Id)
		{
			if(this.Capture.Snapshot===Snapshot) { this.Capture.clear(); }
			return false;
		}
		for(const {view} of this.app.workspace.getLeavesOfType(ViewType)) { if(view instanceof CodexView) { view.accept_attachment(Snapshot,Scope,SessionId); } }
		return true;
	}

	private async reveal_pdf_attachment(Signal: AbortSignal,Snapshot:ContextSnapshot,Scope:string,SessionId:string): Promise<void>
	{
		if(!this.accept_captured_material(Snapshot,Scope,SessionId)) { return; }
		this.State.Settings.AttachContext = true;
		this.refresh(); await this.persist(false);
		if(Signal.aborted) { return; }
		await this.open_sidebar(false);
		if(Signal.aborted || !this.accept_captured_material(Snapshot,Scope,SessionId)) { return; }
		for(const { view: View } of this.app.workspace.getLeavesOfType(ViewType))
		{
			if(View instanceof CodexView) { View.reveal_pdf_context(); }
		}
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

	private assistant_message(Id: string, TurnId: string, Role: "assistant" | "reasoning" = "assistant", Session = this.Session): ChatMessage
	{
		if(message_deleted(this.State, Session.Id, Id)) { return { Id, TurnId, Role, Text: "" }; }
		let Message = this.MessagesById.get(Session, Id);
		if(!Message)
		{
			Message = { Id, TurnId, Role, Text: "" };
			Session.Messages.push(Message);
		}
		return Message;
	}

	private add_read_source(Session: ChatSession, TurnId: string, Ref: SourceReference): void
	{
		for(const M of Session.Messages.filter(M => M.TurnId === TurnId)) { M.Sources ??= []; if(!M.Sources.some(S => S.Id === Ref.Id)) { M.Sources.push(structuredClone(Ref)); } }
	}

	private restore_runtime(): void
	{
		if(this.PendingBackendSaves.length)
		{
			this.Busy = false; this.TurnId = null; this.Runtime.finish(); this.Activity = "";
			this.Status = "回答已收到，尚未保存；请重试保存"; return;
		}
		const Pending = this.State.Sync?.Operations.filter(O => O.SessionId === this.State.ActiveId && !O.SessionDeleted && ["running", "submission-unknown"].includes(O.Status)) ?? [];
		const Running = Pending.find(O => O.Status === "running" && O.TurnId && O.ThreadId), Unknown = Pending.find(O => O.Status === "submission-unknown");
		if(Running) { this.TurnId = Running.TurnId!; this.Session.ThreadId = Running.ThreadId!; this.Busy = true; this.Runtime.stage("generating"); this.Activity = "已恢复正在运行的回合"; }
		else if(Unknown) { this.TurnId = this.Backend?null:Unknown.TurnId ?? null; this.Busy = false; if(this.Backend){this.Runtime.finish();}else{this.Runtime.stage("submission-unknown");} this.Activity = "提交结果待核对"; }
		else if(!this.Runtime.Active || this.Runtime.Active.Submitted) { this.Busy = false; this.TurnId = null; this.Runtime.finish(); this.Activity = ""; }
		else { this.Runtime.stage("preparing", this.Runtime.Active); }
	}

	private async archive_backend_event(Target: StateTarget, Message: RpcMessage): Promise<void>
	{
		if(Message.method!=="backend/result") { return; }
		const E=Message.params as BackendEvidence, Original=structuredClone(this.target_state(Target));
		const Matches=Original.Sync?.Operations.filter(O=>O.SessionId===E.sessionId&&O.ThreadId===E.threadId&&O.TurnId===E.turnId)??[];
		if(Matches.length!==1){return;}
		const Operation=Matches[0], Previous=(Operation.Result as any)?.backend?.result;
		if(Previous?.Status==="completed")
		{
			await write_late_receipt(this.app.vault.adapter,Target.Path,Operation);
			Operation.Result={...(Operation.Result as object),backend:{itemId:E.itemId,result:structuredClone(E.result),archivedOnly:true}};
			Operation.Status=E.result.Status==="completed"?"completed":E.result.Status==="unknown"?"submission-unknown":E.result.Status==="cancelled"?"cancelled":"failed";
		}
		else
		{
			if(!apply_backend_evidence(Original,E)){return;}
			(Operation.Result as any).backend.archivedOnly=true;
		}
		await write_late_receipt(this.app.vault.adapter,Target.Path,Operation);
	}

	private async accept_backend_event(Target: StateTarget, Event: BackendEvidence): Promise<void>
	{
		const Operations = this.target_state(Target).Sync?.Operations.filter(O => O.SessionId === Event.sessionId && O.ThreadId === Event.threadId && O.TurnId === Event.turnId) ?? [];
		if(Operations.length !== 1) { return; }
		const Operation = Operations[0], Binding = [Operation.Id, Operation.Scope, Operation.Digest, Operation.ThreadId, Operation.TurnId];
		const Evidence = structuredClone(Event);
		const Prior = this.BackendSaves.values.find(J => J.Value.Target.Scope === Target.Scope && !!J.Value.Target.Archive === !!Target.Archive && canonical_json(J.Value.Event) === canonical_json(Evidence));
		const Key = Prior?.Key ?? "result-save-" + ++this.BackendSaveId;
		const Active = this.Runtime.Active;
		if(!Target.Archive && Target.Scope === this.local_scope() && Active?.OperationId === Operation.Id && !this.Unloaded)
		{
			this.Runtime.finish(); this.Busy = false; this.ChatPreparing = false; this.TurnId = null; this.StartedAt = 0;
			this.Activity = "保存回答"; this.Status = "回答已收到，正在保存";
		}
		await this.BackendSaves.retain(Key, { Target, Event: Evidence }, async () =>
		{
			const Current = this.target_state(Target).Sync?.Operations.find(O => O.Id === Binding[0]);
			if(!Current || canonical_json([Current.Id, Current.Scope, Current.Digest, Current.ThreadId, Current.TurnId]) !== canonical_json(Binding)) { throw new Error("待保存回答与原操作绑定已变化，保留证据待核对"); }
			const CheckpointKey = JSON.stringify([Target.Scope, Evidence.sessionId, Evidence.turnId, Evidence.itemId]);
			await this.Checkpoints.forget(CheckpointKey); this.UnsavedCheckpoints.delete(CheckpointKey);
			await this.save_backend_event(Target, Evidence);
		});
		if(Target.Scope === this.local_scope() && !this.Unloaded && this.PendingBackendSaves.some(J => J.Key === Key))
		{
			this.Activity = ""; this.Status = "回答已收到，尚未保存；正在重试存储，可查看或复制正文"; this.refresh();
		}
	}

	private async save_backend_event(Target: StateTarget, Event: BackendEvidence): Promise<void>
	{
		if(Target.Archive || Target.Scope!==this.local_scope() || this.Unloaded) { await this.archive_backend_event(Target,{method:"backend/result",params:Event});return; }
		const OriginalOperation=this.State.Sync?.Operations.find(O=>O.SessionId===Event.sessionId&&O.ThreadId===Event.threadId&&O.TurnId===Event.turnId);
		let Stopped=(Event as BackendEvidence & {late?:boolean}).late===true || OriginalOperation?.WaitStopped===true || this.State.DeletedSessionIds?.includes(Event.sessionId)===true || OriginalOperation?.SessionDeleted===true || OriginalOperation?.MessageDeleted===true;
		let Changed=false;
		await this.Writes.enqueue(async()=>
		{
			if(Target.Archive || Target.Scope!==this.local_scope() || this.Unloaded) { await this.archive_backend_event(Target,{method:"backend/result",params:Event});return; }
			const CurrentOperation=this.State.Sync?.Operations.find(O=>O.SessionId===Event.sessionId&&O.ThreadId===Event.threadId&&O.TurnId===Event.turnId);
			const Archived=Stopped||CurrentOperation?.WaitStopped===true||CurrentOperation?.SessionDeleted===true||CurrentOperation?.MessageDeleted===true||this.State.DeletedSessionIds?.includes(Event.sessionId)===true;
			Stopped ||= Archived;
			const Next=structuredClone(this.State);
			if(!apply_backend_evidence(Next,Event)) { await this.archive_backend_event(Target,{method:"backend/result",params:Event});return; }
			if(Archived) { const R=Next.Sessions.find(S=>S.Id===Event.sessionId)?.Messages.find(M=>M.Id===Event.itemId);if(R){R.ArchivedOnly=true;} }
			await write_state_file(this.app.vault.adapter,Target.Path,Next);
			if(Target.Scope===this.local_scope()&&!this.Unloaded)
			{
				Changed=apply_backend_evidence(this.State,Event);
				const LatestOperation=this.State.Sync?.Operations.find(O=>O.SessionId===Event.sessionId&&O.ThreadId===Event.threadId&&O.TurnId===Event.turnId);
				Stopped ||= LatestOperation?.WaitStopped===true||LatestOperation?.SessionDeleted===true||LatestOperation?.MessageDeleted===true;
				if(Stopped){ const R=this.State.Sessions.find(S=>S.Id===Event.sessionId)?.Messages.find(M=>M.Id===Event.itemId);if(R){R.ArchivedOnly=true;} }
			}
		});
		if(!Changed || Target.Scope!==this.local_scope() || this.Unloaded) { return; }
		this.history_changed(Event.sessionId,[Event.itemId],true);
		const Active=this.Runtime.Active;
		const Owned=Active ? Active.SessionId===Event.sessionId && this.State.Sync?.Operations.find(O=>O.Id===Active.OperationId)?.TurnId===Event.turnId : this.State.ActiveId===Event.sessionId;
		if(!Stopped && Owned)
		{
			this.Runtime.finish();this.Busy=false;this.ChatPreparing=false;this.TurnId=null;this.Activity="";this.StartedAt=0;
			this.Status=Event.result.Status==="completed"?"回复完成":Event.result.Status==="partial"?"已保留部分回答，可明确继续":Event.result.Status==="unknown"?"已保留实际正文，服务端结果未知、待核对；未自动重发":Event.result.Metadata.Reason??Event.result.Status;
		}
		if(Event.result.Status==="completed"&&!Stopped&&!this.State.DeletedSessionIds?.includes(Event.sessionId)&&this.State.Sessions.some(S=>S.Id===Event.sessionId)) { this.CompletedTurns.add(this.completed_key(Target.Scope,Event.threadId,Event.turnId)); }
		this.refresh();
	}

	private handle_message(Message: RpcMessage): void
	{
		if(Message.method === "skills/changed") { this.MathWritingSkill = null; this.SkillStatus = "math-writing 已变更, 下次请求重新检查"; this.refresh(); return; }
		if(Message.id !== undefined && Message.method) { void this.handle_request(Message); return; }
		const Params = Message.params;
		if(Message.method === "bridge/recovering") { this.Runtime.stage("recovering"); this.Status = Params?.message ?? "正在核对状态与恢复事件监听"; this.refresh(); return; }
		if(Message.method === "bridge/recovered") { this.restore_runtime(); this.refresh(); return; }
		if(Message.method === "bridge/storage-error") { this.Status = "远程正文检查点暂未保存, 正在保留并重试; " + (Params?.message ?? "请检查远程存储"); this.refresh(); return; }
		if(Message.method === "backend/result")
		{
			if(this.Connection instanceof BackendConnection)
			{
				const M=Params.result?.Metadata;
				if(M?.Transport==="buffered"){this.Connection.Capabilities.Streaming=false;}
				else if(M?.Transport==="streaming"&&M.FirstEventMs!==undefined){this.Connection.Capabilities.Streaming=true;}
			}
			void this.accept_backend_event(this.state_target(),Params).catch(E=>{ if(!this.Unloaded) { this.Status="后端正文尚未保存："+error_text(E);this.refresh(); } });
			return;
		}
		if(!Params?.threadId) { return; }
		const Session = this.thread_session(Params.threadId);
		if(!Session || this.State.DeletedSessionIds?.includes(Session.Id) || (Params.sessionId && Params.sessionId !== Session.Id)) { return; }
		const Visible = Session.Id === this.State.ActiveId, Target = this.state_target();
		const EventId = Params.itemId ?? Params.item?.id;

		if(EventId && ["item/agentMessage/delta", "item/reasoning/summaryTextDelta", "item/completed"].includes(Message.method ?? "") && this.MessagesById.get(Session, EventId)?.CompletionStatus) { return; }
		if(Message.method === "bridge/message-updated")
		{
			if(message_deleted(this.State, Session.Id, Params.message?.Id)) { return; }
			const Conflicts = this.State.Sync?.Conflicts ?? (this.State.MessageConflicts ??= []);
			const ConflictCount = Conflicts.length, Previous = this.MessagesById.get(Session, Params.message?.Id), PreviousBytes = new TextEncoder().encode(Previous?.Text ?? "").byteLength;
			let Changed = false;
			try { Changed = message_checkpoint(Session, Params.message, Conflicts); } catch(E) { if(Visible) { this.Status = error_text(E); this.refresh(); } return; }
			if(!Changed) { if(Conflicts.length !== ConflictCount) { this.persist_background(); if(Visible) { this.refresh(); } } return; }
			this.history_changed(Session.Id, [Params.message.Id], !!Params.message.CompletionStatus);
			if(Params.message.CompletionStatus) { this.persist_background(); }
			else { this.stream_checkpoint(Session, Params.message.Id, Math.max(0, new TextEncoder().encode(Params.message.Text ?? "").byteLength - PreviousBytes)); }
			if(Visible) { this.refresh(); } return;
		}
		if(Message.method === "bridge/source-read") { if(Params.source) { this.add_read_source(Session, Params.turnId, Params.source); this.history_changed(Session.Id, Session.Messages.filter(M => M.TurnId === Params.turnId).map(M => M.Id), false); this.persist_background(); } if(Visible) { this.refresh(); } return; }
		switch(Message.method)
		{
			case "turn/started":
			{
				const Candidates = this.State.Sync?.Operations.filter(O => O.SessionId === Session.Id && O.ThreadId === Params.threadId && (O.TurnId === Params.turn.id || (O.Attempted && !O.TurnId && ["received", "submission-unknown", "running"].includes(O.Status)))) ?? [];
				if(Candidates.length === 1)
				{
					const O = Candidates[0]; this.update_run_operation(Target, O.Id, "running", { TurnId: Params.turn.id, ThreadId: Params.threadId });
					const User = Session.Messages.find(M => M.Id === O.MessageId && M.OperationId === O.Id); if(User) { User.TurnId = Params.turn.id; }
				}
				if(Visible && !Candidates.some(O => ["completed", "cancelled", "failed"].includes(O.Status))) { this.TurnId = Params.turn.id; this.Busy = true; this.Runtime.stage("generating"); this.Activity = "思考中"; this.StartedAt ||= Date.now(); }
				this.persist_background(); break;
			}
			case "item/reasoning/summaryTextDelta":
			{
				const Summary = this.assistant_message(Params.itemId, Params.turnId, "reasoning", Session); Summary.SummaryParts ??= [];
				Summary.SummaryParts[Params.summaryIndex] = (Summary.SummaryParts[Params.summaryIndex] ?? "") + Params.delta; Summary.Text = Summary.SummaryParts.filter(Boolean).join("\n\n");
				this.stream_checkpoint(Session, Summary.Id, new TextEncoder().encode(Params.delta).byteLength);
				if(Visible) { this.Activity = "思考中"; } break;
			}
			case "thread/tokenUsage/updated": Session.Usage = Params.tokenUsage; this.persist_background(); break;
			case "thread/settings/updated":
				Session.EffectiveModel = Params.threadSettings.model; Session.EffectiveEffort = Params.threadSettings.effort; Session.EffectiveTier = Params.threadSettings.serviceTier ?? "default";
				if(Visible) { this.Model = Session.EffectiveModel ?? ""; } this.persist_background(); break;
			case "thread/compacted": Session.InstructionsHash = ""; this.LastInputLedger.delete(Session.Id); this.persist_background(); break;
			case "item/agentMessage/delta":
				this.assistant_message(Params.itemId, Params.turnId, "assistant", Session).Text += Params.delta;
				this.stream_checkpoint(Session, Params.itemId, new TextEncoder().encode(Params.delta).byteLength);
				if(Visible) { this.Status = "Codex 正在回答..."; this.Activity = "正在回答"; } break;
			case "item/completed":
				if(Params.item.backendResult) { return; }
				this.Checkpoints.forget(JSON.stringify([Target.Scope, Session.Id, Params.turnId ?? "", Params.item.id]));
				if(Params.item.type === "agentMessage") { const Reply = this.assistant_message(Params.item.id, Params.turnId, "assistant", Session); Reply.Text = Params.item.text; Reply.Phase = ["commentary", "final_answer"].includes(Params.item.phase) ? Params.item.phase : null; }
				if(Params.item.type === "reasoning" && Params.item.summary?.length) { this.assistant_message(Params.item.id, Params.turnId, "reasoning", Session).Text = Params.item.summary.join("\n\n"); }
				if(Visible && this.Busy && ["commandExecution", "mcpToolCall", "webSearch"].includes(Params.item.type)) { this.Activity = "思考中"; }
				if(Params.item.type === "contextCompaction") { Session.InstructionsHash = ""; this.LastInputLedger.delete(Session.Id); }
				this.persist_background(); break;
			case "item/started":
				if(Params.item.type === "fileChange") { this.ApprovalItems.set(Params.item.id, Params.item.changes); }
				if(Visible && ["commandExecution", "mcpToolCall", "webSearch"].includes(Params.item.type)) { this.Status = "Codex 正在运行工具..."; this.Activity = "正在运行工具"; }
				if(Visible && Params.item.type === "reasoning") { this.Activity = "思考中"; } break;
			case "backend/result-unknown":
			{
				if(Params.backend?.result || this.Connection instanceof BackendConnection) { return; }
				for(const O of this.State.Sync?.Operations.filter(O => O.SessionId === Session.Id && O.ThreadId === Params.threadId && O.TurnId === Params.turn.id && O.Status === "running") ?? [])
				{
					this.update_run_operation(Target, O.Id, "submission-unknown", { Error: Params.turn.error?.message });
				}
				if(Visible && this.TurnId === Params.turn.id)
				{
					this.Busy = false; this.TurnId = null; this.Activity = "结果待核对";
					this.Status = Params.turn.error?.message ?? "结果待核对, 未自动重发";
					this.Runtime.stage("submission-unknown");
				}
				this.history_changed(Session.Id, Session.Messages.filter(M => M.TurnId === Params.turn.id).map(M => M.Id));
				this.persist_background(); break;
			}
			case "turn/completed":
			{
				if(Params.backend?.result) { return; }
				for(const M of Session.Messages.filter(M => M.TurnId === Params.turn.id)) { this.Checkpoints.forget(JSON.stringify([Target.Scope, Session.Id, M.TurnId ?? "", M.Id])); }
				for(const Reply of Session.Messages.filter(M => M.Role !== "reasoning" && M.TurnId === Params.turn.id)) { Reply.CompletionStatus = Params.turn.status === "completed" ? "completed" : Params.turn.status === "interrupted" ? "interrupted" : "failed"; }
				if(Params.turn.status === "completed") { this.CompletedTurns.add(this.completed_key(Target.Scope, Params.threadId, Params.turn.id)); }
				for(const O of this.State.Sync?.Operations.filter(O => O.SessionId === Session.Id && O.ThreadId === Params.threadId && O.TurnId === Params.turn.id) ?? []) { this.update_run_operation(Target, O.Id, Params.turn.status === "completed" ? "completed" : Params.turn.status === "interrupted" ? "cancelled" : "failed", { Error: Params.turn.error?.message }); }
				const ActiveOperation = this.State.Sync?.Operations.find(O => O.Id === this.Runtime.Active?.OperationId);
				if(Visible && (this.TurnId === Params.turn.id || ActiveOperation?.TurnId === Params.turn.id || !this.TurnId && !this.Runtime.Active && !this.Busy))
				{
					this.ApprovalItems.clear(); this.Busy = false; this.ChatPreparing = false; this.TurnId = null; this.Activity = ""; this.StartedAt = 0;
					if(!this.Runtime.Active || this.Runtime.Active.SessionId === Session.Id) { this.Runtime.finish(); }
					this.Status = Params.turn.status === "completed" ? "回复完成" : Params.turn.status === "interrupted" ? this.Backend ? "已停止等待; 已提交的请求可能仍在服务端处理" : "已停止" : `回复失败: ${Params.turn.error?.message ?? Params.turn.status}`;
				}
				this.persist_background(); break;
			}
			case "error": if(Visible) { this.Status = Params.error?.message ?? "Codex 错误"; } break;
			case "model/rerouted": Session.EffectiveModel = Params.toModel; if(Visible) { this.Model = Params.toModel; this.Status = `后端已切换模型: ${Params.toModel}`; } break;
		}
		if(EventId) { this.history_changed(Session.Id, [EventId], Message.method === "item/completed"); }
		else if(["turn/started", "turn/completed"].includes(Message.method ?? "")) { this.history_changed(Session.Id, Session.Messages.filter(M => M.TurnId === Params.turn.id).map(M => M.Id)); }
		if(Visible) { this.refresh(); }
	}

	private async handle_request(Message: RpcMessage): Promise<void>
	{
		const Connection = this.Connection, Scope = this.local_scope(), Session = this.thread_session(Message.params?.threadId);
		let Result: unknown;
		try
		{
			if(!Session || this.State.DeletedSessionIds?.includes(Session.Id)) { Connection?.send({ id: Message.id, error: { code: -32602, message: "请求不属于本作用域中仍存在的会话" } }); return; }
			const Visible = () => Scope === this.local_scope() && this.State.ActiveId === Session.Id;
			if(Message.method === "item/tool/call" && [ObsidianTool.name, HistoryReadTool.name].includes(Message.params?.tool))
			{
				if(Visible()) { this.Activity = "正在读取原始资料"; this.refresh(); }
				try
				{
					Result = Message.params.tool === HistoryReadTool.name ? await read_history_page(Session.Id, Session.Messages, Message.params.arguments, Scope) : await run_obsidian_read(this.obsidian_cli(), this.app.vault.getName(), Message.params.arguments);
					if(Message.params.tool === HistoryReadTool.name && Scope === this.local_scope() && Connection === this.Connection)
					{
						const Operations = this.State.Sync?.Operations.filter(O => O.SessionId === Session.Id && O.ThreadId === Message.params.threadId && O.TurnId === Message.params.turnId) ?? [];
						if(Operations.length === 1) { this.record_history_success(Session, Operations[0].Id, Message.params.arguments, Result as BackendHistoryResult); }
					}
					const Ref = Message.params.tool === ObsidianTool.name ? tool_read_reference(Message.params.arguments, Result, "desktop-read") : null;
					if(Ref && Scope === this.local_scope() && this.State.Sessions.includes(Session)) { this.add_read_source(Session, Message.params.turnId, Ref); this.history_changed(Session.Id, Session.Messages.filter(M => M.TurnId === Message.params.turnId).map(M => M.Id), false); this.persist_background(); }
				}
				catch(E) { Result = { success: false, contentItems: [{ type: "inputText", text: error_text(E) }] }; }
				if(Visible()) { this.Activity = this.Busy ? "思考中" : ""; this.refresh(); }
			}
			else if(Message.method === "item/commandExecution/requestApproval" || Message.method === "item/fileChange/requestApproval")
			{
				const Params = Message.params, Changes = this.ApprovalItems.get(Params.itemId);
				const Description = [Params.reason, Params.command, Params.cwd, Message.method === "item/fileChange/requestApproval" ? `Codex 请求修改文件\n${Changes ? JSON.stringify(Changes, null, 2) : "未收到变更明细"}` : ""].filter(Boolean).join("\n\n");
				if(Visible()) { this.Activity = "等待批准"; this.refresh(); }
				Result = { decision: await this.ask_approval(Description) };
			}
			else if(Message.method === "item/tool/requestUserInput") { Result = await this.ask_questions(Message.params.questions); }
			else { Connection?.send({ id: Message.id, error: { code: -32601, message: `Unsupported request: ${Message.method}` } }); return; }
			if(Connection === this.Connection && Scope === this.local_scope()) { Connection?.send({ id: Message.id, result: Result }); }
		}
		catch { /* Transport may close while an owned request is pending. */ }
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
		const FinalTarget=this.state_target();
		// Obsidian does not await Plugin.onunload; only fulfilled readback is durable.
		void this.BackendSaves.close().then(()=>this.Checkpoints.close()).then(()=>this.persist_snapshot(this.target_state(FinalTarget),false,FinalTarget)).catch(E=>console.warn("Codex Sidebar: unload storage unfinished",error_text(E)));
		this.Runtime.close();
		this.Unloaded = true;
		this.cancel_pdf_box();
		this.PdfToolbar.dispose();
		this.BackendKey = "";
		this.Credentials.clear();
		this.LocalApiKey = undefined;
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
