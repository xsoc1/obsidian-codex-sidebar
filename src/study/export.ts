import type { StudyExercise } from "./store";

export function exercise_markdown(Exercises: StudyExercise[], IncludeAnswers: boolean): string
{
	return "# 练习导出\n\n" + Exercises.map(Value => `## ${Value.Id}\n\n来源: [[${Value.Source.Path}]]; ${Value.CreatedAt}; ${Value.Stale ? "原文版本已变化" : "捕获版本"}. 解答状态: ${Value.Content.verification}.\n\n${Value.Content.statement}\n\n` + Value.Content.hints.map((Hint, Index) => `> [!tip]- 提示 ${Index + 1}\n> ${Hint.replace(/\n/g, "\n> ")}\n`).join("\n") + (IncludeAnswers ? `\n> [!note]- 解答 (未独立核验)\n> ${(Value.Content.solution ?? "尚无解答").replace(/\n/g, "\n> ")}\n` : "") + `\n^${Value.Id}\n`).join("\n");
}
export function reading_markdown(Text: string): string
{
	// Ordinary Markdown already is the portable reading edition. Never remove main proofs.
	return Text;
}
export function latex_source(Text: string): string
{
	if(/```|~~~|!\[|!\[\[|<\/?[a-zA-Z][^>]*>|^\|/m.test(Text) || /\\(?:input|include|write|openout|read|catcode|usepackage|documentclass|immediate|special|csname|def|newcommand)\b/i.test(Text))
	{
		throw new Error("含不支持的代码、表格、图像、HTML 或 TeX 命令; 请先导出 Markdown");
	}
	let Math = false;
	const Escape = (Value: string) => Value.replace(/[\\{}%&#_^~$]/g, Value => Value === "\\" ? "\\textbackslash{}" : Value === "^" ? "\\textasciicircum{}" : Value === "~" ? "\\textasciitilde{}" : `\\${Value}`);
	const Lines = Text.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
	const Body = Lines.map(Line =>
	{
		if(/^\^[A-Za-z0-9-]+\s*$/.test(Line))
		{
			return `\\label{${Line.trim().slice(1)}}`;
		}
		const Clean = Line.replace(/^> ?/, "");
		if(/^\[![a-zA-Z-]+\][+-]?/.test(Clean))
		{
			return "\\paragraph{" + Escape(Clean.replace(/^\[![a-zA-Z-]+\][+-]?\s*/, "")) + "}";
		}
		if(Clean.trim() === "$$")
		{
			Math = !Math; return Math ? "\\[" : "\\]";
		}
		if(Math)
		{
			return Clean;
		}
		if(Clean.includes("$$"))
		{
			throw new Error("仅支持独立行 $$ 行间公式");
		}
		const RawHeading = Clean.match(/^(#{1,6}) (.*)$/);
		const Parts = (RawHeading?.[2] ?? Clean).split(/(\$[^$\n]+\$)/g);
		const Content = Parts.map((Part, Index) => Index % 2 ? Part : Escape(Part.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, Path, Label) => Label ?? Path).replace(/\*\*/g, ""))).join("");
		if(RawHeading)
		{
			return `\\${RawHeading[1].length === 1 ? "section" : RawHeading[1].length === 2 ? "subsection" : "subsubsection"}*{${Content}}`;
		}
		return Content.replace(/^[-*] /, "\\noindent\\textbullet{} ") + (Content ? "\n" : "");
	}).join("\n");
	if(Math)
	{
		throw new Error("行间公式未闭合");
	}
	return "% Supported Markdown subset only; no compilation performed.\n\\documentclass[UTF8]{ctexart}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n" + Body + "\n\\end{document}\n";
}
