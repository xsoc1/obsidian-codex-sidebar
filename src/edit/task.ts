import type { ContextSnapshot } from "../prompt";
import { edit_prompt } from "./protocol";

// Legacy values remain serializable in old chat snapshots, never executable tasks.
export type TaskAction = "explain" | "symbols" | "expand" | "check" | "exercise" | "feedback" | "solution" | "sample" | "chapter" | "proposal" | "edit";
export type InputRole = "lecture" | "problem" | "complete-answer" | "outline" | "source-excerpt" | "teacher-problem" | "note";

export interface WriteTarget
{
	Path: string;
	Before: string | null;
	Version: string;
	BlockId: string | null;
	Operation: "create" | "insert-after" | "replace-unit" | "replace-range";
	Role: "lecture" | "note";
	Range?: { From: number; To: number };
}
export interface TaskSpec
{
	SchemaVersion: 1;
	Id: string;
	Action: TaskAction;
	Role: InputRole;
	Scope: "explain-only" | "nearby-exercise" | "attempt-feedback" | "new-lecture" | "unit-suggestion" | "note-edit";
	HintLevel: "direct" | "on-demand";
	Source: ContextSnapshot | null;
	SourceVersion?: string;
	Sources?: { Id: string; Label: string; Locator: string; Verification: "unverified" | "user-checked" }[];
	WriteUnit?: ContextSnapshot;
	Prerequisites: ContextSnapshot[];
	CreatedAt: string;
	Request: string;
	ExerciseId?: string;
	AttemptId?: string;
	Target?: WriteTarget;
	EditMode?: "ai";
	EditRoleMode?: "auto";
	Writing?: { Sources: string; Endpoint: string; Spine: string; ContentMap: string; ApprovedSample?: string };
}

export function task_prompt(Task: TaskSpec): string
{
	if(Task.Action !== "edit") { throw new Error("数学学习工作台已移除; 历史任务仅供查看, 请使用普通提问"); }
	return edit_prompt(Task);
}

export function make_task(Action: "edit", Source: ContextSnapshot | null, Request: string, Role: InputRole = "note"): TaskSpec
{
	if(Action !== "edit") { throw new Error("数学学习工作台已移除; 只支持显式修改预览任务"); }
	return { SchemaVersion: 1, Id: crypto.randomUUID(), Action, Role, Scope: "note-edit", HintLevel: "direct", Source: Source ? structuredClone(Source) : null, Prerequisites: [], CreatedAt: new Date().toISOString(), Request };
}
