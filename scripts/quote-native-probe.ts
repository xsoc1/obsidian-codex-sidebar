// Original long-answer block mapping with the real Markdown renderer and MathJax.
import { Component, MarkdownRenderer, type App } from "obsidian";
import { bind_answer_blocks, quote_blocks, answer_quote } from "../src/quote";

export async function quote_native_probe(AppValue: App)
{
	const Source = "# Original\n\n" + Array.from({ length: 90 }, () => "Repeated original paragraph. " + "An original explanation connects the assumptions and the next calculation. ".repeat(6)).join("\n\n") + "\n\n$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$\n\nTail result.";
	const Root = document.createElement("div"), Render = new Component(); Render.load(); Root.className = "markdown-rendered"; Root.style.cssText = "position:fixed;left:-10000px;top:0;width:420px"; document.body.appendChild(Root);
	try
	{
		await MarkdownRenderer.render(AppValue, Source, Root, "Original.md", Render);
		const Bound = bind_answer_blocks(Root, Source), Math = Root.querySelector("mjx-container");
		if(!Bound || !Math) { throw Error("Native block mapping failed: " + JSON.stringify({ bound: Bound, children: [...Root.children].map(N => ({ tag: N.tagName, cls: N.className })), math: !!Math })); }
		const RangeValue = document.createRange(); RangeValue.selectNodeContents(Math);
		const Location = quote_blocks(Root, RangeValue, Source), Quote = answer_quote("original-session", "original-answer", Math.textContent ?? "selected integral", Source, "completed", Location);
		if(Quote.Mapping !== "source-blocks" || !Quote.SourceRange || Quote.SourceRange.From < 24000 || !Quote.SourceText.includes("\\int_0^1") || !Quote.SourceText.includes("Tail result.")) { throw Error("Native tail formula omitted its original Markdown"); }
		return { tier: "native MarkdownRenderer + MathJax original long answer, not installed daily UI/iPad", sourceChars: Source.length, renderedBlocks: Root.children.length, boundSourceBlocks: Bound, nativeMath: true, selectionUsesWholeSourceBlocks: true, tailMarkdownIncluded: true, sourceWindowFrom: Quote.SourceRange.From, sourceWindowChars: Quote.SourceText.length, fullAnswerHonestlyTruncated: Quote.SourceTruncated, noMessageOrNoteWrites: true };
	}
	finally { Root.remove(); Render.unload(); }
}
