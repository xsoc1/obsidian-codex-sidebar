import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatEdits } from "../src/edit/controller";
import { EditStore } from "../src/edit/store";
import { bind_edit, parse_edit, safe_edit_markdown } from "../src/edit/protocol";
import { task_prompt } from "../src/study/task";
import { version_of } from "../src/study/document";
import type { ContextSnapshot } from "../src/prompt";
import { search_window } from "../src/edit/range";

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

test("automatic role inference is model-owned, persisted on replay, and distinct from older explicit role records", async () =>
{
	const F = await fixture(); await F.Controller.request("生成修改预览", F.Source, "captured", "auto");
	const Task = F.Sent[0]; assert.equal(Task.Role, "note"); assert.equal(Task.EditRoleMode, "auto");
	assert.match(task_prompt(Task), /不依赖标题关键词/); assert.match(task_prompt(Task), /完整答案最小修补/); assert.match(task_prompt(Task), /思路稿严格沿原路线/);
	const Restart = await fixture(F.Local), Replay = Restart.Controller.replay(Task);
	assert.equal(Replay.EditRoleMode, "auto"); assert.deepEqual(Replay.Source, Task.Source);
	assert.throws(() => F.Store.change(Data => (Data.Records[0].Spec as any).EditRoleMode = "teacher"), /辨识方式/);
	const G = await fixture(); await G.Controller.request("修改完整答案", G.Source, "captured", "complete-answer");
	assert.equal(G.Sent[0].EditRoleMode, undefined); assert.equal(G.Sent[0].Role, "complete-answer");
	assert.ok(!task_prompt(G.Sent[0]).includes("不依赖标题关键词"));
});

test("ordinary edit requests bind a host range, keep original context and stay inert until confirmation; restart, double click and safe undo work", async () =>
{
	const F = await fixture();
	await F.Controller.request("请修改这段证明", F.Source, "captured", "auto");
	const Task = F.Sent[0]; assert.equal(Task.Role, "note"); assert.equal(Task.EditRoleMode, "auto"); assert.match(task_prompt(Task), /原文类型由你.*自行辨识/); assert.equal(Task.Source.Text, Before);
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

test("AI selects a unique smaller range beyond the original selection, preserving snapshot and all outside text", async () =>
{
	const F = await fixture(); await F.Controller.request("修正本笔记中的加法错误, 由你选范围", { ...F.Source, SelectedText: "保留前文.", Selection: { From: Before.indexOf("保留前文."), To: Before.indexOf("保留前文.") + "保留前文.".length } }, "ai", "note");
	const Task = F.Sent[0]; assert.equal(Task.EditMode, "ai"); assert.equal(Task.WriteUnit.Text, Before);
	F.Controller.Error = "上一轮的定位错误";
	assert.equal(Task.Source.SelectedText, "保留前文."); assert.equal(JSON.parse(task_prompt(Task).split("任务:\n")[1]).Target.Before, null);
	await F.Controller.accept_result(Task.Id, JSON.stringify({ ...Output, original: Old }), true);
	assert.equal(F.Controller.Error, "");
	const Plan = F.Store.Data.Writes[0]; assert.equal(Plan.Target.Range!.From, Before.indexOf(Old)); assert.equal(Plan.Target.Range!.To, Before.indexOf(Old) + Old.length);
	assert.equal(F.Writes.length, 0); await F.Controller.confirm(Plan.Id); assert.equal(F.Files.get("original.md"), Before.replace(Old, New));
	await F.Controller.undo(Plan.Id); assert.equal(F.Files.get("original.md"), Before);
	const Restart = await fixture(F.Local), Replay = Restart.Controller.replay(Task); assert.equal(Replay.EditMode, "ai"); assert.deepEqual(Replay.WriteUnit, Task.WriteUnit);
});

test("AI range rejects missing or duplicated originals, out-of-window text, readonly resolved ranges and unknown output mode", async () =>
{
	for(const Original of [undefined, "not-in-note", ""]) { const F = await fixture(); await F.Controller.request("修改", F.Source, "ai", "note"); await assert.rejects(F.Controller.accept_result(F.Sent[0].Id, JSON.stringify({ ...Output, ...(Original === undefined ? {} : { original: Original }) }), true)); assert.equal(F.Writes.length, 0); }
	const F = await fixture(); F.Files.set("original.md", Before + Old);
	const Source = { ...F.Source, Version: await version_of(Before + Old) };
	await F.Controller.request("修正", Source, "ai", "note"); await assert.rejects(F.Controller.accept_result(F.Sent[0].Id, JSON.stringify({ ...Output, original: Old }), true), /不唯一/);
	const G = await fixture(); await G.Controller.request("修正", G.Source, "ai", "note"); G.protect(); await assert.rejects(G.Controller.accept_result(G.Sent[0].Id, JSON.stringify({ ...Output, original: Old }), true), /只读/);
	const H = await fixture(); await H.Controller.request("修正", H.Source, "captured", "note"); await assert.rejects(H.Controller.accept_result(H.Sent[0].Id, JSON.stringify({ ...Output, original: Old }), true), /模式/);
	const Text = ("outside\n".repeat(5000)) + Old + "\n" + ("tail\n".repeat(5000)); const From = Text.indexOf(Old), Range = search_window(Text, { From, To: From + Old.length });
	assert.ok(Range.To - Range.From <= 24000 && Range.From <= From && Range.To >= From + Old.length);
	assert.ok(Range.From > 0 && Range.To < Text.length);
});

test("v1 records migrate into v2 without overwriting the old store, and resolved-plan tampering is rejected", async () =>
{
	const F = await fixture(); await F.Controller.request("修正", F.Source, "captured", "note"); await F.Controller.accept_result(F.Sent[0].Id, JSON.stringify(Output), true);
	const OldData = { ...structuredClone(F.Store.Data), schemaVersion: 1 }, Raw = JSON.stringify(OldData), Local = new Map([["codex-sidebar-edits:v1:test", Raw]]);
	const G = await fixture(Local); assert.equal(G.Store.Data.schemaVersion, 2); assert.deepEqual(G.Store.Data.Records, F.Store.Data.Records); assert.equal(Local.get("codex-sidebar-edits:v1:test"), Raw);
	const Invalid = structuredClone(OldData); Invalid.Records[0].Spec.EditRoleMode = "auto";
	const InvalidRaw = JSON.stringify(Invalid), InvalidLocal = new Map([["codex-sidebar-edits:v1:test", InvalidRaw]]);
	await assert.rejects(fixture(InvalidLocal), /旧版修改记录损坏/); assert.equal(InvalidLocal.get("codex-sidebar-edits:v1:test"), InvalidRaw); assert.ok(!InvalidLocal.has("codex-sidebar-edits:v2:test"));
	await G.Controller.confirm(G.Store.Data.Writes[0].Id); assert.ok(Local.has("codex-sidebar-edits:v2:test")); assert.equal(Local.get("codex-sidebar-edits:v1:test"), Raw);
	G.Controller.clear(); assert.equal(Local.get("codex-sidebar-edits:v1:test"), ""); assert.equal(G.Store.Data.Records.length, 0);
	const H = await fixture(); await H.Controller.request("修改", H.Source, "ai", "note"); await H.Controller.accept_result(H.Sent[0].Id, JSON.stringify({ ...Output, original: Old }), true);
	assert.throws(() => H.Store.change(Data => Data.Writes[0].Target.Range!.From = 0), /损坏/); assert.equal(H.Writes.length, 0);
});

test("AI context window is bounded and a readonly neighbour cannot become the resolved target", async () =>
{
	const F = await fixture();
	const C = new ChatEdits(F.Store, { ...F.Host, protected_source: Task => Task.Target!.Range!.From < Before.indexOf(Old) });
	await C.request("修正", F.Source, "ai", "note"); await C.accept_result(F.Sent[0].Id, JSON.stringify({ ...Output, original: Old }), true);
	await C.confirm(F.Store.Data.Writes[0].Id); assert.equal(F.Writes.length, 1);
	const G = await fixture(), Big = "unique-first\n" + "ordinary\n".repeat(4000) + Old + "\n" + "tail\n".repeat(4000), From = Big.indexOf(Old);
	G.Files.set("original.md", Big);
	const Source = { ...G.Source, Text: Old, Selection: { From, To: From + Old.length }, Version: await version_of(Big) };
	await G.Controller.request("修改", Source, "ai", "note");
	assert.equal(G.Sent[0].WriteUnit.Truncated, true); assert.ok(G.Sent[0].WriteUnit.Text.length <= 24000);
	await assert.rejects(G.Controller.accept_result(G.Sent[0].Id, JSON.stringify({ ...Output, original: "unique-first" }), true), /不在本轮/);
	assert.equal(G.Writes.length, 0);
});
