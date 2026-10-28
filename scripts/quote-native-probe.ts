// Original differential fixtures with the real Markdown renderer and MathJax.
import { Component, MarkdownRenderer, type App } from "obsidian";
import { bind_answer_blocks, quote_blocks, answer_quote } from "../src/quote";

export async function quote_native_probe(AppValue: App)
{
	const Prefix = "# Original\n\n" + Array.from({ length: 90 }, (_, I) => `${I}: ` + "完整论证说明".repeat(90)).join("\n\n");
	const Formula = "$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$", Cases = [
		{ name: "tail-without-hr", source: Prefix + "\n\n" + Formula + "\n\nTail result." },
		{ name: "tail-with-hr", source: Prefix + "\n\n---\n\n" + Formula + "\n\nTail result." },
		{ name: "mixed-structures", source: Prefix + "\n\n---\n\n## Calculation\n\n- First item\n- Second item\n\n| Symbol | Meaning |\n| --- | --- |\n| x | Variable |\n\nFootnote text[^one].\n\n" + Formula + "\n\nTail result.\n\n[^one]: An original footnote." },
		{ name: "short-analysis", source: "# Original analysis\n\n设 $f$ 是区间 $[0,1]$ 上的连续实函数.\n\n---\n\n$$\n\\left|\\int_0^1 f(t)\\,dt\\right|\\leq\\int_0^1 |f(t)|\\,dt\\leq\\lVert f\\rVert_\\infty.\n$$\n\n第一次不等式由积分的单调性得到, 第二次使用 $|f(t)|\\leq\\lVert f\\rVert_\\infty$ 和区间长度为一." }
	];
	const Results: unknown[] = [];
	for(const Case of Cases)
	{
		const Root = document.createElement("div"), Render = new Component(); Render.load(); Root.className = "markdown-rendered"; Root.style.cssText = "position:fixed;left:-10000px;top:0;width:420px"; document.body.appendChild(Root);
		try
		{
			await MarkdownRenderer.render(AppValue, Case.source, Root, "Original.md", Render);
			const Extra = Root.createDiv(); Extra.textContent = "Original test renderer extension"; Root.insertBefore(Extra, Root.children[2] ?? null);
			const Bound = bind_answer_blocks(Root, Case.source), Math = Root.querySelector('mjx-container[display="true"]');
			if(!Bound || !Math) { throw Error("Native block mapping failed: " + JSON.stringify({ name: Case.name, bound: Bound, children: [...Root.children].map(N => ({ tag: N.tagName, cls: N.className })), math: !!Math })); }
			const RangeValue = document.createRange(); RangeValue.selectNodeContents(Math);
			const Location = quote_blocks(Root, RangeValue, Case.source), Quote = answer_quote("original-session", "original-answer", Math.textContent ?? "selected integral", Case.source, "completed", Location);
			if(Quote.Mapping !== "source-blocks" || !Quote.SourceText.includes("\\int_0^1") || (Case.name !== "short-analysis" && (!Quote.SourceRange || Quote.SourceRange.From < 24000 || !Quote.SourceText.includes("Tail result.")))) { throw Error("Native formula omitted its original Markdown: " + Case.name + JSON.stringify(Location)); }
			if(quote_blocks(Root, RangeValue, Case.source + " changed").Mapping !== "unknown") { throw Error("Stale source mapping accepted"); }
			Results.push({ name: Case.name, sourceChars: Case.source.length, renderedBlocks: Root.children.length, mappedBlocks: Root.querySelectorAll("[data-codex-answer-block]").length, nativeMath: true, tailMarkdownIncluded: true, sourceWindowFrom: Quote.SourceRange?.From, sourceWindowChars: Quote.SourceText.length, fullAnswerHonestlyTruncated: Quote.SourceTruncated, staleRejected: true });
		}
		finally { Root.remove(); Render.unload(); }
	}
	return { tier: "native MarkdownRenderer + MathJax original source, not installed daily UI/iPad", cases: Results, noMessageOrNoteWrites: true };
}
