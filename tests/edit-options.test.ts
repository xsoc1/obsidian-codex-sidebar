import { test } from "node:test";
import assert from "node:assert/strict";
import { EditOptions } from "../src/edit/options";
import { ComposerActions, type ComposeAction } from "../src/edit/composer";

class Element
{
	children: Element[] = [];
	parentElement: Element | null = null;
	textContent = "";
	value = "";
	hidden = false;
	open = false;
	disabled = false;
	classList = { add: (_: string) => {} };
	Handlers = new Map<string, ((Event: any) => void)[]>();
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
	addEventListener(Name: string, Handler: (Event: any) => void): void { this.Handlers.set(Name, [...this.Handlers.get(Name) ?? [], Handler]); }
	fire(Name: string, Data: any = {}): boolean
	{
		const Event = { ...Data, defaultPrevented: !!Data.defaultPrevented, preventDefault() { this.defaultPrevented = true; } };
		this.Handlers.get(Name)?.forEach(Handler => Handler(Event)); return Event.defaultPrevented;
	}
	click(): void { if(!this.disabled) { this.fire("click"); } }
	setText(Text: string): void { this.textContent = Text; }
}

test("composer options expose only the modification range with automatic source-role inference", () =>
{
	const Root = new Element(), Options = new EditOptions(Root as any, () => {});
	assert.equal((Options.Scope.parentElement!.parentElement as any).Tag, "details");
	assert.equal(Options.Scope.value, "ai");
	const All = (Value: Element): Element[] => [Value, ...Value.children.flatMap(All)], Elements = All(Root);
	assert.equal(Elements.filter(Value => Value.Tag === "select").length, 1);
	assert.ok(Elements.every(Value => !["本轮方式", "原文类型", "修改范围与原文类型"].includes(Value.textContent)));
	for(const Scope of ["ai", "captured", "note"])
	{
		Options.Scope.value = Scope; assert.deepEqual(Options.values(), { Scope, Role: "auto" });
	}
	assert.ok(Elements.every(Value => !Value.Attributes.title && !Value.Attributes["aria-label"]));
});

test("the two stable action buttons and Enter choose an explicit route while Shift+Enter, IME and Tab remain native", () =>
{
	const Root = new Element(), Input = new Element("textarea"), Calls: ComposeAction[] = [];
	const Actions = new ComposerActions(Root as any, Input as any, Mode => Calls.push(Mode), () => {});
	Actions.refresh(false, false, false);
	assert.deepEqual(Root.children.map(Value => Value.textContent), ["提问", "生成修改预览", "停止"]);
	(Actions.Question as any).click(); (Actions.Preview as any).click();
	assert.equal(Input.fire("keydown", { key: "Enter" }), true);
	assert.deepEqual(Calls, ["question", "edit", "question"]);
	for(const Event of [{ key: "Enter", shiftKey: true }, { key: "Enter", isComposing: true }, { key: "Enter", keyCode: 229 }, { key: "Tab" }]) { assert.equal(Input.fire("keydown", Event), false); }
	assert.equal(Calls.length, 3);
});

test("busy and quote states protect both actions and re-enable them without changing their labels", () =>
{
	const Root = new Element(), Input = new Element("textarea"), Calls: ComposeAction[] = []; let Stopped = 0;
	const Actions = new ComposerActions(Root as any, Input as any, Mode => Calls.push(Mode), () => Stopped++);
	Actions.refresh(true, true, false);
	(Actions.Question as any).click(); (Actions.Preview as any).click(); Input.fire("keydown", { key: "Enter" }); (Actions.Stop as any).click();
	assert.equal(Calls.length, 0); assert.equal(Stopped, 1);
	Actions.refresh(false, false, true);
	(Actions.Preview as any).click(); (Actions.Question as any).click(); assert.deepEqual(Calls, ["question"]);
	Actions.refresh(false, false, false); (Actions.Preview as any).click(); assert.deepEqual(Calls, ["question", "edit"]);
	assert.deepEqual(Root.children.map(Value => Value.textContent), ["提问", "生成修改预览", "停止"]);
});
