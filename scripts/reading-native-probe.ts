// Load as a unique temporary plugin, then call run(). Synthetic owner; real CodexView/MathJax.
import { Plugin, finishRenderMath } from "obsidian";
import { CodexView } from "../src/view";
import { answer_quote } from "../src/quote";
import { markdown_blocks } from "../src/markdown-blocks";
import type { ChatMessage } from "../src/history";
import { capture_history_ledger, record_history_read } from "../src/history-ledger";
import { plan_history_input, read_history_page } from "../src/history-budget";

export default class ReadingNativeProbe extends Plugin
{
	async run(Inspect?: (Stage: string) => Promise<void>): Promise<unknown>
	{
		const Scope = "reading-native-" + crypto.randomUUID(), Type = "codex-reading-probe-" + crypto.randomUUID();
		const Long = (Name: string) => "# " + Name + "\n\n" + Array.from({ length: 100 }, (_, I) => Name + " 第 " + I + " 步. " + "沿原论证逐项核对一致有界性和极限交换. ".repeat(20)).join("\n\n") + "\n\n$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$\n\n" + Array.from({ length: 4 }, (_, I) => "尾部结论 " + I + " "+ "保留完整解释并逐项估计. ".repeat(30)).join("\n\n");
		const Original: ChatMessage = { Id: "original", Role: "assistant", Text: Long("原始说明"), CompletionStatus: "completed", Phase: "final_answer", TurnId: "t0" };
		const Messages: ChatMessage[] = [{ Id: "q0", Role: "user", Text: "核对引理 A 的估计", TurnId: "t0" }, Original, ...Array.from({ length: 70 }, (_, I): ChatMessage => ({ Id: "filler" + I, Role: I % 2 ? "assistant" : "user", Text: "名称相近的引理 " + I, TurnId: "f" + Math.floor(I / 2) }))];
		for(let I = 1; I <= 3; I++)
		{
			Messages.push({ Id: "q" + I, Role: "user", Text: "引理 A 的第 " + I + " 次追问", TurnId: "t" + I, Quote: answer_quote("s", I === 1 ? "original" : "a" + (I - 1), "原公式", I === 1 ? Original.Text : Messages.at(-1)!.Text, "completed", { RootMessageId: "original" }) }, { Id: "a" + I, Role: "assistant", Text: Long("完整整合" + I), TurnId: "t" + I, Phase: "final_answer", CompletionStatus: "completed" });
		}
		const Session = { Id: "s", Title: "原创长证明", Messages }, Other = { Id: "other", Title: "另一会话", Messages: [{ Id: "original", Role: "assistant", Text: "同名消息不能接受旧导航" }] };
		let Retries = 0, Hold: Promise<void> | null = null, Release!: () => void, View: CodexView | undefined;
		const Owner: any = { Session, State: { ActiveId: "s", Sessions: [Session, Other], Settings: { AttachContext: true, EditScope: "captured", Model: "fixture", Effort: "", ShowUsage: false, Completion: false } }, Models: [], Inline: { get_suggestion: () => null }, Capture: { Snapshot: null }, Busy: false, CatalogError: "", Status: "就绪", SkillStatus: "原创探针", draft_scope: () => Scope, persist: async () => {}, refresh: () => View?.refresh(), can_capture_pdf_box: () => false, ensure_session_history: async () => { if(Hold) { await Hold; } }, PendingBackendSaves: [], BackendSaveBlocked: false, retry_backend_saves: async () => { Retries++; } };
		const Identity = { Scope, SessionId: "s", OperationId: "native-op" }, LastUser = Messages.find(M => M.Id === "q3")!;
		LastUser.OperationId = Identity.OperationId;
		LastUser.InputLedger = capture_history_ledger(plan_history_input(Messages.slice(0, -2), { MaxUtf8Bytes: 26000, RequiredMessageIds: ["original"], HistoryReadAvailable: true, HistoryReadBodyVersionsAvailable: true }).Ledger, Messages.slice(0, -2), Identity);
		const Args = { command: "read", message_id: "original", length: 1000 };
		LastUser.InputLedger = record_history_read(LastUser.InputLedger, Identity, Args, await read_history_page("s", Messages, Args, Scope));
		const Previous = this.app.workspace.activeLeaf, Leaf = this.app.workspace.getLeaf("tab");
		this.registerView(Type, L => { View = new CodexView(L, Owner); View.getViewType = () => Type; return View; });
		const settle = async () => { await finishRenderMath(); await new Promise<void>(R => requestAnimationFrame(() => requestAnimationFrame(() => R()))); };
		const Check = (Value: unknown, Name: string): void => { if(!Value) { throw Error("Native reading probe: " + Name); } };
		try
		{
			await Leaf.setViewState({ type: Type, active: true });
			const V = View as any, Root = View!.contentEl; Root.style.width = "420px";
			await V.render_messages(); await settle();
			const List = Root.querySelector<HTMLElement>(".codex-messages")!, Card = (Id: string) => [...List.querySelectorAll<HTMLElement>("[data-message-id]")].find(E => E.dataset.messageId === Id);
			const NativeMath = Card("a3")!.querySelector<HTMLElement>('mjx-container[display="true"]')!; Check(NativeMath, "real MathJax display");
			const MathBlock = NativeMath.closest<HTMLElement>("[data-codex-answer-block]")!; Check(MathBlock, "reliable rendered formula block");
			List.scrollTop += MathBlock.getBoundingClientRect().top - List.getBoundingClientRect().top + 8; List.dispatchEvent(new Event("scroll")); await settle();
			const Origin = V.capture_reading(); Check(Origin?.Block, "captured reliable origin block");
			const B = markdown_blocks(Original.Text).find(B => B.Kind === "math")!;
			const Quote = answer_quote("s", "original", "原公式", Original.Text, "completed", { Mapping: "source-blocks", Range: { From: B.From, To: B.To }, BlockIds: [B.Id] });
			await V.reveal_message("original", Quote); await settle(); Check(Card("original")?.querySelector("mjx-container"), "old window hydrated and rendered");
			Check([...Card("original")!.querySelectorAll<HTMLButtonElement>(".codex-reading-return")].some(B => !B.hidden), "return control visible");
			Root.style.width = "320px"; Messages.at(-1)!.Text += "\n\n新的流式整合结论保留原块."; V.history_changed("s", ["a3"]);
			await V.return_reading(); await settle();
			const Restored = [...Card("a3")!.querySelectorAll<HTMLElement>("[data-codex-answer-block]")].find(E => E.dataset.codexAnswerBlock === Origin.Block.Id)!;
			const Offset = Restored.getBoundingClientRect().top - List.getBoundingClientRect().top; Check(Math.abs(Offset - Origin.Offset) < 2, "narrow reflow returns to same block/local position: " + JSON.stringify({ expected: Origin.Offset, actual: Offset }));
			await V.return_reading(); await settle(); Check(Card("original"), "continuous return to source"); await V.return_reading(); await settle(); Check(Card("a3"), "continuous return to integrated answer");
			Hold = new Promise(R => { Release = R; }); const Pending = V.reveal_message("original", Quote); await Promise.resolve(); List.dispatchEvent(new WheelEvent("wheel", { deltaY: -60 })); List.scrollTop -= 60; List.dispatchEvent(new Event("scroll")); const UserTop = List.scrollTop; Release(); await Pending; Hold = null; Check(Card("a3") && Math.abs(List.scrollTop - UserTop) < 2, "user scrolling invalidates asynchronous navigation");
			Hold = new Promise(R => { Release = R; }); const Switching = V.reveal_message("original", Quote); await Promise.resolve(); Owner.Session = Other; Owner.State.ActiveId = Other.Id; V.refresh(); await V.render_messages(); Release(); await Switching; Hold = null; Check(List.textContent?.includes("同名消息不能接受旧导航"), "session switch wins");
			Owner.Session = Session; Owner.State.ActiveId = "s"; V.refresh(); await V.render_messages(); await settle();
			Check(List.textContent?.includes("实际补读成功") && List.textContent.includes("只提供补读定位"), "material list distinguishes locator and actual successful page");
			Owner.PendingBackendSaves = [{ Key: "original-unsaved", Scope, SessionId: "s", MessageId: "not-a-saved-message", Text: "原创回答已收到, 等待存储恢复.\n\n$$x=1$$", Status: "completed", Saving: false, Error: "owned fixture save failure" }]; Owner.BackendSaveBlocked = true; V.refresh(); await V.render_messages(); await settle();
			const Unsaved = List.querySelector<HTMLElement>(".codex-pending-backend-save")!; Check(Unsaved?.textContent?.includes("尚未保存") && !Unsaved.dataset.messageId && V.Input.disabled, "received is not persisted or adoptable");
			Check(Unsaved.textContent?.includes("原创回答已收到") && [...Unsaved.querySelectorAll("button")].some(B => B.textContent === "复制未保存正文"), "unsaved body readable/copyable");
			const PendingBody = Unsaved.querySelector(".codex-unsaved-body"), PendingMath = PendingBody?.querySelector("mjx-container"); Check(PendingMath, "unsaved mathematical body uses real MathJax");
			Owner.PendingBackendSaves[0].Saving = true; V.refresh(); await V.render_messages();
			for(let I = 0; I < 4; I++) { V.refresh(); await V.render_messages(); }
			Check(Unsaved.querySelector(".codex-unsaved-body") === PendingBody && PendingBody?.querySelector("mjx-container") === PendingMath, "storage status refresh must reuse the rendered body/MathJax");
			await Inspect?.("received-body");
			Owner.PendingBackendSaves[0].Saving = false; V.refresh(); await V.render_messages();
			const Retry = [...Unsaved.querySelectorAll<HTMLButtonElement>("button")].find(B => B.textContent === "重试保存")!; Retry.click(); await Promise.resolve(); Check(Retries === 1, "retry invokes storage-only owner API once");
			Owner.PendingBackendSaves = []; Owner.BackendSaveBlocked = false; V.refresh(); await V.render_messages(); Check(!List.querySelector(".codex-pending-backend-save") && !V.Input.disabled, "durable success removes unsaved observation");
			return { tier: "native CodexView + MarkdownRenderer/MathJax, synthetic host, no model/key/bridge/note writes", sourceChars: Original.Text.length, integratedRounds: 3, originalBlockOffset: Origin.Offset, returnedBlockOffset: Offset, returnAfterNarrowReflow: true, continuousRoundTrips: true, userScrollWins: true, sessionSwitchWins: true, actualReadPageDisplay: true, pendingReadableAndCopyable: true, pendingRealMath: true, pendingBodyReused: true, pendingNotDurableMessage: true, storageOnlyRetryCalls: Retries, pendingCleared: true, mathNodes: List.querySelectorAll("mjx-container").length, mathErrors: List.querySelectorAll("mjx-merror,.MathJax_Error").length };
		}
		finally
		{
			Release?.(); Leaf.detach(); if(Previous) { this.app.workspace.setActiveLeaf(Previous, { focus: true }); }
		}
	}
}
