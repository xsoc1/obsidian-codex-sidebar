import { test } from "node:test";
import assert from "node:assert/strict";
import { ComposerDraftStore } from "../src/composer-draft";
import type { ContextSnapshot, AnswerQuote } from "../src/prompt";

function storage()
{
	const Data = new Map<string, string>();
	return { Data, getItem: (Key: string) => Data.get(Key) ?? null, setItem: (Key: string, Value: string) => { Data.set(Key, Value); } };
}
const Context: ContextSnapshot = { Path: "Original.md", Text: "设 $[X,Y]=XY-YX$.", SelectedText: "$[X,Y]$", Mode: "阅读", Kind: "选区", Mapping: "源块", CapturedAt: "original-snapshot", Heading: "交换子", LineStart: 2, LineEnd: 2, Truncated: false };
const Quote: AnswerQuote = { SessionId: "a", MessageId: "answer", SelectedText: "核对线性", SourceText: "固定 X, 分别代入加法与数乘核对线性.", SelectedTruncated: false, SourceTruncated: false, SourcePath: "Original.md" };
test("composer survives a new store instance with original text, source and quote, isolated by device/scope/session", () =>
{
	const S = storage(), A = new ComposerDraftStore(S, "device:vault:bridge-a", "a");
	A.save("解释这一步", { Context, Quote }, 0);
	const Restored = new ComposerDraftStore(S, A.Scope, "a").load()!;
	assert.equal(Restored.Text, "解释这一步"); assert.deepEqual(Restored.Context, Context); assert.deepEqual(Restored.Quote, Quote);
	Restored.Context!.Text = "changed copy"; assert.equal(A.load()!.Context!.Text, Context.Text);
	assert.equal(new ComposerDraftStore(S, A.Scope, "b").load(), null); assert.equal(new ComposerDraftStore(S, "other-device:vault:bridge-a", "a").load(), null);
	assert.equal(new ComposerDraftStore(S, "device:vault:bridge-b", "a").load(), null);
});
test("composer compare-and-save rejects other-window replacement and keeps both caller input and saved bytes", () =>
{
	const S = storage(), A = new ComposerDraftStore(S, "scope", "a"), B = new ComposerDraftStore(S, "scope", "a");
	A.save("old", { Context, Quote: null }, 0); const Rev = B.load()!.Revision;
	A.save("new window", { Context, Quote: null }, 1); const Before = S.getItem(A.Key);
	assert.throws(() => B.save("local unsaved", { Context, Quote: null }, Rev), /另一窗口/); assert.equal(S.getItem(A.Key), Before);
	assert.equal(B.save("new window", { Context, Quote: null }, Rev)!.Revision, 2, "identical content may be acknowledged without rewriting");
});
test("composer unknown/corrupt schema and wrong quote identity never overwrite original bytes", () =>
{
	const S = storage(), A = new ComposerDraftStore(S, "scope", "a"); S.setItem(A.Key, '{"schemaVersion":99}');
	assert.throws(() => A.save("new", { Context: null, Quote: null }, 0), /原数据保留/); assert.equal(S.getItem(A.Key), '{"schemaVersion":99}');
	S.Data.delete(A.Key); assert.throws(() => A.save("new", { Context: null, Quote: { ...Quote, SessionId: "other" } }, 0), /原会话/); assert.equal(A.load(), null);
});
test("composer quota/readback failures retain original stored input and excessive sources are not truncated", () =>
{
	const S = storage(), A = new ComposerDraftStore(S, "scope", "a"); A.save("keep", { Context, Quote: null }, 0); const Before = S.getItem(A.Key);
	assert.throws(() => A.save("大".repeat(200000), { Context, Quote: null }, 1), /保存预算/); assert.equal(S.getItem(A.Key), Before);
	const Failing = new ComposerDraftStore({ getItem: S.getItem, setItem: () => { throw Error("quota fixture"); } }, "scope", "a");
	assert.throws(() => Failing.save("unsaved", { Context, Quote: null }, 1), /quota fixture/); assert.equal(S.getItem(A.Key), Before);
	const Noop = new ComposerDraftStore({ getItem: S.getItem, setItem: () => {} }, "scope", "a"); assert.throws(() => Noop.save("unsaved", { Context, Quote: null }, 1), /回读/);
});
test("cleared composer does not retain a hidden source and quote-only drafts remain recoverable", () =>
{
	const S = storage(), A = new ComposerDraftStore(S, "scope", "a"); assert.equal(A.save("", { Context, Quote: null }, 0), null);
	A.save("", { Context: null, Quote }, 0); assert.deepEqual(A.load()!.Quote, Quote);
	A.save("", { Context, Quote: null }, 1); assert.equal(A.load()!.Context, null); assert.equal(A.load()!.Quote, null);
});
