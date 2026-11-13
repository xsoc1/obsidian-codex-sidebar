import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContextSnapshot } from "../src/prompt";
import { source_reference, tool_read_reference, type SourceReference } from "../src/sources";
import { pdf_target, pdf_anchor } from "../src/pdf/target";
import { validate_symbol, locate_symbol, type SymbolSpec } from "../src/interactive/symbols";

const Spec: SymbolSpec = { id: "epsilon", symbol: "$\\varepsilon$", meaning: "误差参数, 取正数.", conditions: "$\\varepsilon>0$", quote: "设 $\\varepsilon>0$." };
function context(Changes: Partial<ContextSnapshot> = {}): ContextSnapshot
{
	return { Path: "Analysis/Original.md", Mode: "编辑", Kind: "选区", Text: "前一行.\n设 $\\varepsilon>0$.\n后续推导.", SelectedText: "设 $\\varepsilon>0$.", LineStart: 10, LineEnd: 12, Heading: "原假设", Mapping: "源文本", CapturedAt: "captured-time", Truncated: false, Version: "original-version", ...Changes };
}
function locate(Context: ContextSnapshot, Quote = Spec.quote!, Refs = source_reference(Context)) { return locate_symbol({ ...Spec, quote: Quote }, [Context], Refs); }

test("symbols: strict plain string fields preserve TeX and multiline explanations without executing data", () =>
{
	const Input = { ...Spec, meaning: "取 $\\varepsilon>0$.\n\n$$\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n$$", quote: "<script>literal source</script>\n```dataviewjs\nsource only\n```" };
	const V = validate_symbol(Input); assert.deepEqual(V, Input); assert.notEqual(V, Input);
	assert.deepEqual(validate_symbol({ ...Spec, conditions: "", quote: "" }), { ...Spec, conditions: "", quote: "" });
	assert.deepEqual(validate_symbol(Object.assign(Object.create(null), Spec)), Spec);
	assert.equal(validate_symbol({ ...Spec, symbol: "$[0,1] \\times \\mathbb{R}$" }).symbol, "$[0,1] \\times \\mathbb{R}$");
});

test("symbols: exact per-field limits reject overflow, missing/type-invalid data and controls", () =>
{
	for(const [Key, Limit] of Object.entries({ id: 64, symbol: 160, meaning: 4000, conditions: 2000, quote: 512 }))
	{
		assert.equal((validate_symbol({ ...Spec, [Key]: "x".repeat(Limit) }) as unknown as Record<string, string>)[Key].length, Limit);
		assert.throws(() => validate_symbol({ ...Spec, [Key]: "x".repeat(Limit + 1) }));
		for(const Value of [null, undefined, 1, true, [], {}, new String("x"), () => "x"]) { assert.throws(() => validate_symbol({ ...Spec, [Key]: Value })); }
		for(const Control of ["\0", "\t", "\b", "\v", "\f", "\u001b", "\u001f", "\u007f", "\u0085"]) { assert.throws(() => validate_symbol({ ...Spec, [Key]: "x" + Control })); }
	}
	for(const Key of ["id", "symbol", "meaning"])
	{
		const Value: any = { ...Spec }; delete Value[Key]; assert.throws(() => validate_symbol(Value));
		assert.throws(() => validate_symbol({ ...Spec, [Key]: "  " }));
	}
	for(const Value of [null, [], [Spec], "{}", new Date(), Object.create(Spec)]) { assert.throws(() => validate_symbol(Value)); }
	assert.equal(validate_symbol({ ...Spec, meaning: "一行\r\n下一行", quote: "原文\r\n下一行" }).quote, "原文\r\n下一行");
});

test("symbols: model paths/actions/scripts, prototypes, hidden/symbol keys and getters are rejected", () =>
{
	for(const Key of ["path", "source", "sourceId", "sources", "action", "js", "script", "onClick", "url", "__proto__", "constructor", "prototype"])
	{
		const Input = JSON.parse(JSON.stringify(Spec)); Object.defineProperty(Input, Key, { value: "../secret.md", enumerable: true });
		assert.throws(() => validate_symbol(Input));
	}
	assert.throws(() => validate_symbol({ ...Spec, [Symbol("path")]: "hidden" }));
	assert.throws(() => validate_symbol(Object.defineProperty({ ...Spec }, "path", { value: "hidden" })));
	let Reads = 0;
	assert.throws(() => validate_symbol(Object.defineProperty({ ...Spec }, "meaning", { get: () => { Reads++; return "danger"; } })));
	assert.equal(Reads, 0);
});

test("symbols: renderer-bound fields reject executable blocks, HTML, embeds and every image form", () =>
{
	for(const Key of ["symbol", "meaning", "conditions"])
	{
		for(const Unsafe of ["```dataviewjs\napp.vault.delete(file)\n```", "~~~js\nalert(1)\n~~~", "<img src=x onerror=alert(1)>", "<!-- hidden HTML -->", "![[Private.md]]", "![image](x.png)", "![image][ref]", "![image]", "[go](javascript:alert(1))"])
		{
			assert.throws(() => validate_symbol({ ...Spec, [Key]: Unsafe }), Key + ": " + Unsafe);
		}
	}
	for(const Unsafe of ["[note](Original.md)", "[[Original|note]]", "[note][ref]", "$x$\n$y$", "x\ry", "x\u2028y", "https://example.com", "$\\href{https://example.com}{x}$", "$\\url{https://example.com}$"])
	{
		assert.throws(() => validate_symbol({ ...Spec, symbol: Unsafe }), Unsafe);
	}
	assert.equal(validate_symbol({ ...Spec, meaning: "参见 [[原文]] 与 [资料](https://example.com)." }).id, Spec.id);
});

test("symbols: exact Markdown quote narrows host anchor and source lines while preserving provenance", () =>
{
	const C = context(), Ref = { ...source_reference(C)[0], CurrentPath: "Moved/Original.md", BlockId: "original-block" }, Before = structuredClone(Ref);
	Object.freeze(Ref); Object.freeze(C);
	const Result = locate(C, Spec.quote, [Ref]);
	assert.equal(Result.Status, "matched"); assert.equal(Result.Source!.LineStart, 11); assert.equal(Result.Source!.LineEnd, 11);
	assert.equal(Result.Source!.Anchor, Spec.quote); assert.equal(Result.Source!.Id, Ref.Id);
	assert.deepEqual(Result.Source, { ...Before, Anchor: Spec.quote, LineStart: 11, LineEnd: 11 });
	assert.deepEqual(Ref, Before); assert.notEqual(Result.Source, Ref); assert.match(Result.Message, /含义和条件仍为 AI/);
});

test("symbols: original source-block formulas match verbatim, never normalized rendered mathematics", () =>
{
	const Formula = "$$\n\\|Tx-Ty\\| \\le q\\|x-y\\|\n$$";
	const C = context({ Mode: "阅读", Mapping: "源块", SelectedText: "∥Tx−Ty∥≤q∥x−y∥", Text: "原式:\n" + Formula, LineStart: 4, LineEnd: 7 });
	const Result = locate(C, Formula); assert.equal(Result.Status, "matched"); assert.equal(Result.Source!.LineStart, 5); assert.equal(Result.Source!.LineEnd, 7);
	assert.equal(locate(C, C.SelectedText).Status, "unverified");
	assert.equal(locate(C, Formula.replace(" \\le ", "\\le")).Status, "unverified");
});

test("symbols: explanatory background uses its original From and LineStart, without borrowing selection lines", () =>
{
	const C = context({ Text: "选中另一段.", SelectedText: "另一段", LineStart: 25, LineEnd: 25, Explanation: { Text: "背景.\n设 $\\varepsilon>0$.\n继续.", From: 200, To: 200 + "背景.\n设 $\\varepsilon>0$.\n继续.".length, LineStart: 20, LineEnd: 22, Closed: true, Truncated: false, Blocks: [], Missing: [] } });
	const Refs = source_reference(C), Result = locate(C);
	assert.equal(Result.Status, "matched"); assert.equal(Result.Source!.Id, Refs[1].Id); assert.equal(Result.Source!.Purpose, "explanation"); assert.equal(Result.Source!.LineStart, 21); assert.deepEqual(Result.Source!.Range, Refs[1].Range);
});

test("symbols: same occurrence in selection/background and repeated host refs is not false ambiguity", () =>
{
	const C = context(); C.Explanation = { Text: "intro\n" + C.Text, From: 100, To: 100 + 6 + C.Text.length, LineStart: 9, LineEnd: 12, Closed: true, Truncated: false, Blocks: [], Missing: [] };
	const Refs = source_reference(C), Result = locate(C, Spec.quote, [...Refs, ...Refs.map(R => ({ ...R, Id: R.Id + "-copy" }))]);
	assert.equal(Result.Status, "matched"); assert.equal(Result.Source!.LineStart, 11);
	assert.equal(locate_symbol(Spec, [C, structuredClone(C)], Refs).Status, "matched");
});

test("symbols: repeated and overlapping body quotes remain ambiguous even when an anchor looks unique", () =>
{
	for(const Text of [Spec.quote + "\n" + Spec.quote, "aaaa"])
	{
		const C = context({ Text, SelectedText: Text === "aaaa" ? "aaa" : Spec.quote!, LineStart: 0, LineEnd: 1 });
		const Result = locate(C, C.SelectedText); assert.equal(Result.Status, "ambiguous"); assert.equal(Result.Source, undefined);
	}
	const C = context(), Other = context({ Path: "Other/Original.md" });
	assert.equal(locate_symbol(Spec, [C, Other], [...source_reference(C), ...source_reference(Other)]).Status, "ambiguous");
});

test("symbols: a second occurrence in broader explanation is not hidden by a unique selected-text quote", () =>
{
	const C = context({ Text: Spec.quote!, SelectedText: Spec.quote!, Selection: { From: 100, To: 100 + Spec.quote!.length } });
	const Text = C.Text + "\n" + C.Text;
	C.Explanation = { Text, From: 100, To: 100 + Text.length, LineStart: 10, LineEnd: 11, Closed: true, Truncated: false, Blocks: [], Missing: [] };
	assert.equal(locate(C).Status, "ambiguous");
});

test("symbols: truncated capture verifies only literal retained text and preserves every truncation flag", () =>
{
	const C = context({ Truncated: true, ContextTruncated: true, SelectedTruncated: false }), Result = locate(C);
	assert.equal(Result.Status, "matched"); assert.equal(Result.Source!.Truncated, true); assert.match(Result.Message, /已截断/);
	assert.equal(locate(C, "未捕获的完整结论").Status, "unverified");
	const Partial = context({ Text: "这一行只捕获了前缀", SelectedText: Spec.quote!, Truncated: true, Selection: { From: 500, To: 500 + Spec.quote!.length }, LineStart: 8 });
	assert.equal(locate(Partial).Status, "matched"); assert.equal(locate(Partial).Source!.LineStart, 8);
});

test("symbols: rendered text may verify the snapshot string but never acquires fake Markdown source lines", () =>
{
	const C = context({ Mapping: "渲染文本", Text: "可见的原句", SelectedText: "可见的原句", LineStart: null, LineEnd: null }), Refs = source_reference(C);
	const Result = locate(C, "原句"); assert.equal(Result.Status, "matched"); assert.deepEqual(Result.Source, Refs[0]);
	assert.equal(Result.Source!.LineStart, null); assert.equal(Result.Source!.Anchor, "可见的原句");
});

test("symbols: absent/wrong quotes and legacy no-source messages degrade without inventing source IDs or paths", () =>
{
	const C = context(), { quote: _Quote, ...NoQuote } = Spec;
	assert.match(locate_symbol(NoQuote, [C], source_reference(C)).Message, /AI 补充说明/);
	assert.equal(locate_symbol(NoQuote, [C], source_reference(C)).Status, "unverified");
	for(const Quote of ["", "   ", "设 ε>0.", "不存在的条件"]) { const R = locate(C, Quote); assert.equal(R.Status, "unverified"); assert.equal(R.Source, undefined); }
	assert.equal(locate_symbol(Spec, [C], []).Status, "unverified"); assert.equal(locate_symbol(Spec, [], source_reference(C)).Status, "unverified");
	for(const Changes of [{ Path: "SameName/Original.md" }, { Version: "other-version" }, { CapturedAt: "different-time" }]) { assert.equal(locate(C, Spec.quote, [{ ...source_reference(C)[0], ...Changes }]).Status, "unverified"); }
});

function pdf_context(Changes: Partial<ContextSnapshot> = {}): ContextSnapshot
{
	return context({ Path: "Original/condition.pdf", Mode: "阅读", Mapping: "PDF文本层", Text: "", SelectedText: "设 $\\varepsilon>0$.", LineStart: null, LineEnd: null, PdfTarget: pdf_target(3, "text", "0,2,0,9"), ...Changes });
}
function page(Number: number, TextLayer = true) { return { Number, TextLayer, Image: { Id: "a".repeat(64), Width: 1000, Height: 1000, Bytes: 100 } }; }

test("symbols: PDF text source retains its encoded selection/page and never fabricates a narrower PDF region", () =>
{
	const C = pdf_context(), Ref = source_reference(C)[0], Result = locate(C, "$\\varepsilon>0$", [Ref]);
	assert.equal(Result.Status, "matched"); assert.deepEqual(Result.Source, Ref); assert.equal(Result.Source!.Page, 3); assert.equal(Result.Source!.Anchor, pdf_anchor(C.PdfTarget!));
	assert.equal(Result.Source!.LineStart, null);
	const Wrong = { ...Ref, Anchor: pdf_anchor(pdf_target(3, "text", "0,1,0,8")) };
	assert.equal(locate(C, Spec.quote, [Wrong]).Status, "unverified");
	assert.equal(locate(C, Ref.Anchor!, [Ref]).Status, "unverified", "an encoded locator is not source text");
});

test("symbols: PDF text plus no-OCR supplementary image verifies only the independent text source", () =>
{
	const C = pdf_context({ Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 4, Pages: [page(3, false)] } }), Refs = source_reference(C);
	assert.equal(Refs.length, 2); const Result = locate(C, Spec.quote, Refs);
	assert.equal(Result.Status, "matched"); assert.equal(Result.Source!.Id, Refs[0].Id); assert.equal(Result.Source!.ImageKind, undefined);
	assert.equal(locate(C, Spec.quote, [Refs[1]]).Status, "unverified");
});

test("symbols: native PDF page wrappers select the actual page text without treating host metadata as OCR", () =>
{
	const C = pdf_context({ PdfTarget: undefined, SelectedText: "", Text: "[PDF 第 2 页 整页图]\n别页内容.\n\n[PDF 第 3 页 整页图]\n" + Spec.quote!, Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 4, Pages: [page(2), page(3)] } });
	const Refs = source_reference(C), Result = locate(C);
	assert.equal(Result.Status, "matched"); assert.deepEqual(Result.Source, Refs[1]); assert.equal(Result.Source!.Page, 3); assert.equal(Result.Source!.Anchor, undefined);
	assert.equal(locate(C, "[PDF 第 3 页 整页图]").Status, "unverified");
	const Duplicated = { ...C, Text: "[PDF 第 2 页 整页图]\n" + Spec.quote + "\n\n[PDF 第 3 页 整页图]\n" + Spec.quote };
	assert.equal(locate(Duplicated).Status, "ambiguous");
});

test("symbols: no-OCR PDF/image text and capture instructions cannot verify model guesses", () =>
{
	const C = pdf_context({ PdfTarget: undefined, Text: "[PDF 第 3 页 整页图]\n无可用文字层, 请依据附带页图识读.", SelectedText: Spec.quote!, Mapping: "PDF页图", Pdf: { schemaVersion: 1, ReadOnly: true, PageCount: 4, Pages: [page(3, false)] } });
	assert.equal(locate(C).Status, "unverified"); assert.equal(locate(C, "无可用文字层").Status, "unverified");
	const One = { ...C, Mapping: "PDF文本层" as const, Text: Spec.quote!, Pdf: { ...C.Pdf!, Pages: [page(3)] } };
	assert.equal(locate(One).Status, "matched");
	assert.equal(locate({ ...One, Text: Spec.quote + "\n" + Spec.quote }).Status, "ambiguous");
});

function tool(Host: SourceReference["Host"] = "windows-copy", Text = "实际补读.\n" + Spec.quote + "\n后文."): SourceReference
{
	return tool_read_reference({ command: "read", params: { path: "Analysis/Original.md" } }, { success: true, contentItems: [{ type: "inputText", text: JSON.stringify({ text: Text, offset: 100, total_chars: 1000, truncated: true, version: "b".repeat(64) }) }] }, Host, "actual-read-time")!;
}

test("symbols: actual-read anchors verify short verbatim quotes while keeping Windows-copy identity", () =>
{
	const Ref = tool(), Before = structuredClone(Ref), Result = locate_symbol(Spec, [], [Ref, { ...Ref, Id: "duplicate-ref" }]);
	assert.equal(Result.Status, "matched"); assert.deepEqual(Result.Source, Before); assert.match(Result.Message, /Windows 副本/); assert.equal(Result.Source!.LineStart, undefined);
	assert.deepEqual(Ref, Before); assert.equal(locate_symbol({ ...Spec, quote: "未读取的后半页" }, [], [Ref]).Status, "unverified");
	assert.equal(locate_symbol(Spec, [], [tool("windows-copy", Spec.quote + "\n" + Spec.quote)]).Status, "ambiguous");
	assert.equal(locate_symbol(Spec, [], [tool("desktop-read")]).Status, "matched");
});

test("symbols: Windows copies cannot borrow the client snapshot or silently replace a matching client source", () =>
{
	const C = context(), Client = source_reference(C)[0];
	for(const Host of ["windows-copy", "desktop-read", "unknown"] as const) { assert.equal(locate(C, Spec.quote, [{ ...Client, Host }]).Status, "unverified"); }
	const Windows = tool(); assert.equal(locate_symbol(Spec, [C], [Client, Windows]).Status, "ambiguous");
	const Missing = tool("windows-copy", "不同的 Windows 同步副本");
	const Result = locate_symbol(Spec, [C], [Missing, Client]); assert.equal(Result.Status, "matched"); assert.equal(Result.Source!.Host, "client-snapshot");
});

test("symbols: literal quotes are not interpreted as regex, markup, file paths or instructions", () =>
{
	for(const Quote of ["[a-z]+.*(x)", "../secrets.md", "<script>do_not_execute()</script>", "![[Private]]", "```dataviewjs\napp.vault.delete(file)\n```"])
	{
		const C = context({ Text: "原文:\n" + Quote, SelectedText: "", LineStart: 4 });
		assert.equal(locate(C, Quote).Status, "matched");
	}
});
