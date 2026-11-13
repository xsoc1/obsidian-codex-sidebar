import { test } from "node:test";
import assert from "node:assert/strict";
import { ExplanationActions, explanation_draft } from "../src/explanation-actions";
import { answer_quote } from "../src/quote";
import { build_prompt } from "../src/prompt";

const Text = "设 $V,W$ 为向量空间, $T:V\\to W$.\n\n对 $\\lambda\\in W^*$, 定义 $T^*\\lambda=\\lambda\\circ T$.";
const Message = { Id: "answer", Role: "assistant" as const, Text };
const Quote = answer_quote("original", Message.Id, "$T^*\\lambda=\\lambda\\circ T$", Text, "completed", { SourcePath: "original.md", SourceReferences: [] });

test("three explanation actions preserve the exact source and default integrated follow-up", () =>
{
	const Before = structuredClone(Quote);
	for(const A of ExplanationActions)
	{
		const Draft = explanation_draft(A.Id, Quote, "original", [Message], "", null);
		assert.deepEqual(Draft.Quote, Before); assert.notEqual(Draft.Quote, Quote);
		assert.ok(Draft.Question.includes("整合后的完整说明")); assert.ok(Draft.Question.includes("不写笔记"));
		const Prompt = build_prompt(Draft.Question, null, Draft.Quote);
		assert.ok(Prompt.includes("原说明的起点一直叙述到结论")); assert.ok(Prompt.includes("original.md"));
	}
	assert.deepEqual(Quote, Before);
	assert.equal(new Set(ExplanationActions.map(A => A.Question)).size, 3);
});

test("actions cannot overwrite drafts, retarget changed answers or cross sessions", () =>
{
	assert.throws(() => explanation_draft("plain", Quote, "original", [Message], "my unsent question", null), /草稿/);
	assert.throws(() => explanation_draft("plain", Quote, "original", [Message], "", Quote), /草稿/);
	assert.throws(() => explanation_draft("step", Quote, "other", [Message], "", null), /变化/);
	assert.throws(() => explanation_draft("step", Quote, "original", [{ ...Message, Text: Text + "late edit" }], "", null), /变化/);
	assert.throws(() => explanation_draft("step", Quote, "original", [], "", null), /变化/);
	assert.throws(() => explanation_draft("plain", { ...Quote, SourceStatus: "incomplete" }, "original", [Message], "", null), /完整回答/);
});
