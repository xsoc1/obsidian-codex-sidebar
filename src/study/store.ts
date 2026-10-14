import type { ContextSnapshot } from "../prompt";
import type { DraftOutput, ExerciseOutput, FeedbackOutput, InputRole } from "./schema";
import type { TaskSpec } from "./task";
import type { StudyManifest } from "./manifest";
import { validate_store } from "./validate-store";

export interface StudyExercise
{
	Id: string;
	Source: ContextSnapshot;
	SourceVersion: string;
	Content: ExerciseOutput;
	CreatedAt: string;
	Stale: boolean;
	ManifestVersionChanged?: boolean;
	HintUses: { Level: number; At: string }[];
	Reveals: string[];
	Attempts: { Id: string; Text: string; At: string; Feedback?: FeedbackOutput; TaskId?: string }[];
	Draft: string;
	DraftRole?: "complete-answer" | "outline";
}
export interface WritePlan
{
	Id: string;
	TaskId: string;
	Target: NonNullable<TaskSpec["Target"]>;
	After: string;
	Rationale: string;
	State: "preview" | "pending" | "applied" | "undone" | "conflict";
	Error?: string;
}
export interface StudyData
{
	schemaVersion: 1;
	DeviceId: string;
	Pinned: ContextSnapshot | null;
	Mode: "reading" | "exercise" | "writing" | "review";
	InputRole?: InputRole;
	Manifest: { Path: string; Data: StudyManifest } | null;
	Exercises: StudyExercise[];
	ActiveExercise: string | null;
	Tasks: { Spec: TaskSpec; Status: "pending" | "complete" | "rejected"; Error?: string; Response?: string }[];
	Writes: WritePlan[];
	ConsumedTasks?: string[];
	Writing: { Sources: string; Endpoint: string; Spine: string; ContentMap: string; Path: string; ApprovedSample?: string; ApprovedSampleId?: string; LastDraft?: DraftOutput };
}
export interface LocalStorageLike
{
	getItem(Key: string): string | null;
	setItem(Key: string, Value: string): void;
}
export class StudyStore
{
	Data: StudyData;
	readonly Key: string;
	constructor(private Storage: LocalStorageLike, VaultId: string)
	{
		this.Key = `codex-sidebar-study:v1:${VaultId}`;
		const Raw = Storage.getItem(this.Key);
		const Default: StudyData = { schemaVersion: 1, DeviceId: crypto.randomUUID(), Pinned: null, Mode: "reading", Manifest: null, Exercises: [], ActiveExercise: null, Tasks: [], Writes: [], Writing: { Sources: "", Endpoint: "", Spine: "", ContentMap: "", Path: "学习新稿.md" } };
		if(Raw)
		{
			const Value = JSON.parse(Raw);
			if(Value.schemaVersion === undefined && Value.SchemaVersion !== undefined)
			{
				Value.schemaVersion = Value.SchemaVersion; delete Value.SchemaVersion;
			}
			if(Value.schemaVersion === 0 && Array.isArray(Value.Exercises) && Value.Exercises.length === 0)
			{
				this.Data = { ...Default, DeviceId: Value.DeviceId || Default.DeviceId };
			}
			else
			{
				if(Value.schemaVersion !== 1 || typeof Value.DeviceId !== "string" || !Array.isArray(Value.Exercises) || !Array.isArray(Value.Tasks) || !Array.isArray(Value.Writes) || !Value.Writing || !["reading", "exercise", "writing", "review"].includes(Value.Mode))
				{
					throw new Error("学习记录版本不支持或已损坏; 原始数据保留, 不自动覆盖");
				}
				this.Data = Value;
				validate_store(this.Data);
			}
		}
		else
		{
			this.Data = Default;
		}
	}
	change(Update: (Data: StudyData) => void): void
	{
		const Next = structuredClone(this.Data);
		Update(Next);
		validate_store(Next);
		this.Storage.setItem(this.Key, JSON.stringify(Next));
		this.Data = Next;
	}
	export_records(): string
	{
		return JSON.stringify(this.Data, null, 2);
	}
	clear_records(): void
	{
		if(this.Data.Writes.some(Value => Value.State === "pending"))
		{
			throw new Error("写回尚未完成, 请核对结果后再清除学习记录");
		}
		this.change(Data =>
		{
			Data.Exercises = []; Data.ActiveExercise = null; Data.Tasks = []; Data.Pinned = null;
			Data.ConsumedTasks = [...new Set([...(Data.ConsumedTasks ?? []), ...this.Data.Tasks.map(Value => Value.Spec.Id), ...Data.Writes.map(Value => Value.TaskId)])];
			Data.Writes = [];
			Data.Manifest = null;
			Data.Writing = { Sources: "", Endpoint: "", Spine: "", ContentMap: "", Path: "学习新稿.md" };
		});
	}
}
