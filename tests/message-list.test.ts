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
	assert.equal(F.Root.children[0], Current); assert.deepEqual(F.Disposed, ["late"]);
	const Last = deferred(), Closing = F.List.update("new-session", [F.item("new", "closed-late", Last.Wait)], () => true);
	F.List.dispose(); Last.release(); assert.equal(await Closing, false);
	assert.deepEqual(F.Disposed, ["late", "new", "old", "closed-late"]);
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

test("returning to a recently viewed note reuses its rendered history immediately and preserves its reading position", async () =>
{
	const F = fixture(); await F.List.update("note-a", [F.item("a1"), F.item("a2"), F.item("a3")], () => true);
	F.Root.scroll(60); const Cards = [...F.Root.children];
	await F.List.update("note-b", [F.item("b")], () => true);
	await F.List.update("note-a", [F.item("a1"), F.item("a2"), F.item("a3")], () => true);
	assert.deepEqual(F.Root.children, Cards, "unchanged history must be reattached, not rendered again");
	assert.deepEqual(F.Rendered, ["a1", "a2", "a3", "b"]);
	assert.equal(F.Root.scrollTop, 60); assert.deepEqual(F.Disposed, []);
	F.List.dispose(); assert.deepEqual(F.Disposed.sort(), ["a1", "a2", "a3", "b"]);
});

test("returning history refreshes changed or removed messages without discarding unchanged cached cards", async () =>
{
	const F = fixture(); await F.List.update("a", [F.item("a1"), F.item("a2"), F.item("a3")], () => true); const First = F.Root.children[0];
	await F.List.update("b", [F.item("b")], () => true);
	await F.List.update("a", [F.item("a1"), F.item("a2", "updated-proposal")], () => true);
	assert.equal(F.Root.children[0], First); assert.equal(F.Root.children.length, 2);
	assert.deepEqual(F.Rendered, ["a1", "a2", "a3", "b", "updated-proposal"]); assert.deepEqual(F.Disposed, ["a2", "a3"]);
	F.List.dispose(); assert.equal(F.Disposed.length, F.Rendered.length);
});

test("least recently visited histories are evicted with all components released, while recent ones remain reusable", async () =>
{
	const F = fixture();
	for(const Name of ["a", "b", "c", "d"]) { await F.List.update(Name, [F.item(Name)], () => true); }
	assert.deepEqual(F.Disposed, ["a"]);
	await F.List.update("b", [F.item("b")], () => true); assert.equal(F.Rendered.filter(Value => Value === "b").length, 1);
	await F.List.update("a", [F.item("a")], () => true); assert.equal(F.Rendered.filter(Value => Value === "a").length, 2);
	F.List.dispose(); assert.equal(F.Disposed.length, F.Rendered.length);
});

test("detached history is bounded by total card count, not only the number of notes", async () =>
{
	const F = fixture(), Items = Array.from({ length: 301 }, (_, Index) => F.item("large-" + Index));
	await F.List.update("large", Items, () => true); await F.List.update("small", [F.item("small")], () => true);
	assert.equal(F.Disposed.length, 301); F.List.dispose(); assert.equal(F.Disposed.length, F.Rendered.length);
});

test("a cancelled cached refresh leaves the original cached history intact for an immediate return", async () =>
{
	const F = fixture(); await F.List.update("a", [F.item("a")], () => true); const Original = F.Root.children[0];
	await F.List.update("b", [F.item("b")], () => true);
	const Pending = deferred(), Late = F.List.update("a", [F.item("a", "obsolete", Pending.Wait)], () => true);
	await F.List.update("c", [F.item("c")], () => true); Pending.release(); assert.equal(await Late, false);
	await F.List.update("a", [F.item("a")], () => true); assert.equal(F.Root.children[0], Original);
	assert.deepEqual(F.Disposed, ["obsolete"]); F.List.dispose(); assert.equal(F.Disposed.length, F.Rendered.length);
});

test("forgetting a conversation disposes its active or cached nodes and prevents late renders from reviving it", async () =>
{
	const F = fixture(); await F.List.update("a", [F.item("a")], () => true); await F.List.update("b", [F.item("b")], () => true);
	F.List.forget("a"); assert.deepEqual(F.Disposed, ["a"]); assert.equal(F.Root.children.length, 1);
	const Pending = deferred(), Late = F.List.update("a", [F.item("a", "late", Pending.Wait)], () => true);
	F.List.forget("a"); Pending.release(); assert.equal(await Late, false); assert.deepEqual(F.Disposed, ["a", "late"]);
	F.List.forget("b"); assert.equal(F.Root.children.length, 0); F.List.dispose(); assert.deepEqual(F.Disposed, ["a", "late", "b"]);
});
