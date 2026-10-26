import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { markdown_blocks, context_window } from "../src/markdown-blocks";
import { bind_edit } from "../src/edit/protocol";

test("Markdown boundaries retain complete equations, callout conditions, fenced code, lists and tables", () =>
{
	const Source = ["# Original", "", "> [!note] 条件", "> 假设 $a>0$.", "", "证明第一步.", "", "$$", "\\begin{aligned}", "a&=b+c,\\\\", "d&=e-f.", "\\end{aligned}", "$$", "", "因此成立.", "", "```text", "literal $$ does not open mathematics", "```", "", "- 一项", "  续行", "- 第二项", "", "符号 | 用途", "--- | ---", "$a$ | 正数"].join("\n");
	const Blocks = markdown_blocks(Source), Math = Blocks.find(B => B.Kind === "math")!;
	assert.equal(Math.Closed, true); assert.match(Math.Text, /\\begin\{aligned\}/); assert.ok(Math.Text.endsWith("$$"));
	const Focus = Source.indexOf("d&="), Window = context_window(Source, Focus, Focus + 4);
	assert.match(Window.Text, /假设 \$a>0\$/); assert.match(Window.Text, /\\end\{aligned\}/); assert.equal(Window.Closed, true);
	assert.deepEqual(Blocks.slice(-3).map(B => B.Kind), ["code", "list", "table"]);
	const Quoted = markdown_blocks("> [!note] literal\n> ```text\n> $$\n> ```\n\nplain"); assert.equal(Quoted[0].Closed, true); assert.equal(Quoted[1].Kind, "paragraph");
	const Nested = markdown_blocks("- 条件\n  $$\n  x=1\n  $$\n- 后续\n\n下一段"); assert.equal(Nested[0].Kind, "list"); assert.equal(Nested[0].Closed, true); assert.equal(Nested[1].Kind, "paragraph");
	assert.equal(markdown_blocks("- 公式\n  $$\n  x=1")[0].Closed, false);
});

test("over-budget mathematics is centred on the actual selection and marks missing source instead of inventing closure", () =>
{
	const Source = "$$\n\\begin{aligned}\n" + Array.from({ length: 300 }, (_, I) => `a_{${I}}&=b_{${I}}+c_{${I}},\\\\`).join("\n") + "\n\\end{aligned}\n$$";
	const From = Source.indexOf("a_{270}"), Window = context_window(Source, From, From + 16, 400);
	assert.ok(Window.Text.includes("a_{270}")); assert.equal(Window.Text, Source.slice(Window.From, Window.To)); assert.ok(Window.Text.length <= 400);
	assert.equal(Window.Truncated, true); assert.equal(Window.Closed, false); assert.ok(Window.Missing.length); assert.ok(!Window.Text.endsWith("\\end{aligned}\n$$"));
	const Unclosed = context_window("$$\nx=1\n", 4, 7); assert.equal(Unclosed.Closed, false); assert.equal(Unclosed.Truncated, true);
});

test("actual editor capture expands explanation without expanding the precise allowed write selection", async () =>
{
	const Code = buildSync({ entryPoints: ["src/context.ts"], bundle: true, platform: "browser", format: "cjs", write: false, external: ["obsidian"] }).outputFiles[0].text;
	class MarkdownView { }
	const Module = { exports: {} as any };
	runInNewContext(Code, { module: Module, exports: Module.exports, require: () => ({ MarkdownView }), crypto: webcrypto, TextEncoder, Uint8Array, atob, setTimeout, clearTimeout, Map, Set });
	const Source = "# Original\n\n> [!note] 条件\n> $a>0$.\n\n$$\n\\begin{aligned}\na&=b+c,\\\\\nd&=e-f.\n\\end{aligned}\n$$\n\n因此成立.";
	const From = Source.indexOf("d&="), To = From + "d&=e-f.".length, Lines = Source.split("\n"), Position = (Offset: number) => ({ line: Source.slice(0, Offset).split("\n").length - 1, ch: Offset - Source.lastIndexOf("\n", Offset - 1) - 1 });
	const F = Position(From), T = Position(To), File = { path: "Original.md", extension: "md" }, View: any = new MarkdownView();
	Object.assign(View, { file: File, containerEl: { isConnected: true }, getViewType: () => "markdown", getViewData: () => Source, getMode: () => "source", editor: { getSelection: () => Source.slice(From, To), getCursor: (Side: string) => Side === "to" ? T : F, posToOffset: (P: any) => Lines.slice(0, P.line).reduce((N, L) => N + L.length + 1, 0) + P.ch, lineCount: () => Lines.length } });
	const Capture = new Module.exports.ContextCapture({ vault: { getName: () => "original", getFileByPath: () => File }, metadataCache: { getFileCache: () => ({ headings: [] }) } }, {});
	const Snapshot = await Capture.capture("选区", View); assert.equal(Snapshot.SelectedText, Source.slice(From, To)); assert.deepEqual(JSON.parse(JSON.stringify(Snapshot.Selection)), { From, To });
	assert.equal(Snapshot.Heading, "Original");
	assert.match(Snapshot.Explanation.Text, /\\begin\{aligned\}/); assert.match(Snapshot.Explanation.Text, /\\end\{aligned\}/); assert.match(Snapshot.Explanation.Text, /条件/);
	const Bound = await bind_edit({ read_current: async () => Source, compare_write: async () => { throw Error("No writes"); } }, Snapshot, "captured");
	assert.deepEqual(Bound.Target.Range, { From, To }); assert.equal(Bound.Source.Text, Source.slice(From, To));
});
