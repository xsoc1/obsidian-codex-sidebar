import type { ContextSnapshot } from "../prompt";
import type { ChatMessage } from "../history";
import { make_task, type TaskSpec } from "./task";
import { parse_output, type ExerciseOutput, type FeedbackOutput, type DraftOutput, type SolutionOutput } from "./schema";
import { StudyStore, type StudyExercise } from "./store";
import { ConfirmedWriter, plan_write, type WriteHost } from "./writer";
import { version_of } from "./document";
import { safe_math_markdown } from "./safe-markdown";

export interface StudyHost extends WriteHost
{
	send_task(Task: TaskSpec): Promise<boolean>;
	changed(): void;
	suppress_completion(Paused: boolean): void;
}
export class StudyController
{
	readonly Writer: ConfirmedWriter;
	Error = "";
	private Processing = new Set<string>();
	private Paused = false;
	constructor(readonly Store: StudyStore, readonly Host: StudyHost)
	{
		this.Writer = new ConfirmedWriter(Store, Host);
	}
	get Exercise(): StudyExercise | undefined
	{
		return this.Store.Data.Exercises.find(Value => Value.Id === this.Store.Data.ActiveExercise);
	}
	answer_focus(Paused: boolean): void
	{
		if(this.Paused !== Paused)
		{
			this.Paused = Paused; this.Host.suppress_completion(Paused);
		}
	}
	register_task(Spec: TaskSpec): void
	{
		if(this.Store.Data.Tasks.some(Value => Value.Spec.Id === Spec.Id) || this.Store.Data.ConsumedTasks?.includes(Spec.Id))
		{
			return;
		}
		this.Store.change(Data => Data.Tasks.push({ Spec: structuredClone(Spec), Status: "pending" }));
	}
	replay_task(Original: TaskSpec, EditedText?: string): TaskSpec
	{
		const Task = { ...structuredClone(Original), Id: crypto.randomUUID(), Request: EditedText ?? Original.Request };
		if(Original.Action === "feedback")
		{
			const Payload = JSON.parse(Original.Request);
			const Text = EditedText ?? Payload.student_attempt;
			const Exercise = this.Store.Data.Exercises.find(Value => Value.Id === Original.ExerciseId);
			if(Exercise)
			{
				Task.AttemptId = crypto.randomUUID(); Task.Request = JSON.stringify({ ...Payload, student_attempt: Text });
				this.Store.change(Data => Data.Exercises.find(Value => Value.Id === Exercise.Id)!.Attempts.push({ Id: Task.AttemptId!, Text, At: new Date().toISOString(), TaskId: Task.Id }));
			}
			else
			{
				Task.Action = "explain"; Task.Scope = "explain-only"; Task.Request = "针对原练习和此次尝试直接解释, 不恢复已清除的学习记录:\n" + JSON.stringify({ ...Payload, student_attempt: Text });
			}
		}
		return Task;
	}
	reveal_raw(Task: TaskSpec): void
	{
		const Id = Task.Action === "exercise" ? `exercise-${Task.Id}` : Task.ExerciseId;
		const Exercise = this.Store.Data.Exercises.find(Value => Value.Id === Id);
		if(Exercise && ["exercise", "solution"].includes(Task.Action))
		{
			this.Store.change(Data =>
			{
				const Value = Data.Exercises.find(Value => Value.Id === Id)!;
				Value.Reveals.push(new Date().toISOString());
				for(let Level = Value.HintUses.length + 1; Level <= Value.Content.hints.length; Level++) { Value.HintUses.push({ Level, At: new Date().toISOString() }); }
			});
		}
	}
	async send(Task: TaskSpec): Promise<boolean>
	{
		this.register_task(Task);
		try
		{
			const Accepted = await this.Host.send_task(Task);
			if(!Accepted)
			{
				throw new Error("任务未提交, 请核对技能和连接后重试");
			}
			return true;
		}
		catch(ErrorValue)
		{
			this.Error = ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue);
			this.Store.change(Data =>
			{
				const Saved = Data.Tasks.find(Value => Value.Spec.Id === Task.Id);
				if(Saved?.Status === "pending")
				{
					Saved.Status = "rejected"; Saved.Error = this.Error;
				}
			});
			this.Host.changed(); return false;
		}
	}
	consume(Messages: ChatMessage[]): void
	{
		for(const User of Messages.filter(Value => Value.Role === "user" && Value.Task && Value.TurnId))
		{
			const Saved = this.Store.Data.Tasks.find(Value => Value.Spec.Id === User.Task!.Id && Value.Status === "pending");
			const Replies = Messages.filter(Value => Value.Role === "assistant" && Value.TurnId === User.TurnId);
			if(!Saved || this.Processing.has(Saved.Spec.Id) || !Replies.length || Replies.some(Value => Value.CompletionStatus === undefined))
			{
				continue;
			}
			this.Processing.add(Saved.Spec.Id);
			// Interim assistant commentary remains in chat; only the final completed message is a structured result.
			const Final = Replies.filter(Value => Value.Phase === "final_answer").at(-1) ?? Replies.at(-1)!;
			const HasFinal = !!Replies.find(Value => Value.Phase === "final_answer") || !Replies.some(Value => Value.Phase);
			void this.accept_result(Saved.Spec, Final.Text, HasFinal && Replies.every(Value => Value.CompletionStatus === "completed")).catch(ErrorValue =>
			{
				if(!this.Store.Data.Tasks.some(Value => Value.Spec.Id === Saved.Spec.Id))
				{
					return;
				}
				this.Error = ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue);
				this.Store.change(Data =>
				{
					const Task = Data.Tasks.find(Value => Value.Spec.Id === Saved.Spec.Id)!;
					Task.Status = "rejected"; Task.Error = this.Error;
				});
			}).finally(() =>
			{
				this.Processing.delete(Saved.Spec.Id); this.Host.changed();
			});
		}
	}
	async accept_result(Task: TaskSpec, Text: string, Completed: boolean): Promise<void>
	{
		if(this.Store.Data.Tasks.find(Value => Value.Spec.Id === Task.Id)?.Status !== "pending")
		{
			return;
		}
		if(!Completed)
		{
			throw new Error("模型输出中断或失败, 不转为练习或写入提案");
		}
		const Structured = ["exercise", "feedback", "solution", "sample", "chapter", "proposal"].includes(Task.Action);
		if(!Structured && !safe_math_markdown(Text))
		{
			throw new Error("工作台数学解释含不支持的可执行或嵌入结构, 保留原始文本但不执行");
		}
		const Output = Structured ? parse_output(Task.Action, Text) : null;
		const SourceVersion = Task.Source ? await version_of(await this.Host.read_current(Task.Source.Path)) : "absent";
		const Plan = ["sample", "chapter", "proposal"].includes(Task.Action) ? plan_write(Task, Output as DraftOutput) : null;
		this.Store.change(Data =>
		{
			const Saved = Data.Tasks.find(Value => Value.Spec.Id === Task.Id)!;
			if(!Saved || Saved.Status !== "pending")
			{
				return;
			}
			Saved.Status = "complete"; Saved.Response = Text;
			if(Task.Action === "exercise" && Task.Source)
			{
				const Id = `exercise-${Task.Id}`;
				Data.Exercises.push({ Id, Source: structuredClone(Task.Source), SourceVersion: Task.SourceVersion ?? Task.Source.Version ?? SourceVersion, Content: Output as ExerciseOutput, CreatedAt: Task.CreatedAt, Stale: (Task.SourceVersion ?? Task.Source.Version ?? SourceVersion) !== SourceVersion, HintUses: [], Reveals: [], Attempts: [], Draft: "" });
				Data.ActiveExercise = Id; Data.Mode = "exercise";
			}
			if(Task.Action === "feedback")
			{
				const Attempt = Data.Exercises.find(Value => Value.Id === Task.ExerciseId)?.Attempts.find(Value => Value.Id === Task.AttemptId);
				if(!Attempt)
				{
					throw new Error("作答记录不存在, 不覆盖其他尝试");
				}
				Attempt.Feedback = Output as FeedbackOutput;
			}
			if(Task.Action === "solution")
			{
				const Exercise = Data.Exercises.find(Value => Value.Id === Task.ExerciseId);
				if(!Exercise)
				{
					throw new Error("原练习已清除");
				}
				Exercise.Content.solution = (Output as SolutionOutput).solution;
			}
			if(Plan)
			{
				Data.Writes.push(Plan);
				Data.Writing.LastDraft = Output as DraftOutput;
			}
		});
		this.Error = "";
	}
	hint(): void
	{
		const Exercise = this.Exercise;
		if(!Exercise)
		{
			return;
		}
		const Level = Math.min(Exercise.HintUses.length + 1, Exercise.Content.hints.length);
		if(Level <= Exercise.HintUses.length)
		{
			return;
		}
		this.Store.change(Data => Data.Exercises.find(Value => Value.Id === Exercise.Id)!.HintUses.push({ Level, At: new Date().toISOString() }));
		this.Host.changed();
	}
	async reveal(): Promise<void>
	{
		const Exercise = this.Exercise;
		if(Exercise)
		{
			this.Store.change(Data => Data.Exercises.find(Value => Value.Id === Exercise.Id)!.Reveals.push(new Date().toISOString()));
			this.Host.changed();
			if(Exercise.Content.solution === null)
			{
				const Task = make_task("solution", Exercise.Source, JSON.stringify({ exercise: Exercise.Content, request: "用户明确请求完整解答, 直接说明完整推导; 无法可靠解答时返回 null, 不反问或强制提示." }));
				Task.ExerciseId = Exercise.Id;
				await this.send(Task);
			}
		}
	}
	async attempt(Text: string, ExerciseId = this.Store.Data.ActiveExercise ?? "", Role: "complete-answer" | "outline" = "complete-answer"): Promise<boolean>
	{
		const Exercise = this.Store.Data.Exercises.find(Value => Value.Id === ExerciseId);
		if(!Exercise || !Text.trim())
		{
			throw new Error("请先写下尝试");
		}
		const AttemptId = crypto.randomUUID();
		const Task = make_task("feedback", Exercise.Source, JSON.stringify({ exercise: Exercise.Content, student_attempt: Text, hints_used: Exercise.HintUses.length, answer_revealed: !!Exercise.Reveals.length }), Role);
		Task.HintLevel = Exercise.Reveals.length ? "direct" : "on-demand";
		Task.ExerciseId = Exercise.Id; Task.AttemptId = AttemptId;
		this.Store.change(Data => Data.Exercises.find(Value => Value.Id === Exercise.Id)!.Attempts.push({ Id: AttemptId, Text, At: new Date().toISOString(), TaskId: Task.Id }));
		return this.send(Task);
	}
	async check_versions(): Promise<void>
	{
		const Paths = [...new Set(this.Store.Data.Exercises.map(Value => Value.Source.Path))];
		const Versions = new Map<string, string>();
		for(const Path of Paths)
		{
			Versions.set(Path, await version_of(await this.Host.read_current(Path)));
		}
		if(this.Store.Data.Exercises.some(Value => Value.Stale !== (!!Value.ManifestVersionChanged || Versions.get(Value.Source.Path) !== Value.SourceVersion)))
		{
			this.Store.change(Data => Data.Exercises.forEach(Value => { Value.Stale = !!Value.ManifestVersionChanged || Versions.get(Value.Source.Path) !== Value.SourceVersion; }));
			this.Host.changed();
		}
	}
}
