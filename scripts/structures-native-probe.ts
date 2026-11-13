import { Component, MarkdownRenderer, Modal, type App } from "obsidian";
import { interactive_output } from "../src/interactive/protocol";
import { render_interactive } from "../src/interactive/panel";
import { source_reference, open_source } from "../src/sources";
import { version_of } from "../src/edit/document";
import type { ContextSnapshot } from "../src/prompt";

export async function structures_native_probe(AppValue: App, Answer: string)
{
	const Folder = "Codex Sidebar 验收-Structures-" + crypto.randomUUID().slice(0, 8), Previous = AppValue.workspace.activeLeaf;
	const Text = Answer.slice(0, Answer.indexOf("```codex-ui")).trim();
	await AppValue.vault.createFolder(Folder); const File = await AppValue.vault.create(Folder + "/原创对偶映射.md", Text);
	const Context: ContextSnapshot = { Path: File.path, Mode: "阅读", Kind: "当前位置", Mapping: "源块", Text, SelectedText: "", LineStart: 0, LineEnd: Text.split("\n").length - 1, Heading: "原创对偶映射", CapturedAt: new Date().toISOString(), Truncated: false, Version: await version_of(Text) };
	const ModalValue = new Modal(AppValue); ModalValue.setTitle("关系与步骤 · 原创样例验收"); ModalValue.modalEl.style.width = "480px"; ModalValue.modalEl.style.maxHeight = "86vh";
	const Card = ModalValue.contentEl.createDiv({ cls: "codex-message codex-assistant" }), Body = Card.createDiv({ cls: "codex-message-body markdown-rendered" });
	const Render = new Component(); Render.load(); const Data = new Map<string, string>(); let Followup: unknown, Copied = "", Alive = true;
	const Cleanup = async () =>
	{
		Alive = false; ModalValue.close(); Render.unload();
		for(const Leaf of AppValue.workspace.getLeavesOfType("markdown")) { if((Leaf.view as any).file?.path === File.path) { Leaf.detach(); } }
		const Owned = AppValue.vault.getAbstractFileByPath(Folder);
		if(Owned?.path === Folder && "children" in Owned && (Owned as any).children.every((C: any) => C.path === File.path)) { await AppValue.vault.delete(Owned, true); }
		if(Previous?.view.containerEl.isConnected) { AppValue.workspace.setActiveLeaf(Previous, { focus: true }); }
	};
	(window as any).__codexStructuresNative = { cleanup: Cleanup };
	await MarkdownRenderer.render(AppValue, Answer, Body, File.path, Render);
	const Options = { Scope: Folder, SessionId: "original", MessageId: "structures", Contexts: [Context], Sources: source_reference(Context), Storage: { getItem: (K: string) => Data.get(K) ?? null, setItem: (K: string, V: string) => { Data.set(K, V); } }, Active: () => Alive, Markdown: (T: string, Root: HTMLElement) => MarkdownRenderer.render(AppValue, T, Root, File.path, Render), OpenSource: async (Ref: any) => (await open_source(AppValue, Ref)).Message, Followup: (Question: string, Selection: string) => { Followup = { Question, Selection }; }, Copy: async (T: string) => { Copied = T; } };
	const Output = interactive_output(Answer, true); if(Output.Status !== "ready") { throw Error("Fixture rejected: " + Output.Error); }
	let Dispose = await render_interactive(Card, Body, Answer, Output, Options); ModalValue.open();
	const Relation = () => Card.querySelector(".codex-relation")!, Walk = () => Card.querySelector(".codex-walkthrough")!;
	const Nodes = () => [...Relation().querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
	const Next = () => Walk().querySelector<HTMLButtonElement>(".codex-walkthrough-next")!;
	const BeforePosition = Walk().querySelector(".codex-walkthrough-position")!.textContent;
	Nodes().at(-1)!.click(); Next().click(); await new Promise(R => setTimeout(R, 350));
	const Position = Walk().querySelector(".codex-walkthrough-position")!.textContent;
	if(Nodes().at(-1)!.getAttribute("aria-pressed") !== "true" || Position === BeforePosition || Walk().querySelectorAll('[aria-pressed="true"]').length !== 1) { throw Error("Native selection failed"); }
	Walk().querySelector<HTMLButtonElement>('[data-action="plain"]')!.click();
	Card.querySelector<HTMLButtonElement>(".codex-interactive-copy")!.click(); await new Promise(R => setTimeout(R, 50));
	if(!Copied.includes("定义域") || !Copied.includes("展开") || Copied.includes("```codex-ui") || !(Followup as any)?.Question.includes("整合后的完整说明")) { throw Error("Native action or reading export incomplete"); }
	Dispose(); Dispose = await render_interactive(Card, Body, Answer, Output, Options);
	await new Promise(R => setTimeout(R, 100));
	if(Nodes().at(-1)!.getAttribute("aria-pressed") !== "true" || Walk().querySelector(".codex-walkthrough-position")!.textContent !== Position) { throw Error("Native reopened selections lost"); }
	Render.register(Dispose);
	const Report = { tier: "native Obsidian MarkdownRenderer/MathJax and controls with disposable local storage adapter, not iPad/model", mathNodes: Card.querySelectorAll("mjx-container").length, relations: Card.querySelectorAll(".codex-relation").length, walkthroughs: Card.querySelectorAll(".codex-walkthrough").length, selectedNodeRestored: true, selectedStepRestored: true, integratedDraftAction: true, completeReadingCopy: true, stateRecords: Data.size, bodyProofRetained: Body.textContent?.includes("因而") };
	(window as any).__codexStructuresNative = { Report, card: Card, modal: ModalValue, cleanup: Cleanup };
	return Report;
}
