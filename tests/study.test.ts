import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StudyStore } from "../src/study/store";
import { StudyController } from "../src/study/controller";
import { bind_target, plan_write } from "../src/study/writer";
import { make_task, task_prompt } from "../src/study/task";
import { parse_output } from "../src/study/schema";
import { note_path, version_of, unit_range } from "../src/study/document";
import { parse_manifest, prerequisite_excerpt } from "../src/study/manifest";
import { exercise_markdown, latex_source, reading_markdown } from "../src/study/export";
import { branch_prefix, history_items, type ChatMessage } from "../src/history";
import type { ContextSnapshot } from "../src/prompt";
import { InlineCompletions, SuggestionField, SetSuggestion } from "../src/inline";
import { EditorState } from "@codemirror/state";
import { question_label, structured_task } from "../src/study/presentation";

const Original = "# 单元\n\n完整正文 $[h,e]=2e$.\n\n^unit-one\n\n# 后续\n\n保留后续内容.";
const Source: ContextSnapshot = { Path: "lecture.md", Mode: "阅读", Kind: "选区", Mapping: "源块", Text: "$[h,e]=2e$", SelectedText: "公式渲染文本", Heading: "单元", LineStart: 2, LineEnd: 2, CapturedAt: "2026-10-14T00:00:00Z", Truncated: true };
const Exercise = { schemaVersion: 1, kind: "calculation", statement: "计算 $[h,2e]$.", hints: ["先用双线性", "代入 $[h,e]=2e$"], solution: "$4e$", verification: "unverified" };
const Draft = { schemaVersion: 1, markdown: "# 完整样章\n\n定义、首次计算与完整证明.\n\n$$\nx=1\n$$", rationale: "原创样本的完整单元", verification: "unverified" } as const;
function fixture(Local = new Map<string, string>())
{
	const Store = new StudyStore({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => Local.set(Key, Value) }, "test");
	const Files = new Map([["lecture.md", Original]]);
	const Sent: any[] = []; const Pauses: boolean[] = []; const Changes: string[] = [];
	const Controller = new StudyController(Store, {
		read_current: async Path => Files.get(Path) ?? null,
		compare_write: async (Path, Before, After) =>
		{
			assert.equal(Files.get(Path) ?? null, Before);
			Changes.push(Path); Files.set(Path, After);
		},
		send_task: async Task => { Sent.push(structuredClone(Task)); return true; },
		changed: () => {}, suppress_completion: Paused => Pauses.push(Paused)
	});
	return { Store, Files, Sent, Pauses, Changes, Controller, Local };
}

test("old notes: pinned source, explanation, one exercise, attempt, graded hints, alternative feedback and restart preserve data without note writes", async () =>
{
	const F = fixture(); F.Store.change(Data => Data.Pinned = structuredClone(Source));
	const Explain = make_task("explain", F.Store.Data.Pinned, "直接解释"); await F.Controller.send(Explain);
	await F.Controller.accept_result(Explain, "交换子是两个次序之差 $XY-YX$.", true);
	const Task = make_task("exercise", F.Store.Data.Pinned, "相近练习"); Task.SourceVersion = await version_of(Original);
	await F.Controller.send(Task); await F.Controller.accept_result(Task, JSON.stringify(Exercise), true);
	F.Controller.hint(); F.Controller.hint(); F.Controller.hint();
	assert.equal(F.Controller.Exercise!.HintUses.length, 2);
	F.Controller.reveal(); await F.Controller.attempt("我直接乘两次矩阵, 相减得到 $4e$.");
	const Feedback = F.Sent.at(-1); await F.Controller.accept_result(Feedback, JSON.stringify({ schemaVersion: 1, verdict: "correct", explanation: "直接矩阵乘法与双线性计算等价, 此解法正确." }), true);
	assert.equal(F.Controller.Exercise!.Attempts[0].Feedback!.verdict, "correct");
	assert.equal(F.Controller.Exercise!.Reveals.length, 1);
	assert.equal(F.Changes.length, 0); assert.equal(F.Files.get("lecture.md"), Original);
	const Restart = fixture(F.Local);
	assert.deepEqual(Restart.Store.Data, F.Store.Data);
	assert.equal(Restart.Store.Data.Pinned!.Text, Source.Text); assert.equal(Restart.Store.Data.Pinned!.Truncated, true);
	F.Files.set("lecture.md", Original + "\n用户更新"); await F.Controller.check_versions();
	assert.equal(F.Controller.Exercise!.Stale, true); assert.equal(F.Controller.Exercise!.Attempts.length, 1);
	assert.ok(!F.Store.export_records().includes("mastery"));
});

test("task snapshots survive replay and edit-resend without current focus, and complete target baseline stays out of model prompt", async () =>
{
	const F = fixture(); const Task = make_task("proposal", Source, "补充一步");
	Task.Target = await bind_target(F.Controller.Host, "lecture.md", "insert-after", "unit-one");
	const Prompt = task_prompt(Task); assert.ok(!Prompt.includes("保留后续内容")); assert.ok(Prompt.includes("源块") && Prompt.includes("Truncated"));
	const Messages: ChatMessage[] = [{ Id: "u", Role: "user", Text: "补充一步", Context: Source, Task, Prompt }, { Id: "a", Role: "assistant", Text: "旧回答" }, { Id: "v", Role: "user", Text: "新问题", Context: { ...Source, Path: "new.md" } }];
	assert.equal((history_items(Messages)[0].content[0] as any).text, Prompt);
	const Branch = branch_prefix(Messages, "v"); Branch[0].Task!.Source!.Text = "changed";
	assert.equal(Messages[0].Task!.Source!.Text, Source.Text);
});

test("runtime schemas reject executable definitions, unknown operations, malformed math JSON and interrupted output; valid shape is always unverified", async () =>
{
	assert.throws(() => parse_output("exercise", JSON.stringify({ ...Exercise, execute: "JS" })));
	assert.throws(() => parse_output("proposal", JSON.stringify({ ...Draft, operation: "delete" })));
	assert.throws(() => parse_output("sample", JSON.stringify({ ...Draft, path: "evil.md" })));
	assert.throws(() => parse_output("sample", JSON.stringify({ ...Draft, markdown: "# 单元\n```dataviewjs\napp.vault.modify(file, text)\n```" })), /不接受/);
	assert.throws(() => parse_output("sample", JSON.stringify({ ...Draft, markdown: '<script>run()</script>' })), /不接受/);
	assert.throws(() => parse_output("exercise", '{"statement":"$\\alpha$"}'));
	assert.throws(() => parse_output("exercise", JSON.stringify({ ...Exercise, verification: "proved" })));
	assert.throws(() => parse_output("exercise", JSON.stringify({ ...Exercise, statement: "题目\\n$\\\\mathbb C$" })), /双重转义/);
	const F = fixture(); const Task = make_task("sample", Source, "样章"); await F.Controller.send(Task);
	await assert.rejects(F.Controller.accept_result(Task, JSON.stringify(Draft), false), /中断/);
	assert.equal(F.Store.Data.Writes.length, 0);
});

test("assistant commentary is retained but cannot contaminate final structured output, including recovered turns", async () =>
{
	const F = fixture(); const Task = make_task("exercise", Source, "练习"); F.Controller.register_task(Task);
	F.Controller.consume([
		{ Id: "user", Role: "user", Text: "练习", Task, TurnId: "turn" },
		{ Id: "comment", Role: "assistant", Phase: "commentary", TurnId: "turn", Text: "我会加载技能", CompletionStatus: "completed" },
		{ Id: "final", Role: "assistant", Phase: "final_answer", TurnId: "turn", Text: JSON.stringify(Exercise), CompletionStatus: "completed" }
	]);
	await new Promise(Resolve => setTimeout(Resolve, 20));
	assert.equal(F.Store.Data.Tasks[0].Status, "complete"); assert.equal(F.Store.Data.Exercises.length, 1);
	F.Controller.consume([{ Id: "user", Role: "user", Text: "练习", Task, TurnId: "turn" }, { Id: "final", Role: "assistant", TurnId: "turn", Text: JSON.stringify(Exercise), CompletionStatus: "completed" }]);
	assert.equal(F.Store.Data.Exercises.length, 1);
});

test("requesting a missing solution starts an explicit skilled task instead of forcing hints", async () =>
{
	const F = fixture(); const Task = make_task("exercise", Source, "临时练习"); F.Controller.register_task(Task);
	await F.Controller.accept_result(Task, JSON.stringify({ ...Exercise, solution: null }), true);
	await F.Controller.reveal(); assert.equal(F.Sent.at(-1).Action, "solution");
	await F.Controller.accept_result(F.Sent.at(-1), JSON.stringify({ schemaVersion: 1, solution: "$4e$", verification: "unverified" }), true);
	assert.equal(F.Controller.Exercise!.Content.solution, "$4e$"); assert.equal(F.Controller.Exercise!.Reveals.length, 1);
});

test("practice answers are not leaked by ordinary chat display and edited feedback creates a separate attempt", async () =>
{
	const F = fixture(); const Task = make_task("exercise", Source, "练习"); F.Controller.register_task(Task);
	await F.Controller.accept_result(Task, JSON.stringify(Exercise), true); await F.Controller.attempt("我的第一种解法");
	const Feedback = F.Sent.at(-1);
	assert.equal(question_label(Feedback), "我的第一种解法"); assert.ok(!question_label(Feedback).includes(Exercise.solution));
	const Replay = F.Controller.replay_task(Feedback, "改过的第二种解法");
	assert.notEqual(Replay.AttemptId, Feedback.AttemptId); assert.equal(F.Controller.Exercise!.Attempts.length, 2); assert.equal(F.Controller.Exercise!.Attempts[0].Text, "我的第一种解法");
	const Replies: ChatMessage[] = [{ Id: "u", Role: "user", TurnId: "t", Task, Text: "练习" }, { Id: "a", Role: "assistant", TurnId: "t", Phase: "final_answer", Text: JSON.stringify(Exercise) }];
	assert.equal(structured_task(Replies, Replies[1])!.Action, "exercise");
	F.Controller.reveal_raw(Task); assert.equal(F.Controller.Exercise!.Reveals.length, 1); assert.equal(F.Controller.Exercise!.HintUses.length, 2);
	assert.equal(structured_task(Replies, { Id: "old", Role: "assistant", Text: "原始 Markdown" }), null);
});

test("sample preview is inert, confirm creates once, pending restart recovers and later edits reject undo", async () =>
{
	const F = fixture(); const Task = make_task("sample", Source, "完整新稿"); Task.Target = await bind_target(F.Controller.Host, "new.md", "create", null);
	await F.Controller.send(Task); await F.Controller.accept_result(Task, JSON.stringify(Draft), true);
	const Plan = F.Store.Data.Writes[0]; assert.equal(F.Changes.length, 0); assert.equal(F.Files.has("new.md"), false);
	await Promise.all([F.Controller.Writer.confirm(Plan.Id), F.Controller.Writer.confirm(Plan.Id)]);
	assert.equal(F.Changes.length, 1); assert.ok(F.Files.get("new.md")!.includes("^study-unit-"));
	const Again = new StudyController(F.Store, F.Controller.Host); await Again.Writer.confirm(Plan.Id); assert.equal(F.Changes.length, 1);
	F.Store.change(Data => Data.Writes[0].State = "pending"); await Again.Writer.confirm(Plan.Id); assert.equal(F.Changes.length, 1);
	await assert.rejects(Again.Writer.undo(Plan.Id), /新建文件保留/);
});

test("host-bound unit insertion/replacement: stale rejection, zero pre-confirm writes, safe undo, and later editing conflicts", async () =>
{
	const F = fixture(); const Task = make_task("proposal", Source, "补充"); Task.Target = await bind_target(F.Controller.Host, "lecture.md", "insert-after", "unit-one");
	const Plan = plan_write(Task, { ...Draft, operation: "insert-after" } as any);
	F.Store.change(Data => Data.Writes.push(Plan)); F.Files.set("lecture.md", Original + "\n新的编辑");
	await assert.rejects(F.Controller.Writer.confirm(Plan.Id), /陈旧/); assert.equal(F.Changes.length, 0);
	F.Files.set("lecture.md", Original); const Replacement = make_task("proposal", Source, "替换单元"); Replacement.Target = await bind_target(F.Controller.Host, "lecture.md", "replace-unit", "unit-one");
	const Plan2 = plan_write(Replacement, { ...Draft, operation: "replace-unit" } as any); F.Store.change(Data => Data.Writes.push(Plan2));
	await F.Controller.Writer.confirm(Plan2.Id); assert.ok(F.Files.get("lecture.md")!.endsWith("保留后续内容."));
	await F.Controller.Writer.undo(Plan2.Id); assert.equal(F.Files.get("lecture.md"), Original);
	const Plan3 = plan_write(Replacement, { ...Draft, operation: "replace-unit" } as any); F.Store.change(Data => Data.Writes.push(Plan3));
	await F.Controller.Writer.confirm(Plan3.Id); F.Files.set("lecture.md", Plan3.After + "\n后续编辑");
	await assert.rejects(F.Controller.Writer.undo(Plan3.Id), /其他编辑/); assert.equal(F.Files.get("lecture.md"), Plan3.After + "\n后续编辑");
	assert.throws(() => plan_write({ ...Replacement, Role: "teacher-problem" }, Draft), /没有讲义/);
	const NewFromSource = make_task("sample", Source, "明确新写讲义", "source-excerpt"); NewFromSource.Target = await bind_target(F.Controller.Host, "new-from-source.md", "create", null);
	assert.equal(plan_write(NewFromSource, Draft).Target.Operation, "create");
});

test("path, ambiguous units and duplicate anchors are refused before any write", async () =>
{
	for(const Path of ["../x.md", "/x.md", "C:/x.md", "x\\x.md", ".obsidian/x.md", "a/../x.md", "a/.hidden.md", "x.md ", "x.md/../y.md"])
	{
		assert.throws(() => note_path(Path));
	}
	assert.throws(() => unit_range(Original + "\n^unit-one", "unit-one"), /重复/);
	assert.throws(() => unit_range("# section\n\n^target\n\nremaining text", "target"), /模糊/);
	assert.doesNotThrow(() => unit_range("# section\n\n^other\n\ntext\n\n^target", "target"));
	assert.throws(() => unit_range("# section\n```\n^target\n```", "target"), /不存在/);
	assert.throws(() => unit_range("no heading\n\n^id", "id"), /标题/);
});

test("answer focus aborts in-flight completion, clears ghost, leaves the user's completion preference and native Tab alone", () =>
{
	let Paused = false; const Preference = true;
	const Inline = new InlineCompletions({ Enabled: () => Preference && !Paused, Delay: () => 1000, Path: () => "lecture.md", Request: async () => "test", Status: () => {}, Changed: () => {} });
	let State = EditorState.create({ doc: "abc", selection: { anchor: 3 }, extensions: [SuggestionField] }); State = State.update({ effects: SetSuggestion.of({ Position: 3, Text: "ghost" }) }).state;
	const View: any = { get state() { return State; }, dispatch: (Spec: any) => { State = State.update(Spec).state; }, hasFocus: true, dom: { isConnected: true } };
	const Abort = new AbortController(); (Inline as any).Views.set(View, { Version: 0, Abort, OfferPath: "lecture.md" });
	const F = fixture(); F.Controller.Host.suppress_completion = Value => { Paused = Value; if(Value) { Inline.clear(); } };
	F.Controller.answer_focus(true); assert.equal(Abort.signal.aborted, true); assert.equal(State.field(SuggestionField), null); assert.equal(Inline.request(View), false);
	F.Controller.answer_focus(false); assert.equal(Paused, false); assert.equal(Preference, true);
	assert.ok(!readFileSync("src/inline.ts", "utf8").includes('key: "Tab"'));
});

test("device-local records are not remote chat state, unknown schemas preserve raw data and clear rejects late results", async () =>
{
	const A = fixture(); const B = fixture(); assert.notEqual(A.Store.Data.DeviceId, B.Store.Data.DeviceId);
	const Task = make_task("exercise", Source, "练习"); await A.Controller.send(Task); A.Store.clear_records();
	await A.Controller.accept_result(Task, JSON.stringify(Exercise), true); assert.equal(A.Store.Data.Exercises.length, 0); assert.equal(B.Store.Data.Tasks.length, 0);
	const Local = new Map([[A.Store.Key, '{"SchemaVersion":99}']]); assert.throws(() => fixture(Local), /不支持/); assert.equal(Local.get(A.Store.Key), '{"SchemaVersion":99}');
	const Old = new Map([[A.Store.Key, '{"SchemaVersion":0,"DeviceId":"old-device","Exercises":[]}']]); assert.equal(fixture(Old).Store.Data.DeviceId, "old-device");
});

test("clearing records during asynchronous source validation cannot revive a late exercise", async () =>
{
	const F = fixture(); const Task = make_task("exercise", Source, "练习"); F.Controller.register_task(Task);
	let Release: (Value: string) => void = () => {};
	F.Controller.Host.read_current = () => new Promise(Resolve => { Release = Resolve; });
	const Pending = F.Controller.accept_result(Task, JSON.stringify(Exercise), true);
	F.Store.clear_records(); Release(Original); await Pending;
	assert.equal(F.Store.Data.Tasks.length, 0); assert.equal(F.Store.Data.Exercises.length, 0);
});

test("local storage failures preserve prior data and clearing an in-flight write preserves its journal", async () =>
{
	let Fail = false; const Local = new Map<string, string>();
	const Store = new StudyStore({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => { if(Fail) { throw new Error("quota"); } Local.set(Key, Value); } }, "quota-test");
	Store.change(Data => Data.Mode = "exercise"); const Before = Store.export_records(); Fail = true;
	assert.throws(() => Store.change(Data => Data.Mode = "writing"), /quota/); assert.equal(Store.export_records(), Before);
	const F = fixture(); const Task = make_task("sample", Source, "新稿"); Task.Target = await bind_target(F.Controller.Host, "new.md", "create", null); const Plan = plan_write(Task, Draft);
	F.Store.change(Data => Data.Writes.push({ ...Plan, State: "pending" }));
	assert.throws(() => F.Store.clear_records(), /尚未完成/); assert.equal(F.Store.Data.Writes.length, 1);
});

test("original course manifest, bounded direct prerequisites and portable Markdown/LaTeX preserve full definitions and calculations", () =>
{
	const Manifest = parse_manifest(readFileSync("examples/study/demo.study.json", "utf8")); assert.equal(Manifest.units.length, 3);
	const Text = readFileSync("examples/study/Lie-mini.md", "utf8"); assert.ok(prerequisite_excerpt(Text, "lie-commutator").includes("ef="));
	assert.equal(reading_markdown(Text), Text); assert.ok(latex_source(Text).includes("XYZ-XZY-YZX+ZYX"));
	assert.throws(() => latex_source("```js\nx\n```"), /不支持/);
	assert.throws(() => latex_source("$$\n x"), /未闭合/);
	assert.throws(() => prerequisite_excerpt("# a\n" + "a".repeat(4001) + "\n^a", "a"), /超过/);
	const F = fixture(); assert.ok(exercise_markdown(F.Store.Data.Exercises, true).startsWith("# 练习导出"));
});
