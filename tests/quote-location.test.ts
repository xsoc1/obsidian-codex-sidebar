import { test } from "node:test";
import assert from "node:assert/strict";
import { answer_quote, bind_answer_blocks, quote_blocks } from "../src/quote";
import { markdown_blocks } from "../src/markdown-blocks";
import { locate_answer_blocks, verify_answer_blocks, inherited_quote_session } from "../src/quote-location";

function rendered(Source: string, Key = "scope:session:message")
{
	const Blocks = markdown_blocks(Source), Nodes: any[] = Blocks.map(B => ({ tagName: B.Kind === "math" ? "DIV" : "P", textContent: B.Text, dataset: {}, classList: { contains: () => false }, matches: () => false, querySelector: () => B.Kind === "math" ? {} : null }));
	const Root: any = { children: Nodes, dataset: {}, contains: () => true, querySelectorAll: () => Nodes.filter(N => N.dataset.codexAnswerBlock) };
	bind_answer_blocks(Root, Source, Key);
	return { Root, Nodes, Blocks, Key };
}

test("selected tail formula has a separate immutable block locator, not the larger explanation range", () =>
{
	const Source = Array.from({ length: 200 }, (_, I) => `段落 ${I} ` + "原论证 ".repeat(50)).join("\n\n") + "\n\n$$\n\\theta=1\n$$\n\n尾部结论";
	const F = rendered(Source), Node = F.Nodes.at(-2), Block = F.Blocks.at(-2)!;
	const Quote = answer_quote("session", "message", "θ=1", Source, "completed", quote_blocks(F.Root, { commonAncestorContainer: F.Root, intersectsNode: (N: any) => N === Node } as any, Source, F.Key));
	assert.equal(Quote.SelectedBlocks!.From, Block.From); assert.notEqual(Quote.SelectedBlocks!.From, Quote.SourceRange!.From); assert.equal(Quote.SelectedBlocks!.To, Block.To);
	const Saved = JSON.parse(JSON.stringify(Quote)); assert.deepEqual(locate_answer_blocks(F.Root, Saved.SelectedBlocks, "session", "message", Source, F.Key), [Node]);
	assert.deepEqual(locate_answer_blocks(F.Root, Saved.SelectedBlocks, "other", "message", Source, F.Key), []);
	assert.deepEqual(locate_answer_blocks(F.Root, Saved.SelectedBlocks, "session", "message", Source + "new", F.Key), []);
	assert.deepEqual(locate_answer_blocks(F.Root, Saved.SelectedBlocks, "session", "message", Source, "other-scope"), []);
	Node.dataset.codexAnswerFrom = String(Block.From + 1); assert.deepEqual(locate_answer_blocks(F.Root, Saved.SelectedBlocks, "session", "message", Source, F.Key), []);
});

test("saved original-session block identity can locate an exact inherited copy without accepting an unrelated session", () =>
{
	const Parent = { Id: "original" }, Child = { Id: "child", ParentId: "original" }, Grandchild = { Id: "branch", ParentId: "child" };
	assert.equal(inherited_quote_session(Grandchild, [Parent, Child, Grandchild], "original"), true);
	assert.equal(inherited_quote_session(Grandchild, [Parent, Child, Grandchild], "other-scope"), false);
	assert.equal(inherited_quote_session({ Id: "a", ParentId: "b" }, [{ Id: "b", ParentId: "a" }], "not-ancestor"), false);
	const Text = "original formula", F = rendered(Text, "current-scope:branch:message"), Location = quote_blocks(F.Root, { commonAncestorContainer: F.Root, intersectsNode: () => true } as any, Text, F.Key);
	const Quote = answer_quote("original", "message", "formula", Text, "completed", Location);
	assert.equal(locate_answer_blocks(F.Root, Quote.SelectedBlocks, "original", "message", Text, F.Key).length, 1);
	assert.equal(locate_answer_blocks(F.Root, Quote.SelectedBlocks, "branch", "message", Text, F.Key).length, 0);
});

test("duplicate formulas, legacy ranges and ambiguous DOM blocks cannot fabricate a selection locator", () =>
{
	const Source = "段落\n\n$$x=1$$\n\n后段\n\n$$x=1$$", F = rendered(Source);
	const Quote = answer_quote("session", "message", "x=1", Source, "completed", quote_blocks(F.Root, { commonAncestorContainer: F.Root, intersectsNode: (N: any) => N === F.Nodes.at(-1) } as any, Source, F.Key));
	assert.equal(Quote.SelectedBlocks, undefined); assert.equal(verify_answer_blocks(undefined, "session", "message", Source), false);
	const Single = rendered("first\n\n$$x=1$$\n\nlast");
	const Q = answer_quote("session", "message", "x=1", "first\n\n$$x=1$$\n\nlast", "completed", quote_blocks(Single.Root, { commonAncestorContainer: Single.Root, intersectsNode: (N: any) => N === Single.Nodes[1] } as any, "first\n\n$$x=1$$\n\nlast", Single.Key));
	Single.Nodes.push({ ...Single.Nodes[1] }); assert.deepEqual(locate_answer_blocks(Single.Root, Q.SelectedBlocks, "session", "message", "first\n\n$$x=1$$\n\nlast", Single.Key), []);
});
