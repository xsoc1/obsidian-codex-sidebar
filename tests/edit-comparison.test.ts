import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { comparison_texts } from "../src/edit/comparison-text";

class Element
{
	children: Element[] = [];
	dataset: Record<string, string> = {};
	textContent = "";
	open = false;
	disabled = false;
	isConnected = true;
	Listeners = new Map<string, () => void>();
	constructor(readonly Tag = "div") { }
	createEl(Tag: string, Options: any = {}): any { const Child = new Element(Tag); Child.textContent = Options.text ?? ""; this.children.push(Child); return Child; }
	createDiv(Options?: any): any { return this.createEl("div", Options); }
	addEventListener(Name: string, Callback: () => void): void { this.Listeners.set(Name, Callback); }
	setText(Text: string): void { this.textContent = Text; }
	all(): Element[] { return [this, ...this.children.flatMap(Value => Value.all())]; }
}

test("edit differences render complete original and proposed formula contexts; raw +/- diff stays separately available", async () =>
{
	const Rendered: string[] = [], Export = { exports: {} as any };
	const Code = buildSync({ entryPoints: ["src/edit/panel.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"] }).outputFiles[0].text;
	runInNewContext(Code, { module: Export, exports: Export.exports, require: () => ({ Modal: class { }, MarkdownRenderer: { render: async (_: unknown, Text: string) => { Rendered.push(Text); } } }) });
	const Original = "$$\n\\begin{aligned}\nx&=1\\\\\ny&=2\n\\end{aligned}\n$$", Replacement = Original.replace("y&=2", "y&=3");
	const Before = "保留前文.\n\n" + Original + "\n\n保留后文.", From = Before.indexOf(Original);
	const Target = { Path: "Original.md", Before, Range: { From, To: From + Original.length } };
	const Task = { Id: "original-task", Source: { Path: "Original.md" }, Role: "note", EditMode: "ai", Target };
	const Record = { Spec: Task, Status: "complete", Output: { status: "proposal", markdown: Replacement, rationale: "Original test fixture" } };
	const Plan = { Id: "original-plan", TaskId: Task.Id, Target, After: Before.slice(0, From) + Replacement + Before.slice(From + Original.length), State: "preview" };
	const Root = new Element(), Component = { register: () => {} };
	await Export.exports.render_edit({}, Root, { Store: { Data: { Records: [Record], Writes: [Plan] } } }, Task, Component, () => {});
	assert.equal(Root.dataset.editStructured, "true", "edit controls and source comparisons must not become assistant-answer quotes");
	await new Promise(Resolve => setTimeout(Resolve, 0));
	assert.ok(Rendered.includes(Original), "the old formula must be rendered, not left only in a PRE diff");
	assert.ok(Rendered.includes(Replacement), "the proposed formula must be rendered without +/- line prefixes");
	assert.ok(Rendered.every(Text => !/^[-+]\$\$/m.test(Text)));
	const Raw = Root.all().find(Value => Value.Tag === "pre" && Value.textContent.startsWith("--- 原文"));
	assert.ok(Raw, "the exact character diff remains available for source-level review");
	assert.ok(Root.all().some(Value => Value.Tag === "button" && Value.textContent === "确认写入此文件"));
});

test("formula comparisons expand partial inline/display ranges without changing the actual write range or source strings", () =>
{
	const Before = "前段保留.\n\n说明 $x^2+1=3$.\n\n$$\n\\begin{aligned}\nf(x)&=x^2\\\\\n\n&=1\n\\end{aligned}\n$$\n\n后文保留.";
	const Inline = Before.indexOf("3"), InlineAfter = Before.slice(0, Inline) + "2" + Before.slice(Inline + 1);
	const First = comparison_texts(Before, InlineAfter, { From: Inline, To: Inline + 1 });
	assert.equal(First.Before, "说明 $x^2+1=3$."); assert.equal(First.After, "说明 $x^2+1=2$."); assert.equal(First.Expanded, true);
	const From = Before.indexOf("&=1"), Next = Before.slice(0, From) + "&=2" + Before.slice(From + 3);
	const Result = comparison_texts(Before, Next, { From, To: From + 3 });
	assert.ok(Result.Before.startsWith("$$\n")); assert.ok(Result.Before.endsWith("\n$$"));
	assert.match(Result.After, /&=2/); assert.equal(Result.RawOnly, false); assert.equal(Result.Expanded, true);
	assert.equal(Before.includes("&=1"), true);
	assert.throws(() => comparison_texts(Before, "unrelated", { From, To: From + 3 }), /对照范围/);
});

test("new-file/deletion and incomplete or oversized formula contexts remain exact and never pretend partial TeX is complete", () =>
{
	assert.deepEqual(comparison_texts(null, "# New\n\n$x=1$"), { Before: "", After: "# New\n\n$x=1$", Expanded: false, RawOnly: false });
	const Deleted = comparison_texts("$x=1$", "", { From: 0, To: 5 }); assert.equal(Deleted.After, "");
	assert.equal(comparison_texts("$$\nx=1", "$$\nx=2", { From: 5, To: 6 }).RawOnly, true);
	assert.equal(comparison_texts("$x=1$", "$$\nx=1", { From: 0, To: 5 }).RawOnly, true);
	const Big = "$$\n" + "x".repeat(81000) + "\n$$", From = 20;
	const Context = comparison_texts(Big, Big.slice(0, From) + "y" + Big.slice(From + 1), { From, To: From + 1 });
	assert.equal(Context.RawOnly, true); assert.equal(Context.Before, "x"); assert.equal(Context.After, "y");
});

test("a slow Markdown renderer cannot hide confirmation controls or discard exact source diffs", async () =>
{
	const Export = { exports: {} as any }, Root = new Element(); let Release!: () => void;
	const Waiting = new Promise<void>(Resolve => Release = Resolve);
	const Code = buildSync({ entryPoints: ["src/edit/panel.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"] }).outputFiles[0].text;
	runInNewContext(Code, { module: Export, exports: Export.exports, require: () => ({ Modal: class { }, MarkdownRenderer: { render: () => Waiting } }) });
	const Target = { Path: "Original.md", Before: "$x=1$", Range: { From: 0, To: 5 } }, Task = { Id: "test", Target, Source: { Path: "Original.md" } };
	await Export.exports.render_edit({}, Root, { Store: { Data: { Records: [{ Spec: Task, Output: { status: "proposal", markdown: "$x=2$" } }], Writes: [{ Id: "p", TaskId: "test", Target, After: "$x=2$", State: "preview" }] } } }, Task, { register: () => {} }, () => {});
	assert.ok(Root.all().some(Value => Value.Tag === "button" && Value.textContent === "确认写入此文件"));
	assert.ok(Root.all().some(Value => Value.Tag === "pre" && Value.textContent.startsWith("--- 原文")));
	Release(); await new Promise(Resolve => setTimeout(Resolve, 0));
});
