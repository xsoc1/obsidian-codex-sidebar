import type { TaskSpec, WriteTarget } from "../study/task";
import type { EditOutput } from "./protocol";
import { valid_range } from "../study/writer";

export function validate_edit_mode(Task: TaskSpec, Output: EditOutput): void
{
	if(Task.EditMode === "ai" ? !("original" in Output) : "original" in Output) { throw new Error("修改输出的范围模式与原任务不一致"); }
}

export function search_window(Text: string, Focus: { From: number; To: number }, Limit = 24000): { From: number; To: number }
{
	let From = Math.max(0, Focus.From - Math.floor((Limit - (Focus.To - Focus.From)) / 2));
	let To = Math.min(Text.length, From + Limit); From = Math.max(0, To - Limit);
	if(From)
	{
		const Boundary = Text.indexOf("\n", From);
		if(Boundary >= 0 && Boundary < Focus.From) { From = Boundary + 1; }
	}
	if(To < Text.length)
	{
		const Boundary = Text.lastIndexOf("\n", To);
		if(Boundary >= Focus.To) { To = Boundary; }
	}
	return { From, To };
}

export function resolve_edit_target(Task: TaskSpec, Output: EditOutput): WriteTarget
{
	validate_edit_mode(Task, Output);
	const Target = Task.Target;
	if(!Target || Target.Role !== "note" || Target.Operation !== "replace-range" || !valid_range(Target)) { throw new Error("缺少本设备绑定的修改范围"); }
	if(Task.EditMode !== "ai")
	{
		if("original" in Output) { throw new Error("固定范围任务不能由模型改变原文范围"); }
		return structuredClone(Target);
	}
	if(Output.status !== "proposal" || typeof Output.original !== "string" || !Output.original.length || Output.original.length > 24000) { throw new Error("AI 自选范围需要提供非空的精确原文"); }
	const Window = Target.Before!.slice(Target.Range!.From, Target.Range!.To);
	const Offset = Window.indexOf(Output.original);
	if(Offset < 0) { throw new Error("AI 选择的原文不在本轮提供的笔记范围中, 拒绝定位"); }
	if(Window.indexOf(Output.original, Offset + 1) >= 0) { throw new Error("AI 选择的原文重复, 定位不唯一; 请重发并要求包含相邻原文"); }
	const From = Target.Range!.From + Offset, To = From + Output.original.length;
	return { ...structuredClone(Target), Range: { From, To } };
}
