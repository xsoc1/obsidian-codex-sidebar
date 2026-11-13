import { test } from "node:test";
import assert from "node:assert/strict";
import { interactive_markdown, interactive_output, validate_interactive, type InteractiveSpec } from "../src/interactive/protocol";
import { InteractiveStateStore } from "../src/interactive/state";
import { render_interactive, type InteractivePanelOptions } from "../src/interactive/panel";
import { validate_relation, validate_walkthrough, type RelationSpec, type WalkthroughSpec } from "../src/interactive/structures";
import { render_relation, render_walkthrough } from "../src/interactive/structures-view";
import { text_identity } from "../src/markdown-blocks";
import { source_reference, type SourceReference } from "../src/sources";
import type { ContextSnapshot } from "../src/prompt";
import { ExplanationActions, explanation_question } from "../src/explanation-actions";

function relation(): RelationSpec
{
	return { id: "implications", title: "有向关系", nodes: [
		{ id: "a", symbol: "$A$", meaning: "第一节点完整解释", conditions: "$x>0$", quote: "设 $x>0$." },
		{ id: "b", symbol: "$B$", meaning: "第二节点完整解释", quote: "不存在的原句" },
		{ id: "c", symbol: "$C$", meaning: "第三节点完整解释" }
	], edges: [{ from: "a", to: "b", label: "充分条件" }, { from: "b", to: "c", label: "推出" }, { from: "c", to: "a", label: "返回" }, { from: "a", to: "a", label: "自身" }] };
}
function walkthrough(): WalkthroughSpec
{
	return { id: "proof", title: "证明步骤", steps: [
		{ id: "a", symbol: "建立估计", meaning: "第一步完整推导 $a=b$", conditions: "$x>0$", quote: "设 $x>0$." },
		{ id: "b", symbol: "取极限", meaning: "第二步完整推导 $b=c$", quote: "不存在的原句" },
		{ id: "c", symbol: "得到结论", meaning: "第三步完整推导 $a=c$" }
	] };
}
function spec(): InteractiveSpec { return { schemaVersion: 1, plots: [], symbols: [], relations: [relation()], walkthroughs: [walkthrough()] }; }
function answer(Spec: unknown = spec()): string { return "完整正文始终可读.\n\n第一步: $a=b$. 第二步: $b=c$. 所以 $a=c$.\n\n```codex-ui\n" + JSON.stringify(Spec) + "\n```\n\n后续解释也保留."; }
function storage()
{
	const Data = new Map<string, string>();
	return { Data, getItem: (K: string) => Data.get(K) ?? null, setItem: (K: string, V: string) => { Data.set(K, V); } };
}

test("structures: optional v1 fields allow standalone structures and preserve exact legacy canonicalization/key", () =>
{
	const Old = { schemaVersion: 1 as const, plots: [{ id: "old", title: "旧图", expression: "a*x", x: { min: 0, max: 2 }, parameters: [{ name: "a", label: "参数", min: 0, max: 2, step: 1, value: 1 }] }], symbols: [{ id: "s", symbol: "$s$", meaning: "旧符号" }] };
	const V = validate_interactive(Old); assert.equal(JSON.stringify(V), JSON.stringify(Old)); assert.equal(Object.hasOwn(V, "relations"), false); assert.equal(Object.hasOwn(V, "walkthroughs"), false);
	const S = storage(), A = new InteractiveStateStore(S, "d", "s", "m", V), OldText = JSON.stringify(Old);
	assert.equal(A.Key, "codex-sidebar-interactive:v1:" + ["d", "s", "m", text_identity(OldText)].map(encodeURIComponent).join(":"));
	S.setItem(A.Key, JSON.stringify({ schemaVersion: 1, Spec: OldText, Revision: 1, Values: { old: { a: 2 } }, Symbol: "s" }));
	assert.deepEqual(A.load(), { Values: { old: { a: 2 } }, Symbol: "s" }); A.save(A.load()); assert.equal(Object.hasOwn(JSON.parse(S.getItem(A.Key)!), "Views"), false);
	for(const Fields of [{ relations: [relation()] }, { walkthroughs: [walkthrough()] }, { relations: [relation()], walkthroughs: [walkthrough()] }]) { assert.equal(validate_interactive({ schemaVersion: 1, plots: [], symbols: [], ...Fields }).schemaVersion, 1); }
	assert.deepEqual(validate_interactive(spec()), spec());
});

test("structures: plots/symbols remain required and aggregate components must be nonempty", () =>
{
	for(const V of [{ schemaVersion: 1, relations: [relation()] }, { schemaVersion: 1, plots: [], walkthroughs: [walkthrough()] }, { schemaVersion: 1, symbols: [], relations: [relation()] }, { schemaVersion: 1, plots: [], symbols: [], relations: [], walkthroughs: [] }]) { assert.throws(() => validate_interactive(V)); }
	for(const Key of ["relations", "walkthroughs"]) { for(const V of [null, {}, undefined, "[]"]) { assert.throws(() => validate_interactive({ ...spec(), [Key]: V })); } }
});

test("structures: limits accept 2 groups, 8 nodes, 12 edges and 10 steps; overflow/empty internals reject", () =>
{
	const R = relation(); R.nodes = Array.from({ length: 8 }, (_, I) => ({ id: "n" + I, symbol: "$n$", meaning: "含义" })); R.edges = Array.from({ length: 12 }, () => ({ from: "n0", to: "n7", label: "推出" }));
	const W = walkthrough(); W.steps = Array.from({ length: 10 }, (_, I) => ({ id: "s" + I, symbol: "步骤", meaning: "推导" }));
	assert.equal(validate_interactive({ schemaVersion: 1, plots: [], symbols: [], relations: [R, { ...R, id: "other-relation" }], walkthroughs: [W, { ...W, id: "other-walk" }] }).walkthroughs![0].steps.length, 10);
	for(const V of [{ ...R, nodes: [...R.nodes, { id: "n8", symbol: "n8", meaning: "含义" }] }, { ...R, edges: [...R.edges, R.edges[0]] }, { ...R, nodes: [] }]) { assert.throws(() => validate_relation(V)); }
	assert.throws(() => validate_walkthrough({ ...W, steps: [...W.steps, { id: "s10", symbol: "额外", meaning: "推导" }] })); assert.throws(() => validate_walkthrough({ ...W, steps: [] }));
	assert.equal(validate_relation({ ...relation(), edges: [] }).edges.length, 0);
	for(const Key of ["relations", "walkthroughs"]) { assert.throws(() => validate_interactive({ ...spec(), [Key]: Array(3).fill(Key === "relations" ? R : W) })); }
});

test("structures: component IDs are global, node/step IDs local, and every edge resolves inside its group", () =>
{
	assert.equal(validate_interactive(spec()).walkthroughs![0].steps[0].id, "a");
	assert.throws(() => validate_relation({ ...relation(), nodes: [relation().nodes[0], relation().nodes[0]] }));
	assert.throws(() => validate_walkthrough({ ...walkthrough(), steps: [walkthrough().steps[0], walkthrough().steps[0]] }));
	for(const E of [{ from: "a", to: "missing", label: "边" }, { from: "proof", to: "b", label: "边" }, { from: "a", to: 1, label: "边" }]) { assert.throws(() => validate_relation({ ...relation(), edges: [E] })); }
	assert.throws(() => validate_interactive({ ...spec(), walkthroughs: [{ ...walkthrough(), id: relation().id }] }));
	assert.throws(() => validate_interactive({ ...spec(), symbols: [{ id: relation().id, symbol: "符号", meaning: "含义" }] }));
	assert.throws(() => validate_interactive({ ...spec(), plots: [{ id: walkthrough().id, title: "图", expression: "x", x: { min: 0, max: 1 }, parameters: [] }] }));
});

test("structures: all levels reject unknown fields, prototypes, hidden/symbol fields and accessors without invoking them", () =>
{
	let Reads = 0;
	for(const Base of [spec(), relation(), walkthrough(), relation().edges[0]])
	{
		const Validate = "schemaVersion" in Base ? validate_interactive : "nodes" in Base ? validate_relation : "steps" in Base ? validate_walkthrough : (V: unknown) => validate_relation({ ...relation(), edges: [V] });
		for(const Extra of [{ code: "alert(1)" }, { path: "other.md" }, { x: 10 }]) { assert.throws(() => Validate({ ...Base, ...Extra })); }
		assert.throws(() => Validate(Object.assign(Object.create({ injected: true }), Base)));
		assert.throws(() => Validate(Object.defineProperty({ ...Base }, "hidden", { value: true })));
		assert.throws(() => Validate({ ...Base, [Symbol("injected")]: true }));
		const Key = Object.keys(Base)[0]; assert.throws(() => Validate(Object.defineProperty({ ...Base }, Key, { get: () => { Reads++; return "invalid"; } })));
	}
	for(const Field of ["relations", "walkthroughs", "plots", "symbols"])
	{
		const Sparse = Array(1); assert.throws(() => validate_interactive({ ...spec(), [Field]: Sparse }));
		const Extra: unknown[] = []; Object.assign(Extra, { custom: 1 }); assert.throws(() => validate_interactive({ ...spec(), [Field]: Extra }));
		const Getter = Object.defineProperty(Array(1), "0", { get: () => { Reads++; return relation(); } }); assert.throws(() => validate_interactive({ ...spec(), [Field]: Getter }));
	}
	for(const Field of ["nodes", "edges"]) { assert.throws(() => validate_relation({ ...relation(), [Field]: Array(1) })); }
	assert.throws(() => validate_walkthrough({ ...walkthrough(), steps: Array(1) })); assert.equal(Reads, 0);
});

test("structures: node/step mathematics reuse symbol safety; title and edge labels cannot inject markup/actions", () =>
{
	for(const Unsafe of ["<script>run()</script>", "```dataviewjs\nrun()\n```", "![[Private]]", "![image][ref]", "[run](javascript:run())"])
	{
		for(const Key of ["symbol", "meaning", "conditions"])
		{
			assert.throws(() => validate_relation({ ...relation(), nodes: [{ ...relation().nodes[0], [Key]: Unsafe }] }));
			assert.throws(() => validate_walkthrough({ ...walkthrough(), steps: [{ ...walkthrough().steps[0], [Key]: Unsafe }] }));
		}
		assert.throws(() => validate_relation({ ...relation(), title: Unsafe }));
		assert.throws(() => validate_relation({ ...relation(), edges: [{ ...relation().edges[0], label: Unsafe }] }));
		assert.throws(() => validate_walkthrough({ ...walkthrough(), title: Unsafe }));
	}
	const Literal = "<script>not executed</script>";
	assert.equal(validate_walkthrough({ ...walkthrough(), steps: [{ ...walkthrough().steps[0], quote: Literal }] }).steps[0].quote, Literal);
});

test("structures: total character budget and complete-fence rules remain shared across all components", () =>
{
	const S = spec(); S.walkthroughs![0].steps = Array.from({ length: 10 }, (_, I) => ({ id: "s" + I, symbol: "步骤", meaning: "x".repeat(2400) }));
	assert.throws(() => validate_interactive(S), /预算/); assert.equal(interactive_output(answer(S), true).Status, "invalid");
	const Text = answer(), O = interactive_output(Text, true); assert.equal(O.Status, "ready"); assert.match(interactive_markdown(Text, O), /第一步.*第二步/); assert.match(interactive_markdown(Text, O), /后续解释也保留/);
	assert.equal(interactive_output(Text, false).Status, "pending"); assert.equal(interactive_output(Text.slice(0, Text.indexOf("\n```\n")), true).Status, "invalid");
	assert.equal(interactive_output(Text + Text, true).Status, "invalid");
});

test("structures: per-device Views restore, default old records, isolate every identity and retain conflict/data safety", () =>
{
	const S = storage(), V = validate_interactive(spec()), A = new InteractiveStateStore(S, "device", "session", "message", V), State = A.load();
	assert.deepEqual(State.Views, { implications: "a", proof: "a" }); State.Views!.implications = "b"; State.Views!.proof = "c"; A.save(State);
	assert.deepEqual(new InteractiveStateStore(S, "device", "session", "message", V).load(), State);
	for(const [D, Session, M] of [["other", "session", "message"], ["device", "other", "message"], ["device", "session", "other"]]) { assert.deepEqual(new InteractiveStateStore(S, D, Session, M, V).load().Views, { implications: "a", proof: "a" }); }
	const Changed = spec(); Changed.walkthroughs![0].steps[0].meaning += "修订";
	assert.equal(new InteractiveStateStore(S, "device", "session", "message", Changed).load().Views!.proof, "a");
	const B = new InteractiveStateStore(S, "device", "session", "message", V), Before = B.load(); State.Views!.proof = "b"; A.save(State); assert.throws(() => B.save(Before), /另一窗口/);
	const Saved = JSON.parse(S.getItem(A.Key)!); delete Saved.Views; S.setItem(A.Key, JSON.stringify(Saved)); assert.deepEqual(A.load().Views, { implications: "a", proof: "a" });
	Saved.Views = { proof: "missing", implications: "b" }; S.setItem(A.Key, JSON.stringify(Saved)); assert.deepEqual(A.load().Views, { proof: "a", implications: "b" });
	for(const Bad of [[], null, { proof: 1 }]) { Saved.Views = Bad; const Raw = JSON.stringify(Saved); S.setItem(A.Key, Raw); assert.throws(() => A.load(), /损坏/); assert.equal(S.getItem(A.Key), Raw); }
	assert.equal(S.Data.size, 1); assert.ok(!S.getItem(A.Key)!.includes("完整正文"));
});

class TestDocument
{
	Focused?: TestElement;
	Observers: { disconnected: boolean; disconnect: () => void }[] = [];
	WindowListeners = new Map<string, Set<() => void>>();
	defaultView = {
		addEventListener: (K: string, F: () => void) => { if(!this.WindowListeners.has(K)) { this.WindowListeners.set(K, new Set()); } this.WindowListeners.get(K)!.add(F); },
		removeEventListener: (K: string, F: () => void) => { this.WindowListeners.get(K)?.delete(F); },
		ResizeObserver: class
		{
			disconnected = false;
			constructor(_Callback: () => void) { DocForObserver.Observers.push(this); }
			observe(): void {}
			disconnect(): void { this.disconnected = true; }
		}
	};
	createElement(Tag: string): TestElement { return new TestElement(Tag, this); }
	createElementNS(_Namespace: string, Tag: string): TestElement { return this.createElement(Tag); }
}
let DocForObserver: TestDocument;
class TestElement
{
	children: TestElement[] = []; parentElement: TestElement | null = null; className = ""; id = ""; type = ""; value = ""; disabled = false; hidden = false; tabIndex = -1;
	private Text = "";
	Attributes = new Map<string, string>(); Listeners = new Map<string, Set<(E: { key: string; preventDefault: () => void }) => void>>();
	constructor(readonly Tag: string, readonly ownerDocument: TestDocument) {}
	get textContent(): string { return this.Text + this.children.map(C => C.textContent).join(""); }
	set textContent(V: string) { this.Text = V; for(const C of this.children) { C.parentElement = null; } this.children = []; }
	classList = { add: (N: string) => { this.className += " " + N; }, remove: (N: string) => { this.className = this.className.split(" ").filter(C => C !== N).join(" "); } };
	setAttribute(K: string, V: string): void { this.Attributes.set(K, V); if(K === "class") { this.className = V; } }
	getAttribute(K: string): string | null { return this.Attributes.get(K) ?? null; }
	removeAttribute(K: string): void { this.Attributes.delete(K); }
	append(...Children: TestElement[]): void { for(const C of Children) { C.remove(); C.parentElement = this; this.children.push(C); } }
	appendChild(C: TestElement): TestElement { this.append(C); return C; }
	prepend(C: TestElement): void { C.remove(); C.parentElement = this; this.children.unshift(C); }
	insertBefore(C: TestElement, Before: TestElement): void { C.remove(); C.parentElement = this; this.children.splice(this.children.indexOf(Before), 0, C); }
	replaceChildren(...Children: TestElement[]): void { this.textContent = ""; this.append(...Children); }
	remove(): void { if(this.parentElement) { this.parentElement.children = this.parentElement.children.filter(C => C !== this); this.parentElement = null; } }
	addEventListener(K: string, F: (E: { key: string; preventDefault: () => void }) => void): void { if(!this.Listeners.has(K)) { this.Listeners.set(K, new Set()); } this.Listeners.get(K)!.add(F); }
	removeEventListener(K: string, F: (E: { key: string; preventDefault: () => void }) => void): void { this.Listeners.get(K)?.delete(F); }
	fire(K: string, Key = ""): boolean { let Prevented = false; for(const F of this.Listeners.get(K) ?? []) { F({ key: Key, preventDefault: () => { Prevented = true; } }); } return Prevented; }
	all(): TestElement[] { return [this, ...this.children.flatMap(C => C.all())]; }
	find(Class: string): TestElement { const E = this.all().find(E => E.className.split(" ").includes(Class)); assert.ok(E, Class); return E; }
	find_all(Class: string): TestElement[] { return this.all().filter(E => E.className.split(" ").includes(Class)); }
	querySelectorAll(Selector: string): TestElement[] { return this.all().slice(1).filter(E => Selector.startsWith(".") ? E.className.split(" ").includes(Selector.slice(1)) : Selector === "pre code" ? E.Tag === "code" && E.parentElement?.Tag === "pre" : E.Tag === Selector); }
	querySelector(Selector: string): TestElement | null { return this.querySelectorAll(Selector)[0] ?? null; }
	closest(Tag: string): TestElement | null { return this.Tag === Tag ? this : this.parentElement?.closest(Tag) ?? null; }
	focus(): void { this.ownerDocument.Focused = this; }
	scrollIntoView(): void {}
	getBoundingClientRect(): { x: number; y: number; width: number; height: number }
	{
		if(this.className === "codex-relation-node") { const I = this.parentElement!.children.filter(E => E.className === this.className).indexOf(this); return { x: 36 + I % 2 * 194, y: 36 + Math.floor(I / 2) * 82, width: 134, height: 44 }; }
		return { x: 0, y: 0, width: 400, height: 240 };
	}
}

function fixture()
{
	const Doc = new TestDocument(); DocForObserver = Doc;
	const Parent = Doc.createElement("div"), Body = Doc.createElement("article"), Text = answer(); Body.textContent = Text; Parent.append(Body);
	const C: ContextSnapshot = { Path: "Original.md", Mode: "编辑", Kind: "选区", Mapping: "源文本", Text: "设 $x>0$.", SelectedText: "设 $x>0$.", LineStart: 0, LineEnd: 0, Heading: "", CapturedAt: "frozen-time", Version: "v1", Truncated: false };
	const Sources = source_reference(C), S = storage(), Followups: { Question: string; Selection: string }[] = [], Opened: SourceReference[] = [], Copies: string[] = [];
	let Active = true;
	const Options: InteractivePanelOptions = { Scope: "device", SessionId: "session", MessageId: "message", Contexts: [C], Sources, Storage: S, Active: () => Active,
		Markdown: async (T, R) => { R.textContent = T; }, OpenSource: async Ref => { Opened.push(Ref); return "已定位"; }, Followup: (Question, Selection) => { Followups.push({ Question, Selection }); }, Copy: async T => { Copies.push(T); }
	};
	return { Doc, Parent, Body, Text, Options, S, Followups, Opened, Copies, set_active: (V: boolean) => { Active = V; }, mount: () => render_interactive(Parent as unknown as HTMLElement, Body as unknown as HTMLElement, Text, interactive_output(Text, true), Options) };
}
async function settle(): Promise<void> { await new Promise<void>(Resolve => setImmediate(Resolve)); }
function deferred<T>() { let Resolve!: (V: T) => void, Reject!: (E: Error) => void; const PromiseValue = new Promise<T>((R, J) => { Resolve = R; Reject = J; }); return { Promise: PromiseValue, resolve: Resolve, reject: Reject }; }

test("structures DOM: host lays out directed paths including cycles/self loops; native node buttons support keyboard and source navigation", async () =>
{
	const F = fixture(), Dispose = await F.mount(), R = F.Parent.find("codex-relation"), Nodes = R.find_all("codex-relation-node"), Paths = R.find_all("codex-relation-edge");
	assert.equal(Paths.length, 4); assert.equal(R.find_all("codex-relation-edge-label").length, 4); assert.ok(Paths.every(P => P.getAttribute("d")?.startsWith("M ") && P.getAttribute("marker-end")?.startsWith("url(#codex-arrow-"))); assert.ok(Paths.every(P => !/NaN|Infinity/.test(P.getAttribute("d")!)));
	assert.ok(Nodes.every(N => N.Tag === "button" && N.type === "button" && N.getAttribute("aria-controls"))); assert.match(R.textContent, /\$A\$ → \$B\$: 充分条件/);
	assert.equal(Nodes[0].getAttribute("aria-pressed"), "true"); assert.match(R.find("codex-structure-detail").textContent, /逐字引用已/);
	R.find("codex-symbol-open").fire("click"); await settle(); assert.equal(F.Opened.length, 1); assert.equal(F.Opened[0].Path, "Original.md"); assert.equal(F.Opened[0].Version, "v1");
	assert.equal(Nodes[0].fire("keydown", "ArrowRight"), true); await settle(); assert.equal(F.Doc.Focused, Nodes[1]); assert.equal(Nodes[1].getAttribute("aria-pressed"), "true"); assert.match(R.find("codex-structure-detail").textContent, /第二节点完整解释/); assert.match(R.find("codex-symbol-origin").textContent, /来源未核验/); assert.equal(R.find_all("codex-symbol-open").length, 0);
	Nodes[1].fire("keydown", "End"); await settle(); assert.equal(Nodes[2].getAttribute("aria-pressed"), "true"); Nodes[2].fire("keydown", "Home"); await settle(); assert.equal(Nodes[0].getAttribute("aria-pressed"), "true");
	assert.equal(F.Body.textContent, F.Text); assert.equal(F.Followups.length, 0); assert.equal(F.Copies.length, 0); Dispose(); assert.ok(F.Doc.Observers.every(O => O.disconnected)); assert.equal(F.Doc.WindowListeners.get("resize")!.size, 0);
});

test("structures DOM: visible previous/next and all three shared explanation actions use the current item only and reopen locally", async () =>
{
	const F = fixture(); let Dispose = await F.mount(); const W = F.Parent.find("codex-walkthrough"), Prev = W.find("codex-walkthrough-previous"), Next = W.find("codex-walkthrough-next");
	assert.equal(Prev.disabled, true); assert.equal(Next.disabled, false); assert.match(W.find("codex-walkthrough-position").textContent, /第 1 \/ 3 步/);
	const OldAction = W.find_all("codex-structure-action")[0]; Next.fire("click"); await settle(); assert.equal(Prev.disabled, false); assert.match(W.find("codex-structure-detail").textContent, /第二步完整推导/);
	OldAction.fire("click"); assert.equal(F.Followups.length, 0);
	const Actions = W.find_all("codex-structure-action"); assert.deepEqual(Actions.map(A => A.textContent), ExplanationActions.map(A => A.Label));
	for(const [I, Action] of Actions.entries()) { Action.fire("click"); assert.equal(F.Followups[I].Question, explanation_question(ExplanationActions[I].Id)); assert.match(F.Followups[I].Selection, /取极限.*\n\n第二步完整推导/s); }
	assert.equal(F.S.Data.size, 1); const Saved = JSON.parse([...F.S.Data.values()][0]); assert.deepEqual(Saved.Views, { implications: "a", proof: "b" });
	Dispose(); Dispose = await F.mount(); const Reloaded = F.Parent.find("codex-walkthrough"); assert.match(Reloaded.find("codex-walkthrough-position").textContent, /第 2 \/ 3 步/);
	Reloaded.find("codex-walkthrough-next").fire("click"); await settle(); assert.equal(Reloaded.find("codex-walkthrough-next").disabled, true);
	Reloaded.find("codex-walkthrough-previous").fire("click"); await settle(); assert.match(Reloaded.find("codex-structure-detail").textContent, /第二步完整推导/); Dispose();
});

test("structures DOM: reading copy contains full body, ALL nodes, ALL steps, edges, quote status and current choices", async () =>
{
	const F = fixture(), Dispose = await F.mount(), R = F.Parent.find("codex-relation"), W = F.Parent.find("codex-walkthrough");
	R.find_all("codex-relation-node")[2].fire("click"); W.find("codex-walkthrough-next").fire("click"); await settle(); F.Parent.find("codex-interactive-copy").fire("click"); await settle();
	assert.equal(F.Copies.length, 1); const Copy = F.Copies[0]; assert.match(Copy, /完整正文始终可读/); assert.match(Copy, /后续解释也保留/); assert.ok(!Copy.includes("```codex-ui"));
	for(const S of [...relation().nodes, ...walkthrough().steps]) { assert.ok(Copy.includes(S.meaning)); if(S.quote) { assert.ok(Copy.includes(S.quote)); } }
	assert.match(Copy, /当前节点: \$C\$/); assert.match(Copy, /当前步骤: 2 \/ 3 · 取极限/); assert.match(Copy, /\$C\$ → \$A\$: 返回/); assert.match(Copy, /逐字引用已/); assert.match(Copy, /来源未核验/); assert.match(Copy, /来源: Original.md/); assert.equal(F.Body.textContent, F.Text); Dispose();
});

test("structures DOM: inactive/disposed controls cannot save, navigate, follow up or copy", async () =>
{
	const F = fixture(), Dispose = await F.mount(), W = F.Parent.find("codex-walkthrough"), Buttons = F.Parent.all().filter(E => E.Tag === "button"), Snapshot = F.Parent.textContent;
	F.set_active(false); for(const B of Buttons) { B.fire("click"); B.fire("keydown", "ArrowRight"); } await settle();
	assert.equal(F.S.Data.size, 0); assert.equal(F.Opened.length, 0); assert.equal(F.Followups.length, 0); assert.equal(F.Copies.length, 0); assert.equal(F.Parent.textContent, Snapshot);
	F.set_active(true); Dispose(); for(const B of Buttons) { B.fire("click"); B.fire("keydown", "End"); } await settle(); assert.equal(F.Parent.children.length, 1); assert.equal(F.Parent.children[0], F.Body); assert.equal(W.parentElement, null); assert.equal(F.S.Data.size, 0); assert.equal(F.Followups.length, 0);
});

test("structures DOM: out-of-order Markdown completion or rejection cannot replace newer selection or its status", async () =>
{
	const F = fixture(), Gate = deferred<void>(); let CurrentGate = Gate;
	F.Options.Markdown = async (T, R) => { if(T === walkthrough().steps[1].meaning) { await CurrentGate.Promise; } R.textContent = T; };
	const Dispose = await F.mount(), W = F.Parent.find("codex-walkthrough");
	W.find_all("codex-walkthrough-step")[1].fire("click"); await settle(); W.find_all("codex-walkthrough-step")[2].fire("click"); await settle();
	assert.match(W.find("codex-structure-detail").textContent, /第三步完整推导/); const Before = F.Parent.find("codex-interactive-status").textContent;
	Gate.reject(Error("late old failure")); await settle(); assert.match(W.find("codex-structure-detail").textContent, /第三步完整推导/); assert.equal(F.Parent.find("codex-interactive-status").textContent, Before);
	const Gate2 = deferred<void>(); CurrentGate = Gate2;
	W.find_all("codex-walkthrough-step")[1].fire("click"); await settle(); F.set_active(false); Gate2.resolve(); await settle(); assert.match(W.find("codex-structure-detail").textContent, /第三步完整推导/); Dispose();
});

test("structures DOM: delayed source and copy results cannot mutate inactive or superseded UI", async () =>
{
	const F = fixture(), SourceGate = deferred<string>(), CopyGate = deferred<void>(); F.Options.OpenSource = () => SourceGate.Promise; F.Options.Copy = () => CopyGate.Promise;
	const Dispose = await F.mount(), W = F.Parent.find("codex-walkthrough"); W.find("codex-symbol-open").fire("click"); W.find("codex-walkthrough-next").fire("click"); await settle();
	const Status = F.Parent.find("codex-interactive-status"), Before = Status.textContent; SourceGate.resolve("outdated source result"); await settle(); assert.equal(Status.textContent, Before);
	F.Parent.find("codex-interactive-copy").fire("click"); F.set_active(false); CopyGate.resolve(); await settle(); assert.equal(Status.textContent, Before); Dispose();
});

test("structures DOM: storage failure stays usable without overwriting old state, unsafe quote stays inert, direct renderer rejects invalid before attach", async () =>
{
	const F = fixture(); F.Options.Storage = { getItem: () => "damaged-record", setItem: () => assert.fail("damaged state must not be overwritten") };
	const Dispose = await F.mount(); F.Parent.find("codex-walkthrough-next").fire("click"); await settle(); assert.match(F.Parent.find("codex-interactive-status").textContent, /暂不保存/); Dispose();
	const Q = "<script>not executed</script>", W = { ...walkthrough(), steps: [{ ...walkthrough().steps[0], quote: Q }] }, Seen: string[] = [], Options = { ...F.Options, Storage: F.S, Active: () => true, Changed: () => {}, Status: () => {}, Contexts: [{ ...F.Options.Contexts[0], Text: Q, SelectedText: Q }], Sources: source_reference({ ...F.Options.Contexts[0], Text: Q, SelectedText: Q }), Markdown: async (T: string, R: HTMLElement) => { Seen.push(T); R.textContent = T; } };
	const View = await render_walkthrough(F.Parent as unknown as HTMLElement, W, undefined, Options); assert.ok(!Seen.includes(Q)); assert.match(F.Parent.find("codex-symbol-source").textContent, /<script>/); assert.ok(F.Parent.all().every(E => E.Tag !== "script")); View.dispose();
	const Before = F.Parent.children.length; assert.throws(() => render_relation(F.Parent as unknown as HTMLElement, { ...relation(), edges: [{ from: "bad", to: "a", label: "bad" }] }, undefined, Options)); assert.equal(F.Parent.children.length, Before);
});

test("structures DOM: individually safe relation fragments never combine into executable Markdown syntax", async () =>
{
	const F = fixture(), R = relation(), Seen: string[] = [];
	R.nodes[0].symbol = "<img"; R.nodes[1].symbol = "src=x"; R.edges = [{ from: "a", to: "b", label: "onerror=alert(1)>" }];
	const View = await render_relation(F.Parent as unknown as HTMLElement, R, undefined, { ...F.Options, Changed: () => {}, Status: () => {}, Markdown: async (T, Into) => { Seen.push(T); Into.textContent = T; } });
	assert.ok(Seen.includes("<img")); assert.ok(Seen.includes("src=x")); assert.ok(Seen.includes("onerror=alert(1)>")); assert.ok(!Seen.some(T => /<img.*onerror/.test(T)));
	assert.match(F.Parent.find("codex-relation-edge-label").textContent, /<img → src=x: onerror/); View.dispose();
});
