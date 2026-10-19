import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageList, type MessageRender } from "../src/message-list";

class Element
{
	children: Element[] = [];
	parentElement: Element | null = null;
	ownerDocument = { defaultView: null };
	clientHeight = 100;
	Height = 150;
	private Top = 0;
	private Listeners = new Map<string, () => void>();
	get scrollHeight(): number { return Math.max(this.clientHeight, this.children.reduce((Sum, Child) => Sum + Child.Height, 0)); }
	get scrollTop(): number { return this.Top; }
	set scrollTop(Value: number) { this.Top = Math.max(0, Math.min(Value, this.scrollHeight - this.clientHeight)); }
	addEventListener(Name: string, Listener: () => void): void { this.Listeners.set(Name, Listener); }
	removeEventListener(Name: string): void { this.Listeners.delete(Name); }
	scroll(Value: number): void { this.scrollTop = Value; this.Listeners.get("scroll")?.(); }
	insertBefore(Child: Element, At: Element | null): void
	{
		Child.remove(); this.children.splice(At ? this.children.indexOf(At) : this.children.length, 0, Child); Child.parentElement = this;
	}
	remove(): void { if(this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } }
	getBoundingClientRect(): { top: number; bottom: number }
	{
		const Parent = this.parentElement;
		const Top = Parent ? Parent.children.slice(0, Parent.children.indexOf(this)).reduce((Sum, Child) => Sum + Child.Height, 0) - Parent.scrollTop : 0;
		return { top: Top, bottom: Top + (Parent ? this.Height : this.clientHeight) };
	}
}
function fixture()
{
	const Root = new Element(), List = new MessageList(Root as any), Disposed: string[] = [], Rendered: string[] = [];
	const item = (Id: string, Key = Id, Wait?: Promise<void>): MessageRender => ({ Id, Key, Render: async () =>
	{
		Rendered.push(Key); await Wait;
		return { Element: new Element() as any, Dispose: () => Disposed.push(Key) };
	} });
	return { Root, List, item, Disposed, Rendered };
}
function deferred()
{
	let Release!: () => void;
	const Wait = new Promise<void>(Resolve => { Release = Resolve; });
	return { Wait, release: () => Release() };
}

test("an asynchronous delta keeps the visible history intact and renders only the changed card", async () =>
{
	const F = fixture(); await F.List.update("session", [F.item("history"), F.item("stream", "v1")], () => true);
	const [History, Stream] = F.Root.children, Height = F.Root.scrollHeight, Pending = deferred();
	const Updating = F.List.update("session", [F.item("history"), F.item("stream", "v2", Pending.Wait)], () => true);
	assert.deepEqual(F.Root.children, [History, Stream]); assert.equal(F.Root.scrollHeight, Height); assert.deepEqual(F.Disposed, []);
	Pending.release(); assert.equal(await Updating, true);
	assert.equal(F.Root.children[0], History); assert.notEqual(F.Root.children[1], Stream);
	assert.deepEqual(F.Rendered, ["history", "v1", "v2"]); assert.deepEqual(F.Disposed, ["v1"]);
	F.List.dispose(); assert.deepEqual(F.Disposed, ["v1", "history", "v2"]);
});

test("scrolling up while Markdown is pending keeps the user's current reading position", async () =>
{
	for(const Position of [30, 180])
	{
		const F = fixture(); await F.List.update("session", [F.item("history"), F.item("stream", "v1")], () => true);
		assert.equal(F.Root.scrollTop, 200);
		const Pending = deferred(), Updating = F.List.update("session", [F.item("history"), F.item("stream", "v2", Pending.Wait)], () => true);
		F.Root.scroll(Position); Pending.release(); await Updating;
		assert.equal(F.Root.scrollTop, Position); F.List.dispose();
	}
});

test("stale sessions and late completion after close cannot replace the current transcript", async () =>
{
	const F = fixture(); await F.List.update("session", [F.item("old")], () => true);
	const Pending = deferred(), Late = F.List.update("session", [F.item("old", "late", Pending.Wait)], () => true);
	await F.List.update("new-session", [F.item("new")], () => true);
	const Current = F.Root.children[0]; Pending.release(); assert.equal(await Late, false);
	assert.equal(F.Root.children[0], Current); assert.deepEqual(F.Disposed, ["old", "late"]);
	const Last = deferred(), Closing = F.List.update("new-session", [F.item("new", "closed-late", Last.Wait)], () => true);
	F.List.dispose(); Last.release(); assert.equal(await Closing, false);
	assert.deepEqual(F.Disposed, ["old", "late", "new", "closed-late"]);
});

test("failed or cancelled preparation leaves the previous cards and releases only new resources", async () =>
{
	const F = fixture(); await F.List.update("session", [F.item("old")], () => true); const Previous = F.Root.children[0];
	await assert.rejects(F.List.update("session", [F.item("first"), { Id: "error", Key: "error", Render: async () => { throw Error("renderer failed"); } }], () => true), /renderer failed/);
	assert.equal(F.Root.children[0], Previous); assert.deepEqual(F.Disposed, ["first"]);
	assert.equal(await F.List.update("other", [F.item("cancelled")], () => false), false);
	assert.equal(F.Root.children[0], Previous); assert.deepEqual(F.Disposed, ["first", "cancelled"]); F.List.dispose();
});

test("reordering retains unchanged cards, removes obsolete entries, and rejects duplicate IDs before rendering", async () =>
{
	const F = fixture(); await F.List.update("session", [F.item("a"), F.item("b"), F.item("c")], () => true);
	const [A, B] = F.Root.children;
	await F.List.update("session", [F.item("b"), F.item("a")], () => true);
	assert.deepEqual(F.Root.children, [B, A]); assert.deepEqual(F.Disposed, ["c"]);
	await assert.rejects(F.List.update("session", [F.item("a"), F.item("a")], () => true), /重复/);
	assert.deepEqual(F.Rendered, ["a", "b", "c"]); F.List.dispose();
});
