import { test } from "node:test";
import assert from "node:assert/strict";
import { explanation_preview, SelectionPreview } from "../src/selection-preview";
import { context_window } from "../src/markdown-blocks";
import { render_input_ledger } from "../src/input-ledger-view";
import { render_backend_result } from "../src/backend-result-view";
import { build_prompt, type ContextSnapshot } from "../src/prompt";

class Element
{
	children: Element[] = [];
	textContent = "";
	open = false;
	hidden = false;
	constructor(readonly Tag: string = "div") {}
	createEl(Tag: string, Options: any = {}): any { const E = new Element(Tag); E.textContent = Options.text ?? ""; this.children.push(E); return E; }
	createDiv(Options?: any): any { return this.createEl("div", Options); }
	setText(Text: string) { this.textContent = Text; }
	addEventListener() {}
	all_text(): string { return this.textContent + this.children.map(E => E.all_text()).join("\n"); }
}

test("a short selection in an oversized mathematical block remains complete while its exact sent background is visibly incomplete", () =>
{
	const Source = "> [!note] 假设\n> a>0\n\n$$\n" + "long mathematical derivation\n".repeat(2000), From = Source.indexOf("derivation", 15000), To = From + 10;
	const Explanation = context_window(Source, From, To, 24000);
	const Snapshot: ContextSnapshot = { Path: "original.md", Kind: "选区", Mode: "编辑", Mapping: "源文本", SelectedText: Source.slice(From, To), Text: "source fragment", CapturedAt: "capture", LineStart: 10, LineEnd: 10, Heading: "", Truncated: false, SelectedTruncated: false, ContextTruncated: false, Selection: { From, To }, Explanation };
	const Root = new Element(); explanation_preview(Root as any, Snapshot);
	assert.equal(Root.children[0].open, false); assert.match(Root.all_text(), /背景不完整/); assert.match(Root.all_text(), /未完整闭合/); assert.match(Root.all_text(), /缺失范围/);
	assert.ok(Root.all_text().includes(Explanation.Text)); assert.ok(build_prompt("解释", Snapshot).includes(Explanation.Text));
	const CardRoot = new Element(), Card = new SelectionPreview(CardRoot as any, () => {}); Card.update(Snapshot, true);
	assert.match(CardRoot.all_text(), /选区完整/); assert.ok(!CardRoot.all_text().includes("选区已截断"));
	assert.deepEqual(Snapshot.Selection, { From, To });
});

test("background preview contains neighboring theorem assumptions and legacy absent background stays unknown", () =>
{
	const Source = "> [!note] 假设\n> a>0\n\n证明.\n\n$$x=1$$", From = Source.indexOf("x=1"), Snapshot: ContextSnapshot = { Path: "proof.md", Kind: "选区", Mode: "阅读", Mapping: "源块", SelectedText: "x=1", Text: "$$x=1$$", CapturedAt: "time", LineStart: 5, LineEnd: 5, Heading: "", Truncated: false, Explanation: context_window(Source, From, From + 3) };
	const Root = new Element(); explanation_preview(Root as any, Snapshot); assert.match(Root.all_text(), /a>0/); assert.match(Root.all_text(), /源块闭合/);
	const Legacy = new Element(); explanation_preview(Legacy as any, { ...Snapshot, Explanation: undefined }); assert.match(Legacy.all_text(), /未附解释背景/); assert.ok(!Legacy.all_text().includes("背景完整"));
});

test("history coverage shows actual included and deferred evidence without claiming omitted bodies were read", () =>
{
	const Root = new Element(); render_input_ledger(Root as any, { SchemaVersion: 1, Construction: "bounded-history-v1", BudgetKind: "unknown-window-conservative-bytes", ReportedModelWindow: null, Utf8Budget: 64000, ActualUtf8Bytes: 2000, MessageEnvelopeReserveBytes: 200, IncludedMessageIds: ["a", "b"], IncludedMessageVersions: [], OmittedMessageIds: ["old"], OmittedMessageCount: 7, OmittedLocatorTruncated: true, ImageIds: [], Deduplicated: [], DeferredMaterials: [{ MessageId: "b", Field: "text", SourceVersion: "original-version", Utf8Bytes: 50000 }] });
	assert.equal(Root.children[0].open, false); assert.match(Root.all_text(), /已纳入 2 条历史/); assert.match(Root.all_text(), /未重放 7 条/); assert.match(Root.all_text(), /64000 字节/); assert.match(Root.all_text(), /不代表模型已读取正文/); assert.match(Root.all_text(), /original-version/);
});

test("backend evidence displays missing usage honestly and provided zero values without adding absent counters", () =>
{
	const Missing = new Element(); render_backend_result(Missing as any, { Text: "received", Status: "partial", Metadata: { Reason: "output-limited", Model: "actual-model", Transport: "streaming" } });
	assert.match(Missing.all_text(), /部分正文/); assert.match(Missing.all_text(), /output-limited/); assert.match(Missing.all_text(), /actual-model/); assert.match(Missing.all_text(), /流式/); assert.match(Missing.all_text(), /服务商未提供/); assert.ok(!Missing.all_text().includes("0"));
	const Given = new Element(); render_backend_result(Given as any, { Text: "received", Status: "unknown", Metadata: { Transport: "buffered", Usage: [{ Kind: "cumulative", InputTokens: 0, OutputTokens: 9, Raw: { private: "do not render" }, Receipt: { ResponseId: "response-1" } }] } });
	assert.match(Given.all_text(), /结果未知/); assert.match(Given.all_text(), /整段响应/); assert.match(Given.all_text(), /输入: 0/); assert.match(Given.all_text(), /输出: 9/); assert.ok(!Given.all_text().includes("总计:")); assert.ok(!Given.all_text().includes("do not render"));
});
