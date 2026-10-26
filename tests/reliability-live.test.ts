import { test } from "node:test";
import assert from "node:assert/strict";
import { live_answer_text } from "../scripts/reliability-live";

test("the opt-in probe observes protocol-two persisted answer references as well as legacy completion events", () =>
{
	assert.equal(live_answer_text({ method: "bridge/message-updated", params: { message: { Role: "assistant", Phase: "final_answer", Text: "Original $x=1$." } } }), "Original $x=1$.");
	assert.equal(live_answer_text({ method: "item/completed", params: { item: { type: "agentMessage", phase: "final_answer", text: "Legacy original." } } }), "Legacy original.");
	assert.equal(live_answer_text({ method: "bridge/message-updated", params: { message: { Role: "assistant", Phase: "commentary", Text: "Not the final answer" } } }), null);
	assert.equal(live_answer_text({ method: "bridge/message-updated", params: { message: { Role: "reasoning", Text: "Private reasoning is not an answer" } } }), null);
	assert.equal(live_answer_text({ method: "turn/completed", params: { turn: { status: "completed" } } }), null);
});
