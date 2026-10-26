// Opt-in temporary SDK plugin. Original samples only; no chat/model/vault writes.
import { Plugin, Component, MarkdownRenderer, finishRenderMath } from "obsidian";
import { MessageList, type MessageRender } from "../src/message-list";

export default class StreamNativeProbe extends Plugin
{
	async run(ExpectCached = true): Promise<unknown>
	{
		const Root = document.body.createDiv({ cls: "codex-sidebar" });
		Root.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:480px";
		const Body = Root.createDiv({ cls: "codex-messages" }); Body.style.overflowAnchor = "none"; Body.style.scrollBehavior = "auto";
		const List = new MessageList(Body), Heights: number[] = [];
		this.register(() => { List.dispose(); Root.remove(); });
		let Count = 0, Collect = false;
		const item = (Id: string, Text: string): MessageRender => ({ Id, Key: Text, Render: async () =>
		{
			Count++; const ComponentValue = new Component(); ComponentValue.load();
			const Element = document.createElement("div"); Element.className = "codex-message codex-assistant";
			try
			{
				const Markdown = Element.createDiv({ cls: "codex-message-body markdown-rendered" });
				await MarkdownRenderer.render(this.app, Text, Markdown, "", ComponentValue);
				if(Collect) { Heights.push(Body.scrollHeight); }
				return { Element, Dispose: () => ComponentValue.unload() };
			}
			catch(ErrorValue) { ComponentValue.unload(); throw ErrorValue; }
		} });
		try
		{
			const HistoryText = ("原创微型李代数例子: 令 $H=\\operatorname{diag}(1,-1)$, $E=E_{12}$.\n\n$$\n[H,E]=HE-EH=2E.\n$$\n\n").repeat(12);
			await List.update("original", [item("history", HistoryText), item("stream", "先计算两个矩阵的乘积.")], () => true); await finishRenderMath();
			const History = Body.firstElementChild, BeforeHeight = Body.scrollHeight; Collect = true; Count = 0;
			for(let Index = 1; Index <= 5; Index++)
			{
				await List.update("original", [item("history", HistoryText), item("stream", "先计算两个矩阵的乘积.\n\n" + "由 $HE=E$, $EH=-E$, 得到 $[H,E]=2E$.\n\n".repeat(Index))], () => true);
			}
			await finishRenderMath();
			const Maths = Body.querySelectorAll("mjx-container").length, Errors = Body.querySelectorAll("mjx-merror,.MathJax_Error").length;
			if(Body.firstElementChild !== History || Math.min(...Heights) < BeforeHeight || Count !== 5 || !Maths || Errors) { throw Error("Native stream/MathJax component check failed"); }
			const ChangedRenders = Count, CachedMath = History!.querySelector("mjx-container"), LastText = "先计算两个矩阵的乘积.\n\n" + "由 $HE=E$, $EH=-E$, 得到 $[H,E]=2E$.\n\n".repeat(5);
			Collect = false; Body.scrollTop = 50; Body.dispatchEvent(new Event("scroll")); const ReadingTop = Body.scrollTop;
			await List.update("another-note", [item("other", "原创的另一篇笔记.")], () => true);
			const PriorCount = Count, Started = performance.now();
			await List.update("original", [item("history", HistoryText), item("stream", LastText)], () => true);
			const ReturnMilliseconds = performance.now() - Started, ReturnRenders = Count - PriorCount;
			const Cached = Body.firstElementChild === History && Body.querySelector("mjx-container") === CachedMath;
			if(ExpectCached && (!Cached || ReturnRenders || Math.abs(Body.scrollTop - ReadingTop) > 1)) { throw Error("Native note return rerendered history or lost reading position"); }
			if(!ExpectCached && (Cached || ReturnRenders !== 2)) { throw Error("Native baseline failed to reproduce full return rendering"); }
			return { tier: "native SDK component with real Markdown/MathJax, not main-sidebar inference/iPad acceptance", beforeHeight: BeforeHeight, minimumHeight: Math.min(...Heights), historyPreserved: true, changedCardRenders: ChangedRenders, mathNodes: Maths, mathErrors: Errors, returnMilliseconds: ReturnMilliseconds, returnRenderCalls: ReturnRenders, mathNodesReused: Cached, readingPreserved: Math.abs(Body.scrollTop - ReadingTop) < 1 };
		}
		finally { List.dispose(); Root.remove(); }
	}
}
