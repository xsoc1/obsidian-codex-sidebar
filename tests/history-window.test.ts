import { test } from "node:test";
import assert from "node:assert/strict";
import { HistoryWindow } from "../src/history-window";
import { followup_index, operation_label } from "../src/history-view-state";
import type { ChatMessage } from "../src/history";
import { retention_label, target_location, write_status } from "../src/edit/card-state";

const Messages = Array.from({ length: 240 }, (_, I) => ({ Id: "original-" + I }));
test("cold history starts with one recent batch, loads older on demand and preserves its warm window", () =>
{
	const W = new HistoryWindow(), First = W.select("a", Messages, false); assert.equal(First.Items.length, 40); assert.equal(First.Earlier, 200);
	W.older("a", Messages); const Expanded = W.select("a", Messages, true); assert.equal(Expanded.Items.length, 80); assert.equal(Expanded.Earlier, 160);
	W.select("b", Messages, false); assert.equal(W.select("a", Messages, true).Items.length, 80);
	assert.equal(W.select("a", Messages, false).Items.length, 40, "evicted or restarted views are cold, not full-history renders");
});
test("source-chain navigation loads a bounded neighborhood and returns to latest without changing saved history", () =>
{
	const W = new HistoryWindow(), Before = JSON.stringify(Messages); W.select("a", Messages, false);
	assert.equal(W.focus("a", Messages, "original-10"), true); const Focused = W.select("a", Messages, true);
	assert.equal(Focused.Items.length, 40); assert.ok(Focused.Items.some(M => M.Id === "original-10")); assert.ok(Focused.Later > 0);
	W.latest("a"); assert.equal(W.select("a", Messages, true).Items.at(-1)!.Id, "original-239"); assert.equal(JSON.stringify(Messages), Before);
	assert.equal(W.focus("a", Messages, "not-here"), false);
	const Cold = new HistoryWindow(); Cold.focus("unopened", Messages, "original-10"); assert.ok(Cold.select("unopened", Messages, false).Items.some(M => M.Id === "original-10"));
});
test("edit cards show real snapshot lines, Chinese status and stored retention without another counter", () =>
{
	const Before = "# Original\n\n```text\n# Not a heading\n```\n\n## Proof\n$x=1$.\n", From = Before.indexOf("$"), Loc = target_location({ Path: "Original.md", Before, Version: "v", BlockId: null, Role: "note", Operation: "replace-range", Range: { From, To: From + 5 } });
	assert.deepEqual(Loc, { Heading: "Original > Proof", Start: 8, End: 8 }); assert.equal(write_status("pending"), "写入结果待核对");
	const Record: any = { Cache: { Context: "original", Armed: true, Remaining: 2, Seen: ["t"] } };
	assert.match(retention_label(Record, 2), /2 轮/); assert.match(retention_label(Record, 0), /永不/); delete Record.Cache; assert.match(retention_label(Record, 1), /旧记录/);
	assert.equal(operation_label("submission-unknown"), "提交结果待核对");
});
test("three integrated followups retain the original and link each generation to the latest explanation", () =>
{
	const M: ChatMessage[] = [{ Id: "root", Role: "assistant", Text: "原始完整说明" }];
	for(let I = 1; I <= 3; I++)
	{
		M.push({ Id: "u" + I, Role: "user", TurnId: "t" + I, Text: "解释这一步", Quote: { SessionId: "s", MessageId: I === 1 ? "root" : "a" + (I - 1), RootMessageId: "root", SelectedText: "原片段", SourceText: "完整说明", SelectedTruncated: false, SourceTruncated: false } }, { Id: "a" + I, Role: "assistant", TurnId: "t" + I, Text: "第" + I + "次完整整合" });
	}
	const Before = JSON.stringify(M), Index = followup_index(M);
	assert.deepEqual(Index.get("root"), { RootId: "root", ParentId: null, LatestId: "a3", LatestUnknown: true });
	assert.deepEqual(Index.get("a3"), { RootId: "root", ParentId: "a2", LatestId: "a3", LatestUnknown: true }); assert.equal(Index.get("a1")?.LatestId, "a3"); assert.equal(JSON.stringify(M), Before);
});

test("failed commentary, interrupted and running answers cannot replace the last confirmed integrated final", () =>
{
	const Quote = { SessionId: "s", MessageId: "root", RootMessageId: "root", SelectedText: "x", SourceText: "原说明", SelectedTruncated: false, SourceTruncated: false };
	const M: ChatMessage[] = [{ Id: "root", Role: "assistant", Text: "原说明" }, { Id: "u1", Role: "user", TurnId: "t1", Text: "第一次追问", Quote }, { Id: "a1", Role: "assistant", TurnId: "t1", Text: "成功完整说明", Phase: "final_answer", CompletionStatus: "completed" }, { Id: "u2", Role: "user", TurnId: "t2", Text: "第二次追问", Quote }, { Id: "a2", Role: "assistant", TurnId: "t2", Text: "检查中", Phase: "commentary", CompletionStatus: "failed" }];
	const Before = JSON.stringify(M);
	assert.equal(followup_index(M).get("root")?.LatestId, "a1");
	M.at(-1)!.Phase = "final_answer"; M.at(-1)!.CompletionStatus = "interrupted";
	assert.equal(followup_index(M).get("root")?.LatestId, "a1");
	delete M.at(-1)!.CompletionStatus;
	assert.equal(followup_index(M).get("root")?.LatestId, "a1");
	delete M.at(-1)!.Phase;
	assert.equal(followup_index(M, "t2").get("root")?.LatestId, "a1");
	assert.equal(followup_index(M).get("root")?.LatestId, "a1", "unknown legacy remains fallback, not confirmed final");
	M.at(-1)!.CompletionStatus = "completed";
	assert.equal(followup_index(M).get("root")?.LatestId, "a2", "completed old phase-less answer stays eligible");
	assert.equal(JSON.parse(Before).at(-1).CompletionStatus, "failed");
});

test("continuous older navigation has a fixed mount capacity and can traverse both directions", () =>
{
	const W = new HistoryWindow(), Many = Array.from({ length: 4000 }, (_, I) => ({ Id: "m" + I }));
	W.select("a", Many, false);
	for(let I = 0; I < 100; I++) { W.older("a", Many); assert.ok(W.select("a", Many, true).Items.length <= 120); }
	assert.equal(W.select("a", Many, true).Earlier, 0);
	W.newer("a", Many); const Next = W.select("a", Many, true); assert.equal(Next.Earlier, 40); assert.equal(Next.Items.length, 120);
	W.latest("a"); const Latest = W.select("a", Many, true); assert.equal(Latest.Items.length, 40); assert.equal(Latest.Items.at(-1)?.Id, "m3999");
});
