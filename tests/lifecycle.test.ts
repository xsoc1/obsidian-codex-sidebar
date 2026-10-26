import { test } from "node:test";
import assert from "node:assert/strict";
import { RunLifecycle, preparation_step } from "../src/runtime/lifecycle";
import { send_intent, merge_outbox } from "../src/runtime/outbox";
import { environment_diagnostics } from "../src/diagnostics";

test("preparation cancellation returns immediately, leaves late receipt readable and cannot affect a newer UI ticket", async () =>
{
	const Runtime = new RunLifecycle(), Old = Runtime.begin("scope", "A"); let Release!: (V: string) => void;
	const Work = new Promise<string>(R => Release = R), Pending = preparation_step(Work, Old, Runtime);
	assert.equal(Runtime.CanStop, true); Runtime.cancel_preparation(); await assert.rejects(Pending, /准备已取消/);
	const Next = Runtime.begin("scope", "B"); Release("late-receipt"); assert.equal(await Work, "late-receipt");
	Runtime.stage("generating", Old); assert.equal(Runtime.Stage, "preparing"); assert.equal(Runtime.current(Next), true);
	Runtime.finish(Old); assert.equal(Runtime.Active, Next); Runtime.close(); assert.equal(Runtime.Stage, "offline");
});

test("unknown submission is a reconciliation stage, never a preparation cancellation", () =>
{
	const Runtime = new RunLifecycle(), Ticket = Runtime.begin("scope", "A"); Runtime.stage("submission-unknown", Ticket);
	assert.equal(Runtime.cancel_preparation(), null); assert.equal(Runtime.Stage, "submission-unknown"); assert.equal(Runtime.CanStop, true);
});

test("durable intents retain immutable inputs and refuse same-id changes", async () =>
{
	const Input = { Prompt: "Original $x=1$", Source: { Text: "Original $x=1$" } }, Intent = await send_intent("scope", "A", "message", Input);
	Input.Source.Text = "later"; assert.equal((Intent.Input as any).Source.Text, "Original $x=1$");
	assert.equal(merge_outbox([Intent], [structuredClone(Intent)]).length, 1);
	assert.throws(() => merge_outbox([Intent], [{ ...Intent, Input: { Prompt: "different" } }]), /输入冲突/);
});

test("environment diagnostics isolate a missing dependency without inference or losing successful checks", async () =>
{
	const Result = await environment_diagnostics([{ Name: "CLI", Run: async () => ({ Status: "ok", Detail: "Available" }) }, { Name: "skill", Run: async () => { throw Error("Original missing skill"); } }]);
	assert.equal(Result[0].Status, "ok"); assert.equal(Result[1].Status, "error"); assert.match(Result[1].Detail, /missing skill/);
});
