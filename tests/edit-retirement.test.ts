import { test } from "node:test";
import assert from "node:assert/strict";
import { make_task, task_prompt, type TaskSpec } from "../src/edit/task";
import { note_path, unique_blocks, version_of } from "../src/edit/document";
import { ConfirmedWriter } from "../src/edit/writer";
import type { WritePlan } from "../src/edit/write-types";
import { question_label, structured_task } from "../src/edit/presentation";
import { branch_prefix, history_items, type ChatMessage } from "../src/history";

test("retired task snapshots remain readable and immutable but cannot produce runnable prompts or write plans", () =>
{
	const Task: TaskSpec = { ...make_task("edit", null, "旧练习"), Action: "exercise", Scope: "nearby-exercise", ExerciseId: "original-id" };
	const Messages: ChatMessage[] = [{ Id: "user", Role: "user", Text: "旧练习", Task, TurnId: "turn", Prompt: "original saved prompt" }, { Id: "reply", Role: "assistant", Text: '{"statement":"original","solution":"answer"}', TurnId: "turn" }, { Id: "next", Role: "user", Text: "new question" }];
	const Before = JSON.stringify(Messages);
	assert.equal(history_items(Messages)[0].content[0].text, "original saved prompt");
	assert.equal(structured_task(Messages, Messages[1]), null);
	const Branch = branch_prefix(Messages, "next");
	Branch[0].Task!.Request = "changed copy";
	assert.equal(JSON.stringify(Messages), Before);
	assert.throws(() => task_prompt(Task), /已移除/);
	assert.throws(() => make_task("exercise" as "edit", null, "old"), /已移除/);
	assert.equal(question_label({ ...Task, Action: "feedback", Request: "legacy non-JSON text" }), "legacy non-JSON text");
});

test("confirmed writer rejects retired lecture operations even when supplied a valid old baseline", async () =>
{
	for(const Operation of ["create", "insert-after", "replace-unit"] as const)
	{
		const Before = Operation === "create" ? null : "original";
		const Plan: WritePlan = { Id: "write", TaskId: "old", Target: { Path: "old.md", Before, Version: await version_of(Before), BlockId: "old-unit", Operation, Role: "lecture" }, After: "replacement", Rationale: "legacy", State: "preview" };
		const Store = { Data: { Writes: [Plan] }, change(Update: (Data: { Writes: WritePlan[] }) => void) { Update(this.Data); } };
		let Reads = 0, Writes = 0;
		const Writer = new ConfirmedWriter(Store, { read_current: async () => { Reads++; return Before; }, compare_write: async () => { Writes++; } });
		await assert.rejects(Writer.confirm(Plan.Id), /操作或宿主基线无效/);
		assert.equal(Reads, 0); assert.equal(Writes, 0);
		Plan.State = "applied";
		await assert.rejects(Writer.undo(Plan.Id), /只支持/);
		assert.equal(Writes, 0);
	}
});

test("shared Markdown write guards retain vault bounds and reject real duplicate anchors while ignoring code and math", () =>
{
	for(const Path of ["../x.md", "/x.md", "C:/x.md", "x\\x.md", ".obsidian/x.md", "a/../x.md", "a/.hidden.md", "x.md ", "x.md/../y.md"])
	{
		assert.throws(() => note_path(Path));
	}
	assert.throws(() => unique_blocks("# First\n\n^same\n\n# Second\n\n^same"), /重复/);
	assert.doesNotThrow(() => unique_blocks("# Text\n\n^same\n\n```\n^same\n```\n\n$$\n^same\n$$"));
});
