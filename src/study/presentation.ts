import type { ChatMessage } from "../history";
import type { TaskSpec } from "./task";
export function structured_task(Messages: ChatMessage[], Reply: ChatMessage): TaskSpec | null
{
	if(!Reply.TurnId)
	{
		return null;
	}
	const Task = Messages.find(Value => Value.Role === "user" && Value.TurnId === Reply.TurnId && Value.Task)?.Task;
	return Reply.Role === "assistant" && Reply.Phase !== "commentary" && Task && ["exercise", "feedback", "solution", "sample", "chapter", "proposal", "edit"].includes(Task.Action) ? Task : null;
}
export function question_label(Task: TaskSpec): string
{
	if(Task.Action === "feedback")
	{
		return JSON.parse(Task.Request).student_attempt;
	}
	if(Task.Action === "solution") { return `查看 ${Task.ExerciseId ?? "当前练习"} 的完整答案`; }
	return Task.Request;
}
