import { Plugin, Component } from "obsidian";
import { render_comparison } from "../src/study/comparison";

export default class ComparisonProbe extends Plugin
{
	async run(Css: string): Promise<object>
	{
		const Root = document.body.createDiv({ cls: "codex-comparison-probe" });
		Root.style.cssText = "position:fixed;right:24px;top:70px;width:640px;max-width:calc(100vw - 48px);max-height:75vh;overflow:auto;z-index:2000;background:var(--background-primary);padding:16px;border:1px solid var(--background-modifier-border)";
		const Style = document.head.createEl("style"); Style.textContent = Css;
		this.register(() => { Root.remove(); Style.remove(); });
		const Render = new Component(); this.addChild(Render);
		Root.createEl("strong", { text: "原创公式对照验收" });
		const Original = "$$\n\\begin{aligned}\nf(a+b)&=(a+b)^2\\\\\n\n&=a^2+b^2\n\\end{aligned}\n$$";
		const Before = "# 原创分析样本\n\n保留前文.\n\n" + Original + "\n\n保留后文.", From = Before.indexOf("a^2+b^2");
		const After = Before.slice(0, From) + "a^2+2ab+b^2" + Before.slice(From + "a^2+b^2".length);
		render_comparison(this.app, Root, Before, After, "Original-analysis.md", Render, { From, To: From + "a^2+b^2".length });
		const Lie = Root.createDiv();
		render_comparison(this.app, Lie, "证明: $[h,e]=e$.", "证明: $[h,e]=2e$.", "Original-lie.md", Render);
		for(let Index = 0; Index < 200 && Root.querySelectorAll("mjx-container").length < 4; Index++) { await new Promise(Resolve => setTimeout(Resolve, 50)); }
		const Bodies = [...Root.querySelectorAll(".codex-comparison-body")];
		const Report = { mathPerSide: Bodies.map(Box => Box.querySelectorAll("mjx-container").length), mathErrors: Root.querySelectorAll("mjx-merror,.math-error").length, rawDiffs: [...Root.querySelectorAll("pre.codex-edit-diff")].filter(Box => Box.textContent?.startsWith("--- 原文")).length, rawFolded: [...Root.querySelectorAll("details")].filter(Box => Box.querySelector(":scope > summary")?.textContent?.startsWith("查看原始字符差异")).every(Box => !Box.open), hover: Root.querySelectorAll("[title],[aria-label]").length };
		if(Report.mathPerSide.length !== 4 || Report.mathPerSide.some(Value => Value < 1) || Report.mathErrors || Report.rawDiffs !== 2 || !Report.rawFolded) { throw new Error(JSON.stringify(Report)); }
		Root.style.width = "320px";
		return { ...Report, narrowOverflow: Root.scrollWidth > Root.clientWidth, tier: "native Windows temporary component; original material only" };
	}
}
