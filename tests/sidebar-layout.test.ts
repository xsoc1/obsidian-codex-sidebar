import { test } from "node:test";
import assert from "node:assert/strict";
import { sidebar_panel, reveal_sidebar_panel } from "../src/sidebar-layout";

function dom_fixture()
{
	const Document = { createElement: (Tag: string) => new Element(Tag) };
	class Element
	{
		ownerDocument = Document;
		children: Element[] = [];
		className = "";
		textContent = "";
		open = false;
		constructor(readonly tagName: string) { }
		appendChild(Child: Element) { this.children.push(Child); return Child; }
	}
	return new Element("div");
}

test("mobile context and model controls start folded, while the same input nodes retain values across expansion", () =>
{
	const Root = dom_fixture();
	const Panel = sidebar_panel(Root as unknown as HTMLElement, "codex-options", "模型与选项", true);
	const Input = Root.ownerDocument.createElement("select");
	Input.textContent = "saved-model / xhigh / Fast";
	Panel.Body.appendChild(Input as unknown as HTMLElement);
	const Details = Root.children[0];
	assert.equal(Details.open, false);
	assert.equal(Details.children[0].textContent, "模型与选项");
	Details.open = true;
	Details.open = false;
	assert.equal(Details.children[1].children[0], Input);
	assert.equal(Input.textContent, "saved-model / xhigh / Fast");
	assert.equal("title" in Details, false);
});

test("desktop panels keep their original parent and do not fold or move existing controls", () =>
{
	const Root = dom_fixture();
	const Panel = sidebar_panel(Root as unknown as HTMLElement, "codex-context-tools", "笔记上下文", false);
	assert.equal(Panel.Body, Root);
	assert.equal(Panel.Summary, null);
	assert.equal(Root.children.length, 0);
	reveal_sidebar_panel(Panel);
	assert.equal(Root.children.length, 0);
});

test("revealing a follow-up composer preserves the draft and keeps navigation and options independently folded", () =>
{
	const Root = dom_fixture();
	const Navigation = sidebar_panel(Root as unknown as HTMLElement, "codex-navigation", "会话与连接", true);
	const Options = sidebar_panel(Root as unknown as HTMLElement, "codex-options", "模型与选项", true);
	const Composer = sidebar_panel(Root as unknown as HTMLElement, "codex-send-tools", "提问与发送", true);
	const Input = Root.ownerDocument.createElement("textarea");
	Input.textContent = "中文草稿 $[X,Y]$";
	Composer.Body.appendChild(Input as unknown as HTMLElement);
	reveal_sidebar_panel(Composer);
	assert.equal(Composer.Details?.open, true);
	assert.equal(Navigation.Details?.open, false);
	assert.equal(Options.Details?.open, false);
	Composer.Details!.open = false;
	reveal_sidebar_panel(Composer);
	assert.equal((Composer.Body as unknown as { children: unknown[] }).children[0], Input);
	assert.equal(Input.textContent, "中文草稿 $[X,Y]$");
	reveal_sidebar_panel(null);
});
