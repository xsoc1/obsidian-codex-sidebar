import test from "node:test";
import assert from "node:assert/strict";
import { message_checkpoint } from "../src/runtime/message-events";
import type { ChatSession } from "../src/sessions";
import type { SyncConflict } from "../src/sync/types";

test("checkpoints replace partial text once by comparable source revision and retain terminal answers", () =>
{
	const Session: ChatSession = { Id: "a", Title: "original", ThreadId: "t", Messages: [] }, Conflicts: SyncConflict[] = [];
	const Partial = { Id: "m", TurnId: "turn", Role: "assistant" as const, Text: "partial", SyncVersion: { Origin: "scope", Revision: 1, Digest: "one" } };
	assert.equal(message_checkpoint(Session, Partial, Conflicts), true);
	const Final = { ...Partial, Text: "original complete proof", CompletionStatus: "completed" as const, SyncVersion: { Origin: "scope", Revision: 2, Digest: "two" } };
	assert.equal(message_checkpoint(Session, Final, Conflicts), true); assert.equal(message_checkpoint(Session, Final, Conflicts), false);
	assert.equal(message_checkpoint(Session, Partial, Conflicts), false);
	assert.equal(message_checkpoint(Session, { ...Partial, SyncVersion: { ...Partial.SyncVersion, Revision: 3 } }, Conflicts), false);
	assert.equal(Session.Messages[0].Text, Final.Text); assert.equal(Conflicts.length, 0);
});

test("checkpoint version cannot authorize changing the saved user input or a different origin", () =>
{
	const User = { Id: "u", Role: "user" as const, Text: "original question", Prompt: "immutable original $x$", Context: null, OperationId: "op" };
	const Session: ChatSession = { Id: "a", Title: "original", ThreadId: "t", Messages: [User] }, Conflicts: SyncConflict[] = [];
	assert.equal(message_checkpoint(Session, { ...User, Prompt: "changed", SyncVersion: { Origin: "scope", Revision: 99, Digest: "new" } }, Conflicts), false);
	assert.equal(Session.Messages[0].Prompt, User.Prompt); assert.equal(Conflicts.length, 1);
	message_checkpoint(Session, { Id: "r", Role: "assistant", Text: "saved", SyncVersion: { Origin: "one", Revision: 1, Digest: "old" } }, Conflicts);
	assert.equal(message_checkpoint(Session, { Id: "r", Role: "assistant", Text: "other", SyncVersion: { Origin: "two", Revision: 100, Digest: "new" } }, Conflicts), false);
	assert.equal(Session.Messages[1].Text, "saved"); assert.equal(Conflicts.length, 2);
});
