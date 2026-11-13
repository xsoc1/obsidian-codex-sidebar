import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultInstructions, V017DefaultInstructions, ManagedInstructions, migrate_instructions, editing_instructions, client_instructions, snapshot_instructions, environment_instructions, instruction_items, build_prompt } from "../src/prompt";
import { InteractiveDecisionRules, InteractiveRules } from "../src/interactive/rules";
import { V017InteractiveRules } from "../src/interactive/legacy";
import { MathCompletionInstructions } from "../src/completion-prompt";
import { skill_input } from "../src/skills";
import { history_items } from "../src/history";

test("known beta.17 default migrates exactly once to autonomous choice", () =>
{
	assert.notEqual(V017DefaultInstructions, DefaultInstructions);
	assert.equal(migrate_instructions(V017DefaultInstructions), DefaultInstructions);
	assert.equal(editing_instructions(V017DefaultInstructions), DefaultInstructions);
	assert.equal(editing_instructions(editing_instructions(V017DefaultInstructions)), DefaultInstructions);
	assert.equal(DefaultInstructions.split("automatic-v1").length - 1, 1);
	assert.ok(!DefaultInstructions.includes(V017InteractiveRules));
});

test("only a full known host suffix is replaced; opaque custom text is preserved", () =>
{
	// Locate the known managed suffix without depending on an editing-rule heading.
	const PrefixLength = DefaultInstructions.length - ("\n\n" + ManagedInstructions).length;
	const OldTail = V017DefaultInstructions.slice(PrefixLength), Custom = "按我的原有证明路线, 不改变教师题面.\n";
	assert.ok(OldTail.startsWith("\n\n"));
	const Next = editing_instructions(Custom + OldTail);
	assert.equal(Next, Custom + "\n\n" + ManagedInstructions);
	assert.equal(editing_instructions(Next), Next);
	assert.equal(migrate_instructions(Custom + OldTail), Custom + OldTail);
	for(const Opaque of [Custom + V017InteractiveRules, Custom + OldTail + "\n我补写的结尾.", Custom + V017InteractiveRules + "\n引用一段旧规则."])
	{
		assert.equal(migrate_instructions(Opaque), Opaque);
		assert.equal(editing_instructions(Opaque), Opaque + "\n\n" + ManagedInstructions);
	}
});

test("the same automatic policy reaches desktop, remote, API snapshots and custom instructions", () =>
{
	const Environment = { Vault: "Original", Root: "/original-vault", Cli: "/host/obsidian" };
	for(const Custom of ["custom user wording", V017DefaultInstructions, DefaultInstructions])
	{
		const Desktop = client_instructions(Custom, Environment), Remote = client_instructions(Custom, null), Api = snapshot_instructions(Custom, "source rules");
		for(const Work of [Desktop, Remote, Api, environment_instructions(Remote, Environment)])
		{
			assert.ok(Work.includes(InteractiveDecisionRules)); assert.ok(Work.endsWith("\n\n" + ManagedInstructions));
			assert.equal(Work.split("automatic-v1").length - 1, 1);
			assert.equal(instruction_items(Work)[0].role, "developer");
		}
	}
});

test("policy states concrete benefit and mathematical gates, not trigger-word classification", () =>
{
	for(const Phrase of ["不等待用户说出", "去掉组件", "三者满足", "整数步长", "正参数", "观察窗口", "自选示例", "不把示例结论推广", "单个普通变量", "没有确切出处", "存在对应定义/条件原句", "不必等用户另行要求出处", "最少够用", "无收益时不输出", "不机械复制", "未发送的本地调整不可推测", "不输出评分表"])
	{
		assert.ok(InteractiveDecisionRules.includes(Phrase), Phrase);
	}
	assert.ok(InteractiveRules.includes("完整的 Markdown 正文、定义、条件和主要证明必须先给出"));
	assert.ok(InteractiveDecisionRules.includes("不增加一次分类请求"));
	assert.ok(InteractiveRules.includes("最多2幅图、12个符号"));
});

test("literal output tasks and native completion retain their original contracts", () =>
{
	for(const Phrase of ["只答一句", "只纠正一处", "修改提案 JSON", "行内补全", "翻译", "纯排版"])
	{
		assert.ok(InteractiveDecisionRules.includes(Phrase));
	}
	assert.ok(!MathCompletionInstructions.includes("automatic-v1"));
	assert.ok(!MathCompletionInstructions.includes("codex-ui"));
	assert.ok(MathCompletionInstructions.includes("严格输出 JSON"));
	const Input = skill_input(build_prompt("original question", null), { type: "skill", name: "math-writing", path: "/host/skill/SKILL.md" });
	assert.deepEqual(Input.map(I => I.type), ["text", "skill"]);
	assert.equal(Input[0].text, "original question");
});

test("upgrading working instructions does not rewrite saved question prompts or source snapshots", () =>
{
	const Original = { Id: "old-user", Role: "user" as const, Text: "原问题", Prompt: "原来的捕获材料 $f_k(x)=\\sin(kx)$", Context: null };
	const Before = structuredClone(Original);
	assert.equal(history_items([Original])[0].content[0].text, Original.Prompt);
	assert.deepEqual(Original, Before); assert.equal(build_prompt("原问题", null), "原问题");
});
