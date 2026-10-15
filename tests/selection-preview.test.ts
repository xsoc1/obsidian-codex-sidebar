import { test } from "node:test";
import assert from "node:assert/strict";
import { SelectionPreview, selection_in_source } from "../src/selection-preview";
import type { ContextSnapshot } from "../src/prompt";

class Element
{
	children: Element[] = [];
	parent: Element | null = null;
	textContent = "";
	hidden = false;
	open = false;
	isConnected = true;
	Attributes: Record<string, string> = {};
	Listeners = new Map<string, () => void>();
	constructor(readonly Tag = "div") { }
	createEl(Tag: string, Options: any = {}): any { const Child = new Element(Tag); Child.textContent = Options.text ?? ""; Child.Attributes = Options.attr ?? {}; Child.parent = this; this.children.push(Child); return Child; }
	createDiv(Options?: any): any { return this.createEl("div", Options); }
	setText(Text: string): void { this.textContent = Text; }
	addEventListener(Name: string, Callback: () => void): void { this.Listeners.set(Name, Callback); }
	contains(Child: Element | null): boolean { return Child === this || this.children.some(Value => Value.contains(Child)); }
}
const Source: ContextSnapshot = { Path: "original.md", Mode: "阅读", Kind: "选区", Mapping: "源块", Text: "$$\n\\alpha+\\beta=1\n$$", SelectedText: "α+β=1", LineStart: 2, LineEnd: 4, Heading: "", CapturedAt: "original-time", Truncated: true };

test("selection card stays outside collapsed controls, preserves raw formulas and does not reopen on composer refresh", () =>
{
	const Root = new Element(); let Cleared = 0;
	const Card = new SelectionPreview(Root as any, () => Cleared++); Card.update(Source, true);
	const Details = Root.children[0]; assert.equal(Details.hidden, false); assert.equal(Details.open, true);
	assert.equal(Details.children[2].textContent, "α+β=1");
	assert.equal(Details.children[3].children[1].textContent, Source.Text);
	assert.match(Details.children[1].textContent, /源块.*将附带.*已截断.*original-time/);
	Details.open = false; Card.update(structuredClone(Source), false); assert.equal(Details.open, false); assert.match(Details.children[1].textContent, /未附带/);
	Card.update({ ...Source, SelectedText: "新的选区" }, true); assert.equal(Details.open, true);
	Details.children[4].Listeners.get("click")!(); assert.equal(Cleared, 1);
	Card.update(null, true); assert.equal(Details.hidden, true);
	Card.update({ ...Source, Kind: "当前位置" }, true); assert.equal(Details.hidden, true);
	assert.ok(Details.children.every(Value => !Value.Attributes.title && !Value.Attributes["aria-label"]));
});

test("sidebar input and assistant selections do not replace a captured note selection", () =>
{
	const View = new Element(), Editor = View.createEl("textarea"), Sidebar = new Element(), Input = Sidebar.createEl("textarea");
	let Anchor = Editor;
	const Doc: any = { activeElement: Editor, defaultView: { Node: Element, getSelection: () => ({ anchorNode: Anchor }) } };
	assert.equal(selection_in_source(View as any, Doc), true);
	assert.equal(selection_in_source(View as any, Doc, Input), false);
	Anchor = Input; Doc.activeElement = Input;
	assert.equal(selection_in_source(View as any, Doc), false);
	View.isConnected = false; assert.equal(selection_in_source(View as any, Doc, Editor), false);
});
