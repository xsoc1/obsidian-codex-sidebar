import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { hidden_process, type HiddenProcessOptions, type HiddenProcessResult } from "../src/hidden-process";
import { agent_result } from "../src/headless-agents";
import { backend_generate } from "../src/backend";

async function run_fixture(Script: string, Options: HiddenProcessOptions = {}, Signal = new AbortController().signal): Promise<HiddenProcessResult>
{
	const Root = resolve(tmpdir()), Cwd = await mkdtemp(join(Root, "sidebar-agent-test-"));
	try
	{
		await writeFile(join(Cwd, "owned.cjs"), Script);
		return await hidden_process(process.execPath, [join(Cwd, "owned.cjs")], Cwd, {}, "original synthetic proof input", Signal, Options);
	}
	finally
	{
		assert.equal(dirname(Cwd), Root); assert.ok(basename(Cwd).startsWith("sidebar-agent-test-")); await rm(Cwd, { recursive: true, force: true });
	}
}
const Success = 'JSON.stringify({type:"result",subtype:"success",is_error:false,result:"actual finite proof",model:"actual-agent-model",usage:{input_tokens:12,output_tokens:8}})';

test("owned temporary native process receives stdin only after the DSH guard marker", async () =>
{
	const Evidence: string[] = [];
	const Process = await run_fixture(`
let received = "";
process.stdin.on("data", C => { received += C; });
setTimeout(() => {
	if(received) { process.exit(8); }
	process.stderr.write("\\nGUARD");
	setTimeout(() => process.stderr.write("_READY\\r\\n"), 20);
}, 40);
process.stdin.on("end", () => {
	if(received !== "original synthetic proof input") { process.exit(9); }
	process.stdout.write(${Success});
});
`, { Ready: "GUARD_READY", GuardTimeoutMs: 2000, OnMetadata: M => Evidence.push(M.Submission!) });
	assert.equal(Process.Submitted, true); assert.equal(Process.ExitCode, 0); assert.equal(Process.Reason, undefined);
	assert.deepEqual(Evidence, ["not-submitted", "submitted"]);
	const Result = agent_result("claude", Process); assert.equal(Result.Status, "completed"); assert.equal(Result.Metadata.Model, "actual-agent-model"); assert.equal(Result.Metadata.Usage?.[0].TotalTokens, undefined);
});

test("missing guard times out before submission and cannot be confused with an unknown server result", async () =>
{
	const Process = await run_fixture('process.stdin.resume(); setInterval(() => {}, 1000);', { Ready: "NEVER_READY", GuardTimeoutMs: 100 });
	assert.equal(Process.Submitted, false); assert.match(Process.Reason!, /guard-not-ready/);
	assert.equal(agent_result("dsh", Process).Metadata.Submission, "not-submitted");
	assert.equal(agent_result("dsh", Process).Status, "failed");
});

test("guard rejection and executable launch failure are confirmed not-submitted", async () =>
{
	const Guard = await run_fixture('process.exit(4);', { Ready: "NEVER_READY" });
	assert.equal(Guard.Submitted, false); assert.equal(agent_result("dsh", Guard).Status, "failed");
	const Missing = await hidden_process(join(tmpdir(), "sidebar-nonexistent-fixture.exe"), [], tmpdir(), {}, "not sent", new AbortController().signal);
	assert.equal(Missing.Submitted, false); assert.match(Missing.Reason!, /launch-failed-before-submit/);
});

test("input delivered then nonzero exit or malformed stdout remains unknown", async () =>
{
	for(const Script of ['process.stdin.resume(); process.stdin.on("end", () => process.exit(6));', 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("not machine JSON"));'])
	{
		const Process = await run_fixture(Script); assert.equal(Process.Submitted, true);
		const Result = agent_result("claude", Process); assert.equal(Result.Status, "unknown"); assert.equal(Result.Metadata.Submission, "unknown");
	}
});

test("valid completed terminal remains completed even if the local child subsequently exits nonzero", async () =>
{
	const Process = await run_fixture(`process.stdin.resume(); process.stdin.on("end", () => { process.stdout.write(${Success}, () => process.exit(7)); });`);
	assert.equal(Process.ExitCode, 7); assert.equal(agent_result("claude", Process).Status, "completed");
});

test("agent-defined incomplete final preserves the body and actual usage", async () =>
{
	const Process = await run_fixture('process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(JSON.stringify({type:"result",subtype:"error_max_turns",is_error:true,result:"first half proof",usage:{output_tokens:9}})));');
	const Result = agent_result("claude", Process); assert.equal(Result.Status, "partial"); assert.equal(Result.Text, "first half proof"); assert.equal(Result.Metadata.Usage?.[0].OutputTokens, 9);
});

test("after-submit timeout/output overflow/invalid UTF8 never become a confirmed failure or cancellation", async () =>
{
	for(const [Script, Options] of [
		['process.stdin.resume(); process.stdin.on("end", () => setInterval(() => {}, 1000));', { RunTimeoutMs: 100 }],
		['process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("X".repeat(300)));', { MaxOutputBytes: 100 }],
		['process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(Buffer.from([255])));', {}]
	] as const)
	{
		const Process = await run_fixture(Script, Options); assert.equal(Process.Submitted, true);
		assert.equal(agent_result("claude", Process).Status, "unknown");
	}
});

test("abort before launch never creates a child; abort after delivery only stops local waiting", async () =>
{
	const Before = new AbortController(); Before.abort();
	const None = await run_fixture('throw Error("must not run");', {}, Before.signal);
	assert.equal(None.Submitted, false); assert.equal(agent_result("claude", None).Status, "cancelled");
	const After = new AbortController();
	const Process = await run_fixture('process.stdin.resume(); process.stdin.on("end", () => setInterval(() => {}, 1000));', { OnMetadata: M => { if(M.Submission === "submitted") { setTimeout(() => After.abort(), 30); } } }, After.signal);
	assert.equal(Process.Submitted, true); assert.equal(agent_result("claude", Process).Status, "unknown");
	assert.equal(agent_result("claude", Process).Metadata.Wait, "stopped");
});

test("DSH explicit status/final is decoded while truncated trailing diagnostics cannot manufacture success", () =>
{
	const Base: HiddenProcessResult = { Output: '', Submitted: true, ExitCode: 0, Stopped: false };
	const Completed = agent_result("dsh", { ...Base, Output: '{"type":"status","phase":"turn_end","reason":{"kind":"completed"}}\n{"type":"final","text":"finite proof"}\n{"truncated"' });
	assert.equal(Completed.Status, "completed"); assert.equal(Completed.Text, "finite proof");
	const Unknown = agent_result("dsh", { ...Base, Output: '{"type":"final","text":"first half"}' }); assert.equal(Unknown.Status, "unknown"); assert.equal(Unknown.Text, "first half");
});

test("native post-submit stop releases frontend before owned child teardown completes", async () =>
{
	const Abort = new AbortController(); let ChildFinished = false;
	const Result = await backend_generate(async Input =>
	{
		const Process = await run_fixture('process.stdin.resume(); process.stdin.on("end", () => setInterval(() => {}, 1000));', {
			OnMetadata: M => { Input.OnMetadata?.(M); if(M.Submission === "submitted") { setTimeout(() => Abort.abort(), 20); } }
		}, Abort.signal);
		ChildFinished = true; return agent_result("claude", Process);
	}, { Session: "owned-session", Messages: [{ Role: "user", Text: "synthetic proof" }] }, Abort.signal);
	assert.equal(Result.Status, "unknown"); assert.equal(Result.Metadata.Wait, "stopped");
	assert.equal(ChildFinished, false);
	for(let I = 0; I < 200 && !ChildFinished; I++) { await new Promise(R => setTimeout(R, 10)); }
	assert.equal(ChildFinished, true);
});
