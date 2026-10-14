import { note_path, unit_range } from "./document";
import { parse_output, type ExerciseOutput } from "./schema";
export interface SourceRef
{
	id: string;
	label: string;
	verification: "unverified" | "user-checked";
	locator: string;
}
export interface StudyManifest
{
	schemaVersion: 1;
	courseId: string;
	title: string;
	sources: SourceRef[];
	units: { id: string; path: string; blockId: string; prerequisites: { path: string; blockId: string }[]; sources: string[]; role: "lecture" | "source-excerpt" | "teacher-problem"; exercises: { id: string; content: ExerciseOutput }[] }[];
}
export function parse_manifest(Text: string): StudyManifest
{
	if(Text.length > 500000)
	{
		throw new Error("课程清单过大");
	}
	const Value = JSON.parse(Text);
	const Id = (Value: unknown) => typeof Value === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(Value);
	const Label = (Value: unknown) => typeof Value === "string" && Value.length < 4000;
	const Keys = (Value: any, Allowed: string[]) => Value && !Array.isArray(Value) && Object.keys(Value).every(Key => Allowed.includes(Key));
	if(!Keys(Value, ["schemaVersion", "courseId", "title", "sources", "units"]) || Value.schemaVersion !== 1 || !Id(Value.courseId) || !Label(Value.title) || !Array.isArray(Value.units) || Value.units.length > 200 || !Array.isArray(Value.sources) || Value.sources.length > 200)
	{
		throw new Error("课程清单格式无效");
	}
	const Seen = new Set<string>();
	for(const Source of Value.sources)
	{
		if(!Keys(Source, ["id", "label", "verification", "locator"]) || !Id(Source.id) || Seen.has(Source.id) || !Label(Source.label) || !Label(Source.locator) || !["unverified", "user-checked"].includes(Source.verification))
		{
			throw new Error("来源登记无效或重复");
		}
		Seen.add(Source.id);
	}
	const Units = new Set<string>(); const Exercises = new Set<string>();
	for(const Unit of Value.units)
	{
		if(!Keys(Unit, ["id", "path", "blockId", "prerequisites", "sources", "role", "exercises"]) || !Id(Unit.id) || Units.has(Unit.id) || !Id(Unit.blockId) || !["lecture", "source-excerpt", "teacher-problem"].includes(Unit.role) || !Array.isArray(Unit.prerequisites) || Unit.prerequisites.length > 3 || !Array.isArray(Unit.sources) || Unit.sources.some((Id: string) => !Seen.has(Id)) || !Array.isArray(Unit.exercises) || Unit.exercises.length > 100)
		{
			throw new Error("课程单元格式无效或重复");
		}
		Units.add(Unit.id); note_path(Unit.path);
		for(const Ref of Unit.prerequisites)
		{
			if(!Keys(Ref, ["path", "blockId"]) || !Id(Ref.blockId))
			{
				throw new Error("前置内容格式无效");
			}
			note_path(Ref.path);
		}
		for(const Exercise of Unit.exercises)
		{
			if(!Keys(Exercise, ["id", "content"]) || !Id(Exercise.id) || Exercises.has(Exercise.id))
			{
				throw new Error("练习 ID 无效或重复");
			}
			Exercises.add(Exercise.id); parse_output("exercise", JSON.stringify(Exercise.content));
		}
	}
	return Value;
}
export function prerequisite_excerpt(Text: string, BlockId: string): string
{
	const Range = unit_range(Text, BlockId);
	const Result = Text.slice(Range.From, Range.To);
	if(Result.length > 4000)
	{
		throw new Error("直接前置单元超过 4000 字符, 请缩小范围");
	}
	return Result;
}
