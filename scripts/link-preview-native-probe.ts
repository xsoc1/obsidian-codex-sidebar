// Temporary SDK plugin. Original fixture files only; no model or user-note operations.
import { Plugin, finishRenderMath, type TFile } from "obsidian";
import { CodexView } from "../src/view";
import type { ContextSnapshot } from "../src/prompt";
import type { ChatMessage } from "../src/history";

export default class LinkPreviewNativeProbe extends Plugin
{
	async run(Pdf: ArrayBuffer, Inspect?: (Stage: string, Dialog: HTMLElement) => Promise<void>)
	{
		const Id = "preview-probe-" + crypto.randomUUID(), Type = "codex-" + Id, AppValue = this.app;
		const Original = AppValue.workspace.activeLeaf, Files: TFile[] = [];
		const Folder = await AppValue.vault.createFolder(Id);
		let Leaf: ReturnType<typeof AppValue.workspace.getLeaf> | undefined, View: CodexView | undefined, Target: TFile | undefined;
		const Pick = () => [...document.querySelectorAll<HTMLElement>(".codex-link-preview")].find(E => E.isConnected);
		const Check = (Value: unknown, Message: string) => { if(!Value) { throw Error("Native link preview: " + Message); } };
		const Wait = async (Ready: () => unknown, Label: string) =>
		{
			for(let I = 0; I < 120; I++) { if(Ready()) { return; } await new Promise<void>(Resolve => setTimeout(Resolve, 25)); }
			throw Error("Native link preview timed out: " + Label);
		};
		try
		{
			const Text = "# 开头\n\n不应出现在章节中。\n\n## 交换子\n\n等式成立：\n\n$$\n[H,E]=2E\n$$\n\n这是原证明。 ^detail\n\n## 下一节\n\n这段也不应出现。";
			const NotePath = Id + "/原创 样本.md";
			Target = await AppValue.vault.create(NotePath, Text); Files.push(Target);
			const PDF = await AppValue.vault.createBinary(Id + "/原创 PDF.pdf", Pdf); Files.push(PDF);
			await Wait(() => !!AppValue.metadataCache.getFileCache(Target!)?.blocks?.detail, "note metadata");
			const Context: ContextSnapshot = { Path: NotePath, Mode: "阅读", Kind: "选区", Mapping: "源块", Text: "这是原证明。", SelectedText: "这是原证明。", Heading: "交换子", LineStart: 12, LineEnd: 12, CapturedAt: new Date().toISOString(), Truncated: false };
			const Messages: ChatMessage[] = [{ Id: "q", Role: "user", TurnId: "turn", Text: "请解释。", Context }, { Id: "a", Role: "assistant", TurnId: "turn", Text: "[[原创 样本#交换子|章节]] · [块](原创%20样本.md#^detail) · [[原创 PDF.pdf#page=2|附录]] · [[#不存在|缺失位置]] · [网页](https://example.org)", CompletionStatus: "completed", Phase: "final_answer" }];
			const Session = { Id, Title: "原创链接", Messages };
			const Owner: any = { Session, State: { ActiveId: Id, Sessions: [Session], Settings: { AttachContext: true, EditScope: "captured", Model: "fixture", Effort: "", ShowUsage: false } }, Models: [], Inline: { get_suggestion: () => null }, Capture: { Snapshot: null }, Busy: false, CatalogError: "", Status: "就绪", SkillStatus: "", draft_scope: () => Id, refresh: () => View?.refresh(), can_capture_pdf_box: () => false, ensure_session_history: async () => {}, PendingBackendSaves: [] };
			this.registerView(Type, L => { View = new CodexView(L, Owner); View.getViewType = () => Type; return View; });
			Leaf = AppValue.workspace.getLeaf("tab"); await Leaf.setViewState({ type: Type, active: true });
			await AppValue.workspace.revealLeaf(Leaf);
			AppValue.workspace.setActiveLeaf(Leaf, { focus: true });
			await (View as any).render_messages();
			const Root = View!.contentEl, Link = (Label: string) => [...Root.querySelectorAll<HTMLAnchorElement>("a")].find(E => E.textContent === Label)!;
			const List = Root.querySelector<HTMLElement>(".codex-messages")!;
			// The CLI can run with a hidden document; display only this temporary transcript for keyboard checks.
			if(document.visibilityState === "hidden") { List.hidden = false; }
			const Button = (Dialog: HTMLElement, Label: string) => [...Dialog.querySelectorAll<HTMLButtonElement>("button")].find(B => B.textContent === Label)!;
			const Close = async () => { Button(Pick()!, "关闭").click(); await Wait(() => !Pick(), "close"); };
			const OpenPreview = async (Trigger: HTMLElement, Expected: (Dialog: HTMLElement) => unknown) =>
			{
				Check(Trigger, "trigger exists"); Trigger.focus({ preventScroll: true }); Trigger.click();
				await Wait(() => Pick() && Expected(Pick()!), "dialog content");
				Check(AppValue.workspace.activeLeaf === Leaf, "no navigation before confirmation");
				return Pick()!;
			};
			const SavedTop = List.scrollTop;
			const OriginLink = Link("章节");
			const Section = await OpenPreview(Link("章节"), E => E.querySelector(".codex-link-preview-body")?.textContent?.includes("这是原证明"));
			await finishRenderMath();
			Check(Section.querySelector('mjx-container[display="true"]'), "native display math");
			Check(!Section.textContent?.includes("不应出现"), "section does not include neighbours");
			await Inspect?.("heading", Section);
			await Close();
			await new Promise<void>(Resolve => setTimeout(Resolve, 50));
			const FocusRestored = Root.ownerDocument.activeElement === OriginLink;
			if(!FocusRestored) { OriginLink.focus({ preventScroll: true }); }
			Check(FocusRestored, "focus restoration " + JSON.stringify({
				sameAnchor: OriginLink === Link("章节"), connected: OriginLink.isConnected, tabIndex: OriginLink.tabIndex, hasHref: !!OriginLink.getAttribute("href"),
				manualFocusWorks: Root.ownerDocument.activeElement === OriginLink, visible: !!OriginLink.getClientRects().length, inert: !!OriginLink.closest("[inert]")
			}));
			Check(List.scrollTop === SavedTop, "scroll restored");
			const Block = await OpenPreview(Link("块"), E => E.querySelector(".codex-link-preview-body")?.textContent?.includes("这是原证明"));
			Check(!Block.querySelector("h2") && !Block.textContent?.includes("等式成立"), "exact linked block");
			await Close();
			const SourceList = Root.querySelector<HTMLDetailsElement>(".codex-answer-sources")!;
			SourceList.open = true;
			await OpenPreview(SourceList.querySelector("button")!, E => E.querySelector(".codex-link-preview-body")?.textContent?.includes("这是原证明")); await Close();
			const Missing = await OpenPreview(Link("缺失位置"), E => E.textContent?.includes("找不到链接指定的位置"));
			Check(!Missing.textContent?.includes("这是原证明"), "missing anchor not substituted"); await Close();
			const PDFDialog = await OpenPreview(Link("附录"), E => E.querySelector('canvas[aria-label="PDF 第 2 页"]:not([hidden])'));
			const Canvas = PDFDialog.querySelector("canvas")!;
			Check(Canvas.width > 0 && Canvas.height > 0 && Canvas.toDataURL().length > 2000, "second PDF page canvas rendered");
			await Inspect?.("pdf", PDFDialog);
			await Close();
			const Last = await OpenPreview(Link("章节"), E => Button(E, "打开原文"));
			Button(Last, "打开原文").click();
			await Wait(() => !Pick() && (AppValue.workspace.getActiveFile()?.path === NotePath), "explicit open original");
			Check(Link("网页").classList.contains("external-link"), "web link stays external");
			return { native: true, section: true, block: true, source: true, displayMath: true, pdfCanvas: true, restoredFocusAndScroll: true, missingAnchor: true, explicitOpen: true };
		}
		finally
		{
			await View?.onClose();
			Leaf?.detach();
			if(Target) { for(const L of AppValue.workspace.getLeavesOfType("markdown")) { if((L.view as any).file === Target) { L.detach(); } } }
			if(Original) { AppValue.workspace.setActiveLeaf(Original, { focus: true }); }
			for(const File of Files) { if(AppValue.vault.getFileByPath(File.path) === File) { await AppValue.vault.delete(File, true); } }
			if(!Folder.children.length && AppValue.vault.getFolderByPath(Folder.path) === Folder) { await AppValue.vault.delete(Folder, true); }
		}
	}
}
