import { Component, MarkdownRenderer, Modal, type App } from "obsidian";
import { interactive_output } from "../src/interactive/protocol";
import { render_interactive } from "../src/interactive/panel";
import { bind_answer_blocks, quote_blocks } from "../src/quote";
import { source_reference, open_source } from "../src/sources";
import { version_of } from "../src/edit/document";
import type { ContextSnapshot } from "../src/prompt";

export async function interactive_native_probe(AppValue: App, Markdown: string)
{
	const Folder = "Codex Sidebar 验收-Interactive-" + crypto.randomUUID().slice(0, 8), Previous = AppValue.workspace.activeLeaf;
	await AppValue.vault.createFolder(Folder); const File = await AppValue.vault.create(Folder + "/原创热方程.md", Markdown);
	const Context: ContextSnapshot = { Path: File.path, Mode: "阅读", Kind: "当前位置", Mapping: "源块", Text: Markdown, SelectedText: "", LineStart: 0, LineEnd: Markdown.split("\n").length - 1, Heading: "一个热方程解", CapturedAt: new Date().toISOString(), Truncated: false, Version: await version_of(Markdown) };
	const ModalValue = new Modal(AppValue); ModalValue.setTitle("Codex 交互答案 · 原创样例验收"); ModalValue.modalEl.style.width = "510px"; ModalValue.modalEl.style.maxHeight = "88vh";
	const Card = ModalValue.contentEl.createDiv({ cls: "codex-message codex-assistant" }), Body = Card.createDiv({ cls: "codex-message-body markdown-rendered" });
	const Render = new Component(); Render.load(); const Data = new Map<string, string>(); let Followup: unknown, Copied = "", Opened = "";
	const Cleanup = async () =>
	{
		ModalValue.close(); Render.unload();
		for(const Leaf of AppValue.workspace.getLeavesOfType("markdown")) { if((Leaf.view as any).file?.path === File.path) { Leaf.detach(); } }
		const F = AppValue.vault.getAbstractFileByPath(Folder);
		if(F?.path === Folder && "children" in F && (F as any).children.every((C: any) => C.path === File.path)) { await AppValue.vault.delete(F, true); }
		if(Previous?.view.containerEl.isConnected) { AppValue.workspace.setActiveLeaf(Previous, { focus: true }); }
	};
	(window as any).__codexInteractiveNative = { cleanup: Cleanup };
	const Answer = Markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
	await MarkdownRenderer.render(AppValue, Answer, Body, File.path, Render); bind_answer_blocks(Body, Answer, "native-interactive");
	const Dispose = await render_interactive(Card, Body, Answer, interactive_output(Answer, true), {
		Scope: Folder, SessionId: "original-native-session", MessageId: "original-native-answer", Contexts: [Context], Sources: source_reference(Context),
		Storage: { getItem: Key => Data.get(Key) ?? null, setItem: (Key, Value) => { Data.set(Key, Value); } }, Active: () => true,
		Markdown: (Text, Root) => MarkdownRenderer.render(AppValue, Text, Root, File.path, Render),
		OpenSource: async Ref => { const Result = await open_source(AppValue, Ref); Opened = Result.Status; return Result.Message; },
		Followup: (Question, Selection) => { Followup = { Question, Selection }; }, Copy: async Text => { Copied = Text; }
	});
	Render.register(Dispose); ModalValue.open();
	const Slider = Card.querySelector<HTMLInputElement>('input[type="range"]')!, Path = Card.querySelector(".codex-plot-path")!, Before = Path.getAttribute("d");
	Slider.value = "2"; Slider.dispatchEvent(new Event("input", { bubbles: true }));
	if(Path.getAttribute("d") === Before || Data.size !== 1 || Card.querySelector(".codex-plot-path") !== Path) { throw Error("Native slider failed to update/persist in place"); }
	const LastSymbol = [...Card.querySelectorAll<HTMLButtonElement>(".codex-symbol-choice")].at(-1)!; LastSymbol.click();
	await new Promise(R => setTimeout(R, 350));
	(Card.querySelector(".codex-interactive-copy") as HTMLButtonElement).click(); await new Promise(R => setTimeout(R, 20));
	const Formula = Body.querySelector('mjx-container[display="true"]')!;
	const Selection = document.createRange(); Selection.selectNodeContents(Formula); const Mapping = quote_blocks(Body, Selection, Answer, "native-interactive");
	if(Mapping.Mapping !== "source-blocks" || !Copied.includes('"t":2') || Copied.includes("```codex-ui")) { throw Error("Native source mapping/static copy failed: " + JSON.stringify({ Mapping, Copied: Copied.slice(-1200) })); }
	const Maths = [...Body.querySelectorAll(".math-inline")].slice(0, 2).map(M => M.outerHTML.slice(0, 500));
	const Report = { tier: "native MarkdownRenderer/MathJax, SVG, input and source navigation; no model/iPad", mathNodes: Card.querySelectorAll("mjx-container").length, sliderInPlace: true, localStateSaved: true, mapping: Mapping.Mapping, copiedReading: true, symbolSource: Card.querySelector(".codex-symbol-origin")?.textContent, inlineMathMarkup: Maths };
	(window as any).__codexInteractiveNative = { Report, cleanup: Cleanup, card: Card, modal: ModalValue, followup: () => Followup, copied: () => Copied, opened: () => Opened };
	return Report;
}
