import { test } from "node:test";
import assert from "node:assert/strict";
import { EditOptions } from "../src/edit/options";

class Element
{
	children: Element[] = [];
	parentElement: Element | null = null;
	textContent = "";
	value = "";
	hidden = false;
	open = false;
	Attributes: Record<string, string> = {};
	constructor(readonly Tag = "div") { }
	createEl(Tag: string, Options: any = {}): any
	{
		const Child = new Element(Tag); Child.textContent = Options.text ?? ""; Child.value = Options.value ?? ""; Child.Attributes = Options.attr ?? {}; Child.parentElement = this;
		if(this.Tag === "select" && !this.children.length) { this.value = Child.value; }
		this.children.push(Child); return Child;
	}
	createDiv(Options?: any): any { return this.createEl("div", Options); }
	createSpan(Options?: any): any { return this.createEl("span", Options); }
	addEventListener(): void { }
	setText(Text: string): void { this.textContent = Text; }
}

test("the explicit preview mode is visible without unfolding ranges and an AI scope alone never overrides question-only mode", () =>
{
	const Root = new Element(), Options = new EditOptions(Root as any, () => {});
	assert.equal(Options.Mode.parentElement!.parentElement, Root);
	assert.equal((Options.Scope.parentElement!.parentElement as any).Tag, "details");
	assert.equal(Options.Scope.value, "ai");
	assert.equal(Options.refresh("将你这个笔记改动方案落地", false, "personal.md"), true);
	const Hint = Root.children[0]; assert.equal(Hint.hidden, false); assert.match(Hint.textContent, /personal.md.*AI 自选范围/);
	Options.Mode.value = "question";
	assert.equal(Options.refresh("应用上条改稿", false, "personal.md"), false);
	assert.match(Hint.textContent, /本轮为问答.*生成修改预览.*修改范围只在预览模式生效/);
	Options.Mode.value = "edit";
	assert.equal(Options.refresh("就按刚才那个来", false, "personal.md"), true);
	assert.match(Hint.textContent, /确认后才写入/);
	Options.Mode.value = "auto";
	assert.equal(Options.refresh("应用上条改稿", true, "personal.md"), false);
	Options.refresh("", false); assert.equal(Hint.hidden, true);
	assert.ok(Root.children.every(Value => !Value.Attributes.title && !Value.Attributes["aria-label"]));
});
