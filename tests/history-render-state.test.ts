import { test } from "node:test";
import assert from "node:assert/strict";
import { HistoryRenderState } from "../src/history-render-state";
import type { ChatMessage } from "../src/history";
import { EditViewState } from "../src/edit-view-state";

test("streaming work is bounded by visible messages and changed IDs, independent of stored prompts", () =>
{
	for(const Count of [240, 1000, 4000])
	{
		const Messages: ChatMessage[] = Array.from({ length: Count }, (_, I) => ({ Id: "m" + I, Role: I % 2 ? "assistant" : "user", TurnId: "t" + Math.floor(I / 2), Text: "原创证明".repeat(200), Prompt: "原始问题与条件".repeat(1000) }));
		const State = new HistoryRenderState(), Visible = Messages.slice(-40); State.prepare(Messages, Visible);
		for(const M of Visible) { State.source(M); }
		const Before = { ...State.Stats }, OriginalPrompt = Messages[0].Prompt;
		for(let I = 0; I < 8; I++)
		{
			Messages.at(-1)!.Text += "新的推导"; State.invalidate([Messages.at(-1)!.Id]); State.prepare(Messages, Visible);
			for(const M of Visible) { State.source(M); }
		}
		assert.equal(State.Stats.ScannedMessages - Before.ScannedMessages, 0);
		assert.equal(State.Stats.NavigationScans - Before.NavigationScans, 0);
		assert.equal(State.Stats.CheckedMessages - Before.CheckedMessages, 8 * 40);
		assert.equal(State.Stats.SourceBuilds - Before.SourceBuilds, 8);
		assert.equal(Messages[0].Prompt, OriginalPrompt);
	}
});

test("source changes invalidate related turn cards while later focus never retargets their Markdown base", () =>
{
	const Context: any = { Path: "A/Original.md", Kind: "选区", Mode: "阅读", Mapping: "源块", CapturedAt: "original", Text: "$x=1$", LineStart: 0, LineEnd: 0, Truncated: false };
	const Messages: ChatMessage[] = [{ Id: "u", Role: "user", TurnId: "t", Text: "解释", Context }, { Id: "a", Role: "assistant", TurnId: "t", Text: "说明" }];
	const State = new HistoryRenderState(); State.prepare(Messages, Messages); const Before = State.source(Messages[1]); const Revision = State.version("a");
	Messages[0].Sources = [{ ...Before.Sources[0], CurrentPath: "B/Original.md" }]; State.invalidate(["u"]); State.prepare(Messages, Messages);
	assert.equal(State.source(Messages[1]).Path, "A/Original.md"); assert.equal(State.source(Messages[1]).Sources[0].CurrentPath, "B/Original.md"); assert.ok(State.version("a") > Revision);
	Messages.push({ Id: "other", Role: "user", TurnId: "other", Text: "下一篇", Context: { ...Context, Path: "Other.md" } }); State.prepare(Messages, Messages);
	assert.equal(State.source(Messages[1]).Path, "A/Original.md");
});

test("completion and array replacement update navigation; resets do not retain deleted entries", () =>
{
	const Quote = { SessionId: "s", MessageId: "root", SelectedText: "x", SourceText: "原说明", SelectedTruncated: false, SourceTruncated: false };
	const Messages: ChatMessage[] = [{ Id: "root", Role: "assistant", Text: "原说明" }, { Id: "u", Role: "user", Text: "追问", TurnId: "t", Quote }, { Id: "a", Role: "assistant", Text: "整合说明", TurnId: "t", Phase: "final_answer" }];
	const State = new HistoryRenderState(); State.prepare(Messages, Messages, "t"); assert.equal(State.Followups.get("root")?.LatestId, undefined);
	Messages[2].CompletionStatus = "completed"; State.invalidate(["a"]); State.prepare(Messages, Messages, null); assert.equal(State.Followups.get("root")?.LatestId, "a");
	const Replacement = Messages.slice(0, 1); State.prepare(Replacement, Replacement, null); assert.equal(State.Followups.has("root"), false); assert.equal(State.version("a"), 0);
});

test("an off-window immutable user checkpoint refreshes its visible answer source and turn binding", () =>
{
	const Context: any = { Path: "Original.md", Kind: "选区", Mode: "阅读", Mapping: "源块", CapturedAt: "original", Text: "$x=1$", LineStart: 0, LineEnd: 0, Truncated: false };
	const Messages: ChatMessage[] = [{ Id: "u", Role: "user", TurnId: "t", Text: "解释", Context }, { Id: "a", Role: "assistant", TurnId: "t", Text: "说明" }];
	const State = new HistoryRenderState(); State.prepare(Messages, [Messages[1]]); const Sources = State.source(Messages[1]).Sources;
	Messages[0] = { ...Messages[0], Sources: [{ ...Sources[0], CurrentPath: "Moved.md" }] }; State.invalidate(["u"]); State.prepare(Messages, [Messages[1]]);
	assert.equal(State.source(Messages[1]).Sources[0].CurrentPath, "Moved.md");
	Messages[0].TurnId = "other"; State.invalidate(["u"]); State.prepare(Messages, [Messages[1]]);
	assert.equal(State.source(Messages[1]).Path, "");
});

test("edit render keys ignore evidence volume but invalidate adoption, undo, retention and changed proposals", () =>
{
	const Data: any = { CacheTurns: 1, Records: [{ Spec: { Id: "a" }, Status: "complete", Output: { markdown: "$x=1$" }, Cache: { Context: "s", Armed: true, Remaining: 1, Seen: ["old-turn"] } }, { Spec: { Id: "b" }, Status: "complete" }], Writes: [{ Id: "w", TaskId: "a", State: "preview", After: "很长的新稿".repeat(10000) }] };
	const State = new EditViewState(); State.update(Data); const First = State.key("a"), Other = State.key("b");
	State.update(Data); assert.equal(State.key("a"), First);
	const Adopted = structuredClone(Data); Adopted.Writes[0].State = "applied"; State.update(Adopted); const Applied = State.key("a"); assert.notEqual(Applied, First); assert.equal(State.key("b"), Other);
	const Undo = structuredClone(Adopted); Undo.Writes[0].UndoPending = true; State.update(Undo); assert.notEqual(State.key("a"), Applied);
	const Before = State.key("a"), Revised = structuredClone(Undo); Revised.Records[0].Output.markdown = "$x=2$"; State.update(Revised); assert.notEqual(State.key("a"), Before);
	const Expired = structuredClone(Revised); Expired.Records = []; Expired.Writes = []; State.update(Expired); assert.equal(State.key("a"), 0);
});
