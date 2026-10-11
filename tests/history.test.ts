import { test } from "node:test";
import assert from "node:assert/strict";
import { branch_prefix, history_items, type ChatMessage } from "../src/history";
import type { ContextSnapshot } from "../src/prompt";

test("resend branches before the edited question, keeps the original transcript and captured source", () =>
{
	const Context: ContextSnapshot = { Path: "original.md", Mode: "阅读", Kind: "选区", Text: "$$x^2$$", SelectedText: "x²", LineStart: 0, LineEnd: 0, Heading: "", Mapping: "源块", CapturedAt: "now", Truncated: false };
	const Messages: ChatMessage[] = [{ Id: "1", Role: "user", Text: "first", Context }, { Id: "2", Role: "assistant", Text: "answer" }, { Id: "3", Role: "user", Text: "edit me", Context }, { Id: "4", Role: "assistant", Text: "later" }];
	const Branch = branch_prefix(Messages, "3");
	assert.deepEqual(Branch.map(Value => Value.Id), ["1", "2"]);
	Branch[0].Context!.Text = "changed";
	assert.equal(Messages[0].Context!.Text, "$$x^2$$");
	assert.equal(Messages.length, 4);
	assert.throws(() => branch_prefix(Messages, "missing"));
});

test("local replay retains submitted prompts and excludes status and reasoning summaries", () =>
{
	const Items = history_items([{ Id: "1", Role: "user", Text: "question", Prompt: "question and original source" }, { Id: "2", Role: "reasoning", Text: "summary" }, { Id: "3", Role: "system", Text: "interrupted" }, { Id: "4", Role: "assistant", Text: "answer" }]);
	assert.equal(Items.length, 2);
	assert.equal(Items[0].content[0].text, "question and original source");
	assert.equal(Items[1].content[0].type, "output_text");
});
