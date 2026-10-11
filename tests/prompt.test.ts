import { test } from "node:test";
import assert from "node:assert/strict";
import { build_prompt, bound_text, heading_at, source_excerpt, instruction_items, type ContextSnapshot } from "../src/prompt";

test("reading selection carries original LaTeX and an honest block mapping", () =>
{
	const Source = "# 证明\n\n$$\n\\|Tx-Ty\\| \\le q\\|x-y\\|\n$$\n\n因此...";
	const Snapshot: ContextSnapshot =
	{
		Path: "笔记.md", Mode: "阅读", Kind: "选区", Text: source_excerpt(Source, 2, 4),
		SelectedText: "∥Tx−Ty∥≤q∥x−y∥", LineStart: 2, LineEnd: 4, Heading: "证明", Mapping: "源块", CapturedAt: "2026-10-11", Truncated: false
	};
	const Prompt = build_prompt("检查证明", Snapshot);
	assert.ok(Prompt.includes("\\|Tx-Ty\\| \\le q\\|x-y\\|"));
	assert.ok(Prompt.includes("第 3-5 行"));
	assert.ok(Prompt.includes("映射: 源块"));
	assert.ok(Prompt.includes("∥Tx−Ty∥≤q∥x−y∥"));
});

test("heading trail follows enclosing headings and omits old siblings", () =>
{
	const Headings = [
		{ heading: "Chapter", level: 1, position: { start: { line: 0 } } },
		{ heading: "Old", level: 2, position: { start: { line: 1 } } },
		{ heading: "Sub", level: 3, position: { start: { line: 2 } } },
		{ heading: "New", level: 2, position: { start: { line: 5 } } }
	];
	assert.equal(heading_at(Headings, 3), "Chapter > Old > Sub");
	assert.equal(heading_at(Headings, 6), "Chapter > New");
});

test("no context leaves the user's question intact; truncation is explicit", () =>
{
	assert.equal(build_prompt("你好", null), "你好");
	assert.deepEqual(bound_text("123456", 3), { Text: "123", Truncated: true });
});

test("work instructions use a developer item independent of user and captured note content", () =>
{
	const Items = instruction_items("Use $...$ and $$...$$ in Obsidian.");
	assert.equal(Items[0].role, "developer");
	assert.equal(Items[0].content[0].type, "input_text");
	assert.ok(Items[0].content[0].text.endsWith("Use $...$ and $$...$$ in Obsidian."));
	assert.equal(build_prompt("Question", null), "Question");
});
