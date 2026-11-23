import { test } from "node:test";
import assert from "node:assert/strict";
import { interactive_output, interactive_markdown, validate_interactive } from "../src/interactive/protocol";
import { InteractiveStateStore } from "../src/interactive/state";
import { DefaultInstructions, client_instructions, snapshot_instructions, build_prompt } from "../src/prompt";
import { history_items } from "../src/history";
import { answer_quote } from "../src/quote";
import { readFileSync } from "node:fs";
import { interactive_contexts } from "../src/interactive/context";
import type { ChatMessage } from "../src/history";
import { markdown_blocks } from "../src/markdown-blocks";
import { sample_plot } from "../src/interactive/plot";

const Spec = { schemaVersion: 1, plots: [{ id: "heat", title: "时间衰减", expression: "exp(-t)*sin(x)", x: { min: 0, max: Math.PI }, parameters: [{ name: "t", label: "时间", min: 0, max: 5, step: 0.1, value: 0 }] }], symbols: [{ id: "t", symbol: "$t$", meaning: "时间", conditions: "$t\\ge0$", quote: "设 $t\\ge0$." }] };
const Text = "完整说明 $u_t=u_{xx}$.\n\n$$\nu=e^{-t}\\sin x.\n$$\n\n```codex-ui\n" + JSON.stringify(Spec) + "\n```";
const store = () => { const Data = new Map<string, string>(); return { Data, getItem: (K: string) => Data.get(K) ?? null, setItem: (K: string, V: string) => { Data.set(K, V); } }; };

test("the shipped original examples contain complete usable interactive data and complete Markdown", () =>
{
	for(const Name of ["heat", "lie"])
	{
		const Markdown = readFileSync(new URL(`../examples/interactive/${Name}.md`, import.meta.url), "utf8");
		const Output = interactive_output(Markdown, true); assert.equal(Output.Status, "ready", Output.Error); assert.ok(Output.Spec!.symbols.length);
		assert.ok(interactive_markdown(Markdown, Output).includes("$$"));
	}
});

test("complete UI fences validate without changing raw mathematical answer or history", () =>
{
	const Output = interactive_output(Text, true); assert.equal(Output.Status, "ready"); assert.equal(Output.Spec?.symbols[0].conditions, "$t\\ge0$");
	assert.equal(interactive_markdown(Text, Output), "完整说明 $u_t=u_{xx}$.\n\n$$\nu=e^{-t}\\sin x.\n$$");
	const Message = { Id: "answer", Role: "assistant" as const, Text, CompletionStatus: "completed" as const };
	assert.equal(history_items([Message])[0].content[0].text, Text);
	const Quote = answer_quote("session", "answer", "$u_t=u_{xx}$", Text, "completed");
	assert.equal(Quote.SourceText, Text); assert.ok(build_prompt("继续", null, Quote).includes("original_answer_markdown"));
});

test("an aligned row break with optional spacing does not swallow a later interactive graph", () =>
{
	const Proof = String.raw`先比较两个量。

$$
\begin{aligned}
a &= b \\[6pt]
  &= c.
\end{aligned}
$$

因此读图时可以改变维数。`;
	const Plot = { id: "shellWeight", title: "薄层权重", expression: "x^(n-1)*exp(-1/(1-x^2))", x: { min: 0, max: 0.999 }, parameters: [{ name: "n", label: "空间维数 n", min: 2, max: 8, step: 1, value: 3 }] };
	const Answer = Proof + "\n\n" + '```codex-ui\n' + JSON.stringify({ schemaVersion: 1, plots: [Plot], symbols: [] }) + "\n```";
	const Parsed = interactive_output(Answer, true);
	assert.equal(Parsed.Status, "ready");
	assert.equal(interactive_markdown(Answer, Parsed), Proof);
	assert.deepEqual(markdown_blocks(Answer).map(B => [B.Kind, B.Closed]), [["paragraph", true], ["math", true], ["paragraph", true], ["code", true]]);
	const Peak = (Dimension: number) => sample_plot(Parsed.Spec!.plots[0], { n: Dimension }).reduce((Best, S) => (S.y ?? 0) > (Best.y ?? 0) ? S : Best).x;
	assert.ok(Peak(8) > Peak(2));
});

test("escaped bracket commands are literal but real delimiters still pair", () =>
{
	const Literal = String.raw`正文字面量 \\[5pt] 和 \\]。

\[
u=x \qquad \\[1em]
v=y \qquad \\]
\]

之后仍是正文。`;
	assert.deepEqual(markdown_blocks(Literal).map(B => [B.Kind, B.Closed]), [["paragraph", true], ["math", true], ["paragraph", true]]);
});

test("unfinished, interrupted, duplicated and nested UI never enable controls", () =>
{
	assert.equal(interactive_output(Text, false).Status, "pending");
	assert.equal(interactive_output(Text.slice(0, -3), true).Status, "invalid");
	assert.equal(interactive_output(Text + Text, true).Status, "invalid");
	assert.equal(interactive_output("````markdown\n" + Text + "\n````", true).Status, "none");
	assert.equal(interactive_output("ordinary codex-ui text", true).Status, "none");
	assert.equal(interactive_output("```codex-ui\nnot json\n```", true).Status, "invalid");
});

test("UI schema rejects operations, paths, duplicate IDs and oversized output", () =>
{
	for(const Extra of [{ action: "write" }, { js: "alert(1)" }, { path: "../../note.md" }]) { assert.throws(() => validate_interactive({ ...Spec, ...Extra })); }
	assert.throws(() => validate_interactive({ ...Spec, symbols: [{ ...Spec.symbols[0], id: "heat" }] }));
	assert.throws(() => validate_interactive({ ...Spec, plots: [Spec.plots[0], Spec.plots[0], Spec.plots[0]] }));
	assert.throws(() => validate_interactive({ schemaVersion: 1, plots: [], symbols: [] }));
	assert.equal(interactive_output("```codex-ui\n" + " ".repeat(24001) + "x\n```", true).Status, "invalid");
});

test("UI state survives reload and stays separate across device scopes, sessions, messages and spec versions", () =>
{
	const S = store(), V = validate_interactive(Spec), A = new InteractiveStateStore(S, "device-a", "session-a", "message-a", V);
	const State = A.load(); State.Values.heat.t = 2; State.Symbol = "t"; A.save(State);
	assert.equal(new InteractiveStateStore(S, "device-a", "session-a", "message-a", V).load().Values.heat.t, 2);
	for(const [Scope, Session, Message] of [["device-b", "session-a", "message-a"], ["device-a", "session-b", "message-a"], ["device-a", "session-a", "message-b"]]) { assert.equal(new InteractiveStateStore(S, Scope, Session, Message, V).load().Values.heat.t, 0); }
	assert.equal(new InteractiveStateStore(S, "device-a", "session-a", "message-a", { ...V, plots: [{ ...V.plots[0], expression: "sin(x)" }] }).load().Values.heat.t, 0);
	assert.equal(S.Data.size, 1); assert.ok(![...S.Data.values()][0].includes("完整说明"));
});

test("interactive follow-up inherits only the saved and version-verified original context", () =>
{
	const Context = { Path: "original.md", Mode: "阅读" as const, Kind: "当前位置" as const, Mapping: "源块" as const, Text: "original $t$", SelectedText: "", CapturedAt: "original-time", LineStart: 0, LineEnd: 0, Heading: "", Truncated: false };
	const A: ChatMessage = { Id: "a", Role: "assistant", TurnId: "one", Text }, B: ChatMessage = { Id: "b", Role: "assistant", TurnId: "two", Text: "new answer" };
	const Messages: ChatMessage[] = [{ Id: "u", Role: "user", TurnId: "one", Text: "explain", Context }, A, { Id: "v", Role: "user", TurnId: "two", Text: "t=2", Quote: answer_quote("s", "a", "sin(x)", Text, "completed") }, B];
	const Captured = interactive_contexts(Messages, B); assert.deepEqual(Captured, [Context]); assert.notEqual(Captured[0], Context);
	A.Text += "changed"; assert.deepEqual(interactive_contexts(Messages, B), []);
	assert.deepEqual(interactive_contexts(Messages.filter(M => M.Id !== "a"), B), []);
});

test("UI state refuses concurrent overwrite, damaged data and failed storage", () =>
{
	const S = store(), V = validate_interactive(Spec), A = new InteractiveStateStore(S, "d", "s", "m", V), B = new InteractiveStateStore(S, "d", "s", "m", V);
	const First = A.load(), Second = B.load(); First.Values.heat.t = 1; A.save(First);
	assert.throws(() => B.save(Second), /另一窗口/); assert.equal(A.load().Values.heat.t, 1);
	const Before = S.Data.get(A.Key)!; S.Data.set(A.Key, "broken"); assert.throws(() => A.load()); assert.equal(S.Data.get(A.Key), "broken");
	S.Data.set(A.Key, Before); A.load(); const Throwing = { ...S, setItem: () => { throw Error("quota"); } }; const C = new InteractiveStateStore(Throwing, "d", "s", "m", V); C.load(); assert.throws(() => C.save(First), /quota/);
});

test("local, remote and snapshot backends receive the same optional UI contract", () =>
{
	for(const Instructions of [DefaultInstructions, client_instructions("custom", null), snapshot_instructions("custom", "source rules")])
	{
		assert.ok(Instructions.includes("codex-ui v1")); assert.ok(Instructions.includes("不提交新请求")); assert.ok(Instructions.includes("完整的 Markdown 正文")); assert.ok(Instructions.includes("用户"));
	}
});
