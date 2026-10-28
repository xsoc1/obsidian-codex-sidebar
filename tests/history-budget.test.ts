import { test } from "node:test";
import assert from "node:assert/strict";
import { build_history_input, plan_history_input, read_history_page } from "../src/history-budget";
import type { ChatMessage } from "../src/history";
import type { ContextSnapshot } from "../src/prompt";

function history(Count: number, Length = 2000): ChatMessage[]
{
	return Array.from({ length: Count }, (_, I) => [{ Id: "u-" + I, Role: "user" as const, Text: "Original question " + I, Prompt: "Original source for turn " + I + "\n" + "$x=1$. ".repeat(Length), TurnId: "t-" + I }, { Id: "a-" + I, Role: "assistant" as const, Text: "Original proof " + I + "\n" + "By linearity. ".repeat(Length), TurnId: "t-" + I, CompletionStatus: "completed" as const }]).flat();
}

test("a model-history budget selects complete recent rounds without removing persistent messages or prompts", () =>
{
	const Messages = history(30, 300), Before = JSON.stringify(Messages), Result = build_history_input(Messages, { ModelContextWindow: 100000, MaxUtf8Bytes: 45000 });
	assert.equal(JSON.stringify(Messages), Before); assert.equal(Result.Ledger.BudgetKind, "reported-window-conservative-bytes");
	assert.ok(Result.Ledger.ActualUtf8Bytes <= Result.Ledger.Utf8Budget); assert.ok(Result.Ledger.OmittedMessageIds.length);
	assert.deepEqual(Result.Messages.slice(-2).map(M => M.Id), ["u-29", "a-29"]);
	for(const M of Result.Messages.filter(M => M.Role === "user")) { assert.ok(Result.Messages.some(A => A.TurnId === M.TurnId && A.Role === "assistant")); assert.equal(M.Prompt, Messages.find(O => O.Id === M.Id)!.Prompt); }
	assert.equal(Result.Items[0].role, "developer"); assert.match(Result.Navigation, /不是精确token数/);
});

test("mandatory original material refuses an oversized request instead of truncating a proof or pretending exact tokens", () =>
{
	const Messages = history(1, 1000), Before = JSON.stringify(Messages);
	assert.throws(() => plan_history_input(Messages, { MaxUtf8Bytes: 18000 }), /完整回合/); assert.equal(JSON.stringify(Messages), Before);
	const Plan = plan_history_input(history(2, 4)); assert.equal(Plan.Ledger.BudgetKind, "unknown-window-conservative-bytes"); assert.equal(Plan.Ledger.ReportedModelWindow, null);
});

test("derived input deduplicates exact repeated snapshots only after their actual earlier inclusion", () =>
{
	const Text = "Definition: $x=1$.\n".repeat(70), Context: ContextSnapshot = { Path: "Original.md", Mode: "阅读", Kind: "当前位置", Text, SelectedText: "", LineStart: 0, LineEnd: 70, Heading: "Original", Mapping: "源块", CapturedAt: "original-time", Truncated: false };
	const Messages: ChatMessage[] = [{ Id: "u1", Role: "user", Text: "Explain", Context, Prompt: "Explain\n" + Text }, { Id: "a1", Role: "assistant", Text: "Original explanation" }, { Id: "u2", Role: "user", Text: "Continue", Context: structuredClone(Context), Prompt: "Continue\n" + Text }];
	const Before = JSON.stringify(Messages), Plan = plan_history_input(Messages);
	assert.equal(JSON.stringify(Messages), Before); assert.equal(Plan.Ledger.Deduplicated.length, 1); assert.equal(Plan.Ledger.Deduplicated[0].ProvidedIn, "u1");
	assert.ok(Plan.Messages[0].Prompt!.includes(Text)); assert.ok(!Plan.Messages[2].Prompt!.includes(Text)); assert.match(Plan.Messages[2].Prompt!, /历史消息 u1/);
});

test("history reads are versioned, bounded and tied to the host-bound conversation, not client-selected scopes", async () =>
{
	const Messages = history(2, 20), List = await read_history_page("host-session", Messages, { command: "list", limit: 1 }), Page = JSON.parse(List.contentItems[0].text);
	assert.equal(Page.messages.length, 1); assert.equal(Page.next_offset, 1);
	assert.equal((await read_history_page("host-session", Messages, { command: "read", message_id: "u-0", field: "prompt", version: Page.version })).success, false);
	const Read = await read_history_page("host-session", Messages, { command: "read", message_id: "u-0", field: "prompt", length: 32 }), Body = JSON.parse(Read.contentItems[0].text);
	assert.equal(Body.text, Messages[0].Prompt!.slice(0, 32)); assert.equal(Body.next_offset, 32);
	Messages[0].Prompt += " changed"; assert.equal((await read_history_page("host-session", Messages, { command: "read", message_id: "u-0", field: "prompt", version: Body.version })).success, false);
	for(const Input of [{ command: "list", session: "other" }, { command: "read", message_id: "not-current" }, { command: "read", message_id: "u-0", field: "source" }, { command: "read", message_id: "u-0", length: 16001 }]) { assert.equal((await read_history_page("host-session", Messages, Input)).success, false); }
});
