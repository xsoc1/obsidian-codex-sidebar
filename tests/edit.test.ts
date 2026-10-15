import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatEdits } from "../src/edit/controller";
import { EditStore } from "../src/edit/store";
import { bind_edit, edit_intent, parse_edit, safe_edit_markdown } from "../src/edit/protocol";
import { task_prompt } from "../src/study/task";
import { version_of } from "../src/study/document";
import type { ContextSnapshot } from "../src/prompt";

const Before = "# 原笔记\n\n保留前文.\n\n证明: $1+1=3$.\n\n保留后文和留白.\n";
const Old = "证明: $1+1=3$.", New = "证明: $1+1=2$.";
const Output = { schemaVersion: 1, kind: "note-edit", status: "proposal", markdown: New, rationale: "仅修正加法结果, 保留原句和路线." };
async function fixture(Local = new Map<string, string>())
{
	const Store = new EditStore({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => Local.set(Key, Value) }, "test");
	const Files = new Map([["original.md", Before]]), Sent: any[] = [], Writes: any[] = [];
	let Protected = false;
	const From = Before.indexOf(Old);
	const Source: ContextSnapshot = { Path: "original.md", Mode: "编辑", Kind: "选区", Mapping: "源文本", Text: Before, SelectedText: Old, Selection: { From, To: From + Old.length }, LineStart: 0, LineEnd: 6, Heading: "证明", CapturedAt: "original-time", Truncated: false, Version: await version_of(Before) };
	const Host = { read_current: async (Path: string) => Files.get(Path) ?? null, compare_write: async (Path: string, Current: string | null, After: string) => { assert.equal(Files.get(Path) ?? null, Current); Writes.push(Path); Files.set(Path, After); }, protected_source: () => Protected, send: async (Task: any) => { Sent.push(Task); return true; }, changed: () => {} };
	return { Store, Files, Source, Host, Sent, Writes, Local, Controller: new ChatEdits(Store, Host), protect: () => Protected = true };
}

test("ordinary edit requests bind a host range, keep original context and stay inert until confirmation; restart, double click and safe undo work", async () =>
{
	const F = await fixture(); assert.equal(edit_intent("请修改这段证明, 最小改动"), true);
	assert.equal(edit_intent("不要修改, 只解释哪里错了"), false); assert.equal(edit_intent("如何修改我的证明?"), false);
	await F.Controller.request("请修改这段证明", F.Source, "captured", "auto");
	const Task = F.Sent[0]; assert.equal(Task.Role, "complete-answer"); assert.equal(Task.Source.Text, Before);
	assert.equal(Task.WriteUnit.Text, Old); assert.equal(Task.Source.CapturedAt, "original-time");
	assert.equal(JSON.parse(task_prompt(Task).split("任务:\n")[1]).Target.Before, null);
	await F.Controller.accept_result(Task.Id, JSON.stringify(Output), true);
	assert.equal(F.Writes.length, 0); assert.equal(F.Files.get("original.md"), Before);
	const Restart = await fixture(F.Local); const Plan = Restart.Store.Data.Writes[0];
	await Promise.all([Restart.Controller.Writer.confirm(Plan.Id), Restart.Controller.Writer.confirm(Plan.Id)]);
	assert.equal(Restart.Writes.length, 1); assert.equal(Restart.Files.get("original.md"), Before.replace(Old, New));
	await Restart.Controller.Writer.undo(Plan.Id); assert.equal(Restart.Files.get("original.md"), Before);
});

test("read-only, ambiguous, truncated and changed sources refuse binding; full-note scope requires explicit selection", async () =>
{
	const F = await fixture();
	for(const Source of [{ ...F.Source, Truncated: true }, { ...F.Source, Version: undefined }, { ...F.Source, Selection: undefined, Mapping: "渲染文本" as const }, { ...F.Source, Selection: { From: 0, To: Old.length } }, { ...F.Source, Path: "../outside.md" }, { ...F.Source, Path: "book.pdf" }]) { await assert.rejects(bind_edit(F.Host, Source, "captured")); }
	for(const Role of ["source-excerpt", "teacher-problem"] as const) { await assert.rejects(F.Controller.request("修改", F.Source, "captured", Role), /只读/); }
	F.protect(); await assert.rejects(F.Controller.request("修改", F.Source, "captured", "note"), /只读/);
	const Whole = await bind_edit(F.Host, F.Source, "note", "note"); assert.equal(Whole.Target.Range!.From, 0); assert.equal(Whole.Source.Text, Before);
});

test("model output has no paths or executable operations; major rewrites require a decision and interrupted outputs cannot become write plans", async () =>
{
	const F = await fixture(); await F.Controller.request("修正", F.Source, "captured", "complete-answer");
	const Task = F.Sent[0];
	for(const Value of [{ ...Output, path: "other.md" }, { ...Output, shell: "run" }, { ...Output, status: "apply" }, { ...Output, markdown: "```dataviewjs\nrun()\n```" }, { ...Output, markdown: "<script>run()</script>" }, { ...Output, status: "needs-decision" }]) { assert.throws(() => parse_edit(JSON.stringify(Value))); }
	assert.equal(safe_edit_markdown("```js\nconst x = 1;\n```"), true);
	await assert.rejects(F.Controller.accept_result(Task.Id, JSON.stringify(Output), false), /中断/); assert.equal(F.Store.Data.Writes.length, 0);
	await F.Controller.accept_result(Task.Id, JSON.stringify({ ...Output, status: "needs-decision", markdown: null }), true);
	assert.equal(F.Store.Data.Writes.length, 0); assert.equal(F.Files.get("original.md"), Before);
});

test("snapshot replay stays on original range and timestamp; missing device records and stale or post-write edits refuse writes", async () =>
{
	const F = await fixture(); await F.Controller.request("修改", F.Source, "captured", "auto"); const Task = F.Sent[0];
	const Replay = F.Controller.replay(Task, "改正这行"); assert.notEqual(Replay.Id, Task.Id); assert.equal(Replay.Source!.CapturedAt, "original-time"); assert.deepEqual(Replay.Target, Task.Target);
	const Other = await fixture(); assert.throws(() => Other.Controller.replay(Task), /本设备/);
	await F.Controller.accept_result(Task.Id, JSON.stringify(Output), true); const Plan = F.Store.Data.Writes[0];
	F.Files.set("original.md", Before + "后续编辑"); await assert.rejects(F.Controller.Writer.confirm(Plan.Id), /陈旧/); assert.equal(F.Writes.length, 0);
	const G = await fixture(); await G.Controller.request("修改", G.Source, "captured", "note"); await G.Controller.accept_result(G.Sent[0].Id, JSON.stringify(Output), true);
	const P = G.Store.Data.Writes[0]; await G.Controller.Writer.confirm(P.Id); G.Files.set("original.md", G.Files.get("original.md") + "后续编辑"); await assert.rejects(G.Controller.Writer.undo(P.Id), /安全撤销/);
});

test("clearing or cancelling rejects late output and local store failures cannot advance the write journal", async () =>
{
	const F = await fixture(); await F.Controller.request("修改", F.Source, "captured", "note"); const Task = F.Sent[0];
	F.Controller.cancel(Task.Id); await F.Controller.accept_result(Task.Id, JSON.stringify(Output), true); assert.equal(F.Store.Data.Writes.length, 0);
	F.Store.clear(); assert.equal(F.Store.Data.Records.length, 0); assert.equal(F.Writes.length, 0);
	const Storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } }, Store = new EditStore(Storage, "quota");
	assert.throws(() => Store.change(Data => Data.DeviceId = "changed"), /quota/); assert.notEqual(Store.Data.DeviceId, "changed");
});

test("clear during source validation cannot revive a task; read-only changes are checked again at confirmation", async () =>
{
	const F = await fixture(); let Release!: (Value: string) => void;
	F.Host.read_current = () => new Promise<string>(Resolve => Release = Resolve);
	const Pending = F.Controller.request("修改", F.Source, "captured", "note"); F.Controller.clear(); Release(Before);
	await assert.rejects(Pending, /已清除/); assert.equal(F.Sent.length, 0);
	const G = await fixture(); await G.Controller.request("修正", G.Source, "captured", "note"); await G.Controller.accept_result(G.Sent[0].Id, JSON.stringify(Output), true);
	G.protect(); await assert.rejects(G.Controller.confirm(G.Store.Data.Writes[0].Id), /只读/); assert.equal(G.Writes.length, 0);
});

test("reading blocks have honest whole-block replacements, deletion is bounded, and pending writes recover without duplication", async () =>
{
	const F = await fixture(); const Source: ContextSnapshot = { ...F.Source, Selection: undefined, Mode: "阅读", Mapping: "源块", Text: Old, SelectedText: "1+1", LineStart: 4, LineEnd: 4 };
	await F.Controller.request("删除这一段", Source, "captured", "note");
	assert.equal(F.Sent[0].WriteUnit.Text, Old);
	await F.Controller.accept_result(F.Sent[0].Id, JSON.stringify({ ...Output, markdown: "" }), true);
	const Plan = F.Store.Data.Writes[0];
	F.Store.change(Data => Data.Writes[0].State = "pending");
	F.Files.set("original.md", Plan.After); await F.Controller.confirm(Plan.Id);
	assert.equal(F.Writes.length, 0); assert.equal(F.Store.Data.Writes[0].State, "applied");
	assert.equal(F.Files.get("original.md"), Before.replace(Old, ""));
	const Original = F.Store.export_records(); const Broken = JSON.parse(Original); Broken.Writes[0].After += "unauthorized";
	const Raw = JSON.stringify(Broken), Storage = { getItem: () => Raw, setItem: () => { throw new Error("must not migrate"); } };
	assert.throws(() => new EditStore(Storage, "test"), /不一致/); assert.equal(Storage.getItem(), Raw);
});
