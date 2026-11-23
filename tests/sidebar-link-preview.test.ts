import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

class Element
{
	Text = "";
	TextContent = "";
	children: Element[] = [];
	isConnected = true;
	disabled = false;
	focused = false;
	closest() { return null; }
	onClick?: () => void | Promise<void>;
	createDiv(Options: any = {}) { return this.createEl("div", Options); }
	createEl(_Tag: string, Options: any = {}) { const Child = new Element(); Child.Text = Options.text ?? ""; this.children.push(Child); return Child; }
	setText(Text: string) { this.Text = Text; }
	focus() { this.focused = true; }
	empty() { this.children = []; }
	addClass() {}
	addEventListener(Name: string, Handler: () => void | Promise<void>) { if(Name === "click") { this.onClick = Handler; } }
	get textContent(): string { return [this.Text, this.TextContent, ...this.children.map(C => C.textContent)].join(""); }
	all(): Element[] { return [this, ...this.children.flatMap(C => C.all())]; }
}
class Component { load() {} unload() {} registerDomEvent() {} }
class Modal
{
	contentEl = new Element(); modalEl = new Element(); Title = "";
	onOpen!: () => Promise<void>; onClose!: () => void;
	Opened!: Promise<void>;
	setTitle(Text: string) { this.Title = Text; }
	open() { this.Opened = this.onOpen(); }
	close() { this.onClose(); }
}

const Code = buildSync({ entryPoints: ["src/sidebar-link-preview.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"] }).outputFiles[0].text;
function fixture()
{
	let Last!: Modal;
	const Export = { exports: {} as any };
	runInNewContext(Code, { module: Export, exports: Export.exports, TextEncoder, Error, queueMicrotask, AbortController, require: () => ({
		Modal: class extends Modal { constructor() { super(); Last = this; } },
		Component, parseLinktext: (D: string) => { const I = D.indexOf("#"); return I < 0 ? { path: D, subpath: "" } : { path: D.slice(0, I), subpath: D.slice(I) }; },
		resolveSubpath: (Cache: any, Subpath: string) => Cache[Subpath],
		MarkdownRenderer: { render: async (_App: unknown, Text: string, Root: Element) => { Root.setText(Text); } }
	}) });
	const Text = "# Original\n\nKeep $x^2$.\n\n# Next\n\nHide this.";
	const File = { path: "original/Note file.md", extension: "md", basename: "Note file" }, Lookup: unknown[] = [], Opens: unknown[] = [];
	const App = {
		vault: { getFileByPath: (Path: string) => Path === File.path ? File : null, cachedRead: async () => Text },
		metadataCache: { getFirstLinkpathDest: (Path: string, From: string) => { Lookup.push([Path, From]); return File; }, getFileCache: () => ({ "#Original": { start: { offset: 0 }, end: { offset: Text.indexOf("# Next") } } }) },
		workspace: { openLinkText: async (...Args: unknown[]) => { Opens.push(Args); } }
	};
	return { ...Export.exports, App, File, Lookup, Opens, dialog: () => Last };
}

test("normal internal activation previews; modified or web activation stays native", () =>
{
	const { bind_sidebar_links } = fixture(), Calls: unknown[] = [];
	let Click!: (Event: any) => void, Prevented = 0;
	const Body = { contains: () => true }, Source = { link: (...Args: unknown[]) => Calls.push(Args) };
	const fire = (Href: string, Classes: string[], Ctrl = false) =>
	{
		const Link = { dataset: { href: Href }, classList: { contains: (C: string) => Classes.includes(C) } };
		Click({ target: { closest: () => Link }, ctrlKey: Ctrl, preventDefault: () => Prevented++, stopImmediatePropagation: () => {} });
	};
	bind_sidebar_links(Body, { registerDomEvent: (_Body: unknown, _Type: string, Event: typeof Click, Options: { capture: boolean }) => { assert.ok(Options.capture); Click = Event; } }, Source, "origin.md");
	fire("Folder/Note#^lemma", ["internal-link"]); fire("https://example.org", ["external-link"]); fire("Folder/Note", ["internal-link"], true);
	assert.equal(Prevented, 1); assert.equal(Calls.length, 1);
	assert.deepEqual((Calls[0] as unknown[]).slice(0, 3), ["Folder/Note#^lemma", true, "origin.md"]);
});

test("a resolved heading stays in the popup until the explicit original-file action", async () =>
{
	const F = fixture(), Preview = new F.SidebarLinkPreview(F.App), Trigger = new Element();
	Preview.link("Note%20file.md#Original", false, "original/Origin.md", Trigger);
	await F.dialog().Opened;
	assert.deepEqual(F.Lookup, [["Note file.md", "original/Origin.md"]]);
	assert.deepEqual(F.Opens, []);
	assert.match(F.dialog().contentEl.textContent, /Keep \$x\^2\$/);
	assert.doesNotMatch(F.dialog().contentEl.textContent, /Hide this/);
	await F.dialog().contentEl.all().find((E: Element) => E.Text === "打开原文")!.onClick!();
	assert.deepEqual(F.Opens, [["original/Note file.md#Original", "", true]]);
	assert.equal(Trigger.focused, false);
});

test("a missing base never basename-searches, but accepts exact vault paths", async () =>
{
	const F = fixture(), Preview = new F.SidebarLinkPreview(F.App), Trigger = new Element();
	Preview.link("Note file", true, "", Trigger);
	await F.dialog().Opened;
	assert.match(F.dialog().contentEl.textContent, /没有可靠的链接基准/);
	assert.deepEqual(F.Lookup, []);
	assert.deepEqual(F.Opens, []);
	Preview.link(F.File.path, true, "", Trigger);
	await F.dialog().Opened;
	assert.match(F.dialog().contentEl.textContent, /Keep \$x\^2\$/);
	Preview.close();
	await Promise.resolve();
	assert.ok(Trigger.focused);
});

test("opening a preview after its target moves does not create or navigate to a note", async () =>
{
	const F = fixture(), Preview = new F.SidebarLinkPreview(F.App);
	Preview.link(F.File.path, true, "", new Element());
	await F.dialog().Opened;
	F.File.path = "moved/Note file.md";
	const Open = F.dialog().contentEl.all().find((E: Element) => E.Text === "打开原文")!;
	await Open.onClick!();
	assert.deepEqual(F.Opens, []);
	assert.match(F.dialog().contentEl.textContent, /文件已移动或不存在/);
	assert.equal(Open.disabled, false);
});

test("a source line inside display math keeps its full block; long previews do not cut a formula", () =>
{
	const { preview_excerpt } = fixture();
	const Formula = "$$\n[H,E]=2E\n$$";
	assert.equal(preview_excerpt("前段\n\n" + Formula + "\n\n后段", 3).Text, Formula);
	const Long = preview_excerpt("正文\n\n$$\n" + "x+".repeat(24_000) + "\n$$");
	assert.equal(Long.Text, "正文");
	assert.equal(Long.Limited, true);
});
