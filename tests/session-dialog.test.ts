import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

class Element
{
	children: Element[] = [];
	textContent = "";
	disabled = false;
	Handlers = new Map<string, () => Promise<void> | void>();
	createEl(_Tag: string, Options: any = {}): Element { const E = new Element(); E.textContent = Options.text ?? ""; this.children.push(E); return E; }
	createDiv(Options: any = {}): Element { return this.createEl("div", Options); }
	setText(Value: string): void { this.textContent = Value; }
	empty(): void { this.children = []; }
	addEventListener(Name: string, Handler: () => Promise<void> | void): void { this.Handlers.set(Name, Handler); }
	click(): Promise<void> | void { if(!this.disabled) { return this.Handlers.get("click")?.(); } }
	all(): Element[] { return [this, ...this.children.flatMap(E => E.all())]; }
}
function fixture(Remove: (Id: string, Stamp: string) => Promise<void>)
{
	class Modal { contentEl = new Element(); close() { (this as any).onClose(); } }
	const Export = { exports: {} as any };
	const Code = buildSync({ entryPoints: ["src/session-dialog.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"] }).outputFiles[0].text;
	runInNewContext(Code, { module: Export, exports: Export.exports, Error, require: () => ({ Modal }) });
	let Closed = 0;
	const Session = { Id: "original-chat", Title: "Original chat", Messages: [{ Id: "original-message", Text: "original text" }] };
	const Dialog = new Export.exports.DeleteSessionDialog({}, Session, Remove, () => Closed++); Dialog.onOpen();
	return { Dialog, Session, button: (Text: string) => Dialog.contentEl.all().find((E: Element) => E.textContent === Text)!, closed: () => Closed };
}

test("opening and cancelling deletion never removes a conversation", async () =>
{
	let Calls = 0; const F = fixture(async () => { Calls++; });
	assert.equal(Calls, 0); assert.ok(F.Dialog.contentEl.all().some((E: Element) => E.textContent.includes("本设备修改记录保留")));
	await F.button("取消").click(); assert.equal(Calls, 0); assert.equal(F.closed(), 1);
});

test("confirmation captures the reviewed identity and content, and a double click submits once", async () =>
{
	const Calls: unknown[] = []; let Release!: () => void;
	const Wait = new Promise<void>(R => Release = R), F = fixture(async (...Args) => { Calls.push(Args); await Wait; });
	const Stamp = JSON.stringify([F.Session.Id, F.Session.Title, F.Session.Messages]); F.Session.Title = "later title";
	const Button = F.button("确认删除"), First = Button.click(); Button.click(); assert.equal(Calls.length, 1); assert.deepEqual(Calls[0], [F.Session.Id, Stamp]);
	Release(); await First; assert.equal(F.closed(), 1);
});

test("failed deletion keeps the dialog open with a concrete error", async () =>
{
	const F = fixture(async () => { throw new Error("Original storage failure"); });
	await F.button("确认删除").click(); assert.equal(F.closed(), 0); assert.equal(F.button("确认删除").disabled, false);
	assert.ok(F.Dialog.contentEl.all().some((E: Element) => E.textContent === "Original storage failure"));
});
