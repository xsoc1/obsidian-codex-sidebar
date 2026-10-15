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
		Listeners = new Map<string, () => void>();
		addEventListener(Name: string, Listener: () => void) { this.Listeners.set(Name, Listener); }
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

test("desktop controls fold independently, retain nodes, and restore device-local fold choices", () =>
{
	const Root = dom_fixture();
	const Local = new Map<string, string>();
	const Saved = { Storage: { getItem: (Key: string) => Local.get(Key) ?? null, setItem: (Key: string, Value: string) => Local.set(Key, Value) }, Key: "desktop-context" };
	const Panel = sidebar_panel(Root as unknown as HTMLElement, "codex-context-tools", "笔记上下文", false, Saved);
	assert.equal(Panel.Details!.open, false); assert.ok(Panel.Summary);
	const Input = Root.ownerDocument.createElement("select"); Input.textContent = "saved-model";
	Panel.Body.appendChild(Input as unknown as HTMLElement);
	reveal_sidebar_panel(Panel); Root.children[0].Listeners.get("toggle")!();
	const Restart = sidebar_panel(dom_fixture() as unknown as HTMLElement, "codex-context-tools", "笔记上下文", false, Saved);
	assert.equal(Restart.Details!.open, true); assert.equal((Panel.Body as any).children[0], Input);
	const Compose = sidebar_panel(Root as unknown as HTMLElement, "codex-send-tools", "提问与发送", false);
	assert.equal(Compose.Details!.open, true); assert.equal(Local.size, 1);
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
