import { test } from "node:test";
import assert from "node:assert/strict";
import { math_writing_skill, skill_input } from "../src/skills";

test("math-writing discovery respects the current vault and prefers the user's enabled skill", () =>
{
	const Result = { data: [
		{ cwd: "C:/other", skills: [{ name: "math-writing", path: "C:/other/SKILL.md", enabled: true }] },
		{ cwd: "F:\\vault\\", skills: [
			{ name: "math-writing", path: "C:/bundled/SKILL.md", enabled: true, scope: "system" },
			{ name: "math-writing", path: "C:/personal/SKILL.md", enabled: true, scope: "user" }
		] }
	] };
	assert.deepEqual(math_writing_skill(Result, "f:/vault"), { type: "skill", name: "math-writing", path: "C:/personal/SKILL.md" });
});

test("missing, disabled, other-vault and relative skill paths fail instead of pretending to load", () =>
{
	const Skill = { name: "math-writing", path: "C:/skills/SKILL.md", enabled: true };
	for(const Result of [
		{}, { data: [{ cwd: "C:/other", skills: [Skill] }] },
		{ data: [{ cwd: "C:/vault", skills: [{ ...Skill, enabled: false }] }] },
		{ data: [{ cwd: "C:/vault", skills: [{ ...Skill, path: "relative/SKILL.md" }] }] }
	])
	{
		assert.throws(() => math_writing_skill(Result, "C:/vault"), /未发现.*math-writing/);
	}
});

test("skill attachment preserves the submitted question and source exactly", () =>
{
	const Skill = { type: "skill" as const, name: "math-writing", path: "C:/personal/SKILL.md" };
	const Text = "请检查\n<obsidian_source>\n$x^2$\n</obsidian_source>";
	const Items = skill_input(Text, Skill);
	assert.deepEqual(Items, [{ type: "text", text: Text, text_elements: [] }, Skill]);
	assert.notEqual(Items[1], Skill);
});
