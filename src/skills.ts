import { isAbsolute, win32 } from "node:path";

export interface SkillInput
{
	type: "skill";
	name: string;
	path: string;
}

interface SkillMetadata
{
	name: string;
	path: string;
	enabled: boolean;
	scope?: string;
}

function normalized_path(Path: string): string
{
	return Path.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

export function math_writing_skill(Result: { data?: { cwd: string; skills: SkillMetadata[] }[] }, Cwd: string): SkillInput
{
	const Matches = (Result.data ?? []).filter(Entry => normalized_path(Entry.cwd) === normalized_path(Cwd))
		.flatMap(Entry => Entry.skills).filter(Skill => Skill.name === "math-writing" && Skill.enabled);
	const Skill = Matches.find(Value => Value.scope === "user") ?? Matches[0];
	if(!Skill || !(isAbsolute(Skill.path) || win32.isAbsolute(Skill.path)) || !/[\\/]SKILL\.md$/i.test(Skill.path))
	{
		throw new Error("未发现当前 vault 可用的 math-writing 技能. 请在本机 Codex 安装并启用 math-writing, 然后点击侧栏重连");
	}
	return { type: "skill", name: "math-writing", path: Skill.path };
}

export function skill_input(Text: string, Skill: SkillInput)
{
	return [{ type: "text", text: Text, text_elements: [] }, { ...Skill }];
}
