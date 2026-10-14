import type { StudyData } from "./store";
import { parse_output } from "./schema";
import { parse_manifest } from "./manifest";
import { note_path, source_path } from "./document";
import { validate_pdf } from "../pdf/types";

export function validate_store(Data: StudyData): void
{
	const Text = (Value: unknown, Limit = 100000) => typeof Value === "string" && Value.length <= Limit;
	const Id = (Value: unknown) => Text(Value, 160) && !!Value;
	const Roles = ["lecture", "problem", "complete-answer", "outline", "source-excerpt", "teacher-problem"];
	const Source = (Value: any) =>
	{
		if(!Value || !Text(Value.Path, 240) || !Text(Value.Text, 24000) || !Text(Value.SelectedText, 12000) || !Text(Value.Heading, 4000) || !Text(Value.CapturedAt, 100) || !["编辑", "阅读"].includes(Value.Mode) || !["选区", "当前位置"].includes(Value.Kind) || !["源文本", "源块", "渲染文本", "PDF文本层", "PDF页图"].includes(Value.Mapping) || typeof Value.Truncated !== "boolean")
		{
			throw new Error("学习来源快照损坏");
		}
		source_path(Value.Path);
		if(Value.Pdf) { validate_pdf(Value.Pdf); }
		if(Value.Path.toLowerCase().endsWith(".pdf") !== !!Value.Pdf) { throw new Error("PDF 来源缺少有效页图快照"); }
	};
	const Target = (Value: any) =>
	{
		if(!Value || !["create", "insert-after", "replace-unit"].includes(Value.Operation) || Value.Role !== "lecture" || !(Value.Before === null || Text(Value.Before, 4000000)) || !/^(absent|[0-9a-f]{64})$/.test(Value.Version))
		{
			throw new Error("本地写回基线损坏");
		}
		note_path(Value.Path);
	};
	if(Data.schemaVersion !== 1 || !Id(Data.DeviceId) || !Array.isArray(Data.Exercises) || !Array.isArray(Data.Tasks) || !Array.isArray(Data.Writes) || !Data.Writing || !["reading", "exercise", "writing", "review"].includes(Data.Mode) || (Data.InputRole && !Roles.includes(Data.InputRole)))
	{
		throw new Error("学习记录版本不支持或已损坏; 原始数据保留");
	}
	if(Data.Pinned)
	{
		Source(Data.Pinned);
	}
	if(Data.Manifest)
	{
		parse_manifest(JSON.stringify(Data.Manifest.Data));
	}
	const Seen = new Set<string>();
	for(const Exercise of Data.Exercises)
	{
		if(!Id(Exercise.Id) || Seen.has(Exercise.Id) || !Text(Exercise.SourceVersion, 100) || !Array.isArray(Exercise.Attempts) || !Array.isArray(Exercise.HintUses) || !Array.isArray(Exercise.Reveals) || !Text(Exercise.Draft, 24000))
		{
			throw new Error("练习记录损坏");
		}
		Seen.add(Exercise.Id); Source(Exercise.Source); parse_output("exercise", JSON.stringify(Exercise.Content));
		for(const Hint of Exercise.HintUses) { if(!Number.isInteger(Hint.Level) || Hint.Level < 1 || Hint.Level > Exercise.Content.hints.length || !Text(Hint.At, 100)) { throw new Error("提示记录损坏"); } }
		for(const Attempt of Exercise.Attempts)
		{
			if(!Id(Attempt.Id) || !Text(Attempt.Text, 24000) || !Text(Attempt.At, 100))
			{
				throw new Error("尝试记录损坏");
			}
			if(Attempt.Feedback)
			{
				parse_output("feedback", JSON.stringify(Attempt.Feedback));
			}
		}
	}
	Seen.clear();
	for(const Task of Data.Tasks)
	{
		if(!Task.Spec || Task.Spec.SchemaVersion !== 1 || !Id(Task.Spec.Id) || Seen.has(Task.Spec.Id) || !["pending", "complete", "rejected"].includes(Task.Status) || !Roles.includes(Task.Spec.Role) || !["explain", "symbols", "expand", "check", "exercise", "feedback", "solution", "sample", "chapter", "proposal"].includes(Task.Spec.Action) || !Text(Task.Spec.Request) || !Array.isArray(Task.Spec.Prerequisites) || Task.Spec.Prerequisites.length > 3)
		{
			throw new Error("任务记录损坏");
		}
		Seen.add(Task.Spec.Id); if(Task.Spec.Source) { Source(Task.Spec.Source); } Task.Spec.Prerequisites.forEach(Source);
		if(Task.Spec.Target)
		{
			Target(Task.Spec.Target);
		}
	}
	Seen.clear();
	for(const Plan of Data.Writes)
	{
		if(!Id(Plan.Id) || Seen.has(Plan.Id) || !Text(Plan.After, 4000000) || !Text(Plan.Rationale, 6000) || !["preview", "pending", "applied", "undone", "conflict"].includes(Plan.State))
		{
			throw new Error("写回记录损坏");
		}
		Seen.add(Plan.Id); Target(Plan.Target);
	}
	if([Data.Writing.Sources, Data.Writing.Endpoint, Data.Writing.Spine, Data.Writing.ContentMap, Data.Writing.Path].some(Value => !Text(Value, 6000)))
	{
		throw new Error("写作流程记录损坏");
	}
}
