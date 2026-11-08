import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadingNavigation, type ReadingPosition } from "../src/reading-navigation";
import { capture_reading_block, locate_reading_block } from "../src/quote-location";
import { bind_answer_blocks } from "../src/quote";
import { markdown_blocks } from "../src/markdown-blocks";

const Position = (MessageId: string, Scope = "scope", SessionId = "s"): ReadingPosition => ({ Scope, SessionId, MessageId, Label: "同名引理", Offset: -17 });
function rendered(Text: string)
{
	const Nodes: any[] = markdown_blocks(Text).map(B => ({ tagName: B.Kind === "heading" ? "H2" : B.Kind === "math" ? "DIV" : "P", textContent: B.Kind === "heading" ? B.Text.replace(/^#+ /, "") : B.Text, dataset: {}, classList: { contains: () => false }, matches: () => false, querySelector: () => B.Kind === "math" ? {} : null }));
	const Root: any = { children: Nodes, dataset: {}, contains: () => true, querySelectorAll: () => Nodes.filter(N => N.dataset.codexAnswerBlock) };
	bind_answer_blocks(Root, Text, "scope:s:answer"); return { Root, Nodes };
}
test("R08 return trail swaps exact identities continuously and stays view/context bounded", () =>
{
	const Nav = new ReadingNavigation(12, 3);
	for(let I = 0; I < 20; I++) { Nav.commit(Nav.begin("scope:s", Position("a" + I))); }
	assert.equal(Nav.target("scope:s")!.MessageId, "a19");
	Nav.exchange(Nav.begin("scope:s", Position("original"))); assert.equal(Nav.target("scope:s")!.MessageId, "original");
	Nav.exchange(Nav.begin("scope:s", Position("a19"))); assert.equal(Nav.target("scope:s")!.MessageId, "a19");
	for(let I = 0; I < 12; I++) { Nav.discard("scope:s"); } assert.equal(Nav.target("scope:s"), undefined);
	for(const Context of ["a", "b", "c", "d"]) { Nav.commit(Nav.begin(Context, Position(Context))); }
	assert.equal(Nav.target("a"), undefined); assert.equal(Nav.target("b")!.MessageId, "b"); assert.equal(new ReadingNavigation().target("b"), undefined);
});
test("R08 new user interaction, new navigation and scope/session switches invalidate late tasks", () =>
{
	const Nav = new ReadingNavigation(), Ticket = Nav.begin("scope:s", Position("latest"));
	Nav.cancel(); assert.equal(Nav.current(Ticket, "scope:s"), false); Nav.commit(Ticket); assert.equal(Nav.target("scope:s"), undefined);
	const T2 = Nav.begin("scope:s", Position("a")), T3 = Nav.begin("scope:s", Position("b")); assert.equal(Nav.current(T2, "scope:s"), false); assert.equal(Nav.current(T3, "scope:s"), true);
	Nav.enter("other-scope:s"); assert.equal(Nav.current(T3, "scope:s"), false);
	const T4 = Nav.begin("scope:s", Position("a")); Nav.forget("scope:s"); assert.equal(Nav.current(T4, "scope:s"), false);
});
test("R08 reliable block re-resolves after stream append but rejects edited source, duplicate DOM and another message", () =>
{
	const Text = "## 有界性\n\n逐项估计.\n\n$$x=1$$\n\n结论成立.", Before = rendered(Text), Location = capture_reading_block(Before.Root, Before.Nodes[2], Text, "scope:s:answer")!;
	assert.ok(Location); const Appended = Text + "\n\n新增完整整合结论.", After = rendered(Appended);
	assert.equal(locate_reading_block(After.Root, Location, Appended, "scope:s:answer"), After.Nodes[2]);
	assert.equal(locate_reading_block(After.Root, Location, Appended, "other-scope:s:answer"), null);
	const Changed = Text.replace("x=1", "x=2"), Edited = rendered(Changed); assert.equal(locate_reading_block(Edited.Root, Location, Changed, "scope:s:answer"), null);
	After.Nodes.push({ ...After.Nodes[2] }); assert.equal(locate_reading_block(After.Root, Location, Appended, "scope:s:answer"), null);
});
