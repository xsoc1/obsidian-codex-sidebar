import type { ContextSnapshot } from "../prompt";
import type { ChatMessage } from "../history";
import { make_task, type TaskSpec } from "../study/task";
import { ConfirmedWriter, type WriteHost } from "../study/writer";
import { bind_edit, edit_plan, parse_edit, type EditRole, type EditScope } from "./protocol";
import { EditStore, type EditData } from "./store";

interface EditHost extends WriteHost
{
	protected_source(Task: TaskSpec): boolean;
	send(Task: TaskSpec): Promise<boolean>;
	changed(): void;
}

export class ChatEdits
{
	readonly Writer: ConfirmedWriter<EditData>;
	Error = "";
	private Processing = new Set<string>();
	constructor(readonly Store: EditStore, readonly Host: EditHost) { this.Writer = new ConfirmedWriter(Store, Host); }
	async request(Request: string, Source: ContextSnapshot, Scope: EditScope, Role: EditRole): Promise<boolean>
	{
		const Generation = this.Store.Generation;
		const Bound = await bind_edit(this.Host, Source, Scope, Role);
		if(Generation !== this.Store.Generation) { throw new Error("修改记录已清除, 拒绝迟到任务"); }
		const Task = make_task("edit", Source, Request, Bound.Role); Task.Scope = "note-edit";
		Task.Target = Bound.Target; Task.WriteUnit = { ...Bound.Source, SelectedText: "" };
		if(Scope === "ai") { Task.EditMode = "ai"; }
		if(Role === "auto") { Task.EditRoleMode = "auto"; }
		if(this.Host.protected_source({ ...Task, Target: { ...Task.Target, Range: Bound.Focus } })) { throw new Error("此范围包含标为只读的源书或教师原题, 不生成写回提案"); }
		this.register(Task);
		this.Error = "";
		try
		{
			const Accepted = await this.Host.send(Task);
			if(!Accepted) { throw new Error("修改任务未提交, 请检查技能与连接后重试"); }
			return true;
		}
		catch(ErrorValue)
		{
			this.Store.change(Data => { const Value = Data.Records.find(Value => Value.Spec.Id === Task.Id); if(Value?.Status === "pending") { Value.Status = "rejected"; Value.Error = String(ErrorValue); } });
			this.Host.changed(); throw ErrorValue;
		}
	}
	register(Task: TaskSpec): void
	{
		if(this.Store.Data.Records.some(Value => Value.Spec.Id === Task.Id)) { return; }
		this.Store.change(Data => Data.Records.push({ Spec: structuredClone(Task), Status: "pending" }));
	}
	clear(): void
	{
		if(this.Writer.is_busy()) { throw new Error("正在写入或撤销, 请等待回读后再清除记录"); }
		this.Store.clear(); this.Error = ""; this.Host.changed();
	}
	replay(Task: TaskSpec, Request?: string): TaskSpec
	{
		const Original = this.Store.Data.Records.find(Value => Value.Spec.Id === Task.Id)?.Spec;
		if(!Original) { throw new Error("本设备缺少原修改基线, 不会改用当前选区; 请明确重新捕获后发起新修改"); }
		return { ...structuredClone(Original), Id: crypto.randomUUID(), Request: Request ?? Original.Request };
	}
	async accept_result(TaskId: string, Text: string, Completed: boolean): Promise<void>
	{
		const Record = this.Store.Data.Records.find(Value => Value.Spec.Id === TaskId);
		if(!Record || Record.Status !== "pending") { return; }
		if(!Completed) { throw new Error("修改输出中断或失败, 不生成可采用的提案"); }
		const Output = parse_edit(Text), Plan = edit_plan(Record.Spec, Output);
		if(Plan && this.Host.protected_source({ ...Record.Spec, Target: Plan.Target })) { throw new Error("AI 选择的实际范围包含只读内容, 提案已拒绝"); }
		this.Store.change(Data =>
		{
			const Entry = Data.Records.find(Value => Value.Spec.Id === TaskId);
			if(Entry?.Status !== "pending") { return; }
			Entry.Status = "complete"; Entry.Output = Output;
			if(Plan) { Data.Writes.push(Plan); }
		});
		this.Error = "";
		this.Host.changed();
	}
	consume(Messages: ChatMessage[]): void
	{
		for(const User of Messages.filter(Value => Value.Role === "user" && Value.Task?.Action === "edit" && Value.TurnId))
		{
			const Id = User.Task!.Id, Record = this.Store.Data.Records.find(Value => Value.Spec.Id === Id);
			if(Record?.Status !== "pending" || this.Processing.has(Id)) { continue; }
			const Replies = Messages.filter(Value => Value.Role === "assistant" && Value.TurnId === User.TurnId);
			if(!Replies.length || Replies.some(Value => !Value.CompletionStatus)) { continue; }
			const Final = Replies.filter(Value => Value.Phase === "final_answer").at(-1) ?? Replies.at(-1)!;
			const Complete = Replies.every(Value => Value.CompletionStatus === "completed") && (!!Replies.find(Value => Value.Phase === "final_answer") || !Replies.some(Value => Value.Phase));
			this.Processing.add(Id);
			void this.accept_result(Id, Final.Text, Complete).catch(ErrorValue =>
			{
				this.Error = String(ErrorValue);
				try { this.Store.change(Data => { const Value = Data.Records.find(Value => Value.Spec.Id === Id); if(Value?.Status === "pending") { Value.Status = "rejected"; Value.Error = this.Error; } }); }
				catch(ErrorValue) { this.Error += "; 无法保存修改记录: " + String(ErrorValue); }
				this.Host.changed();
			}).finally(() => this.Processing.delete(Id));
		}
	}
	async confirm(Id: string): Promise<void>
	{
		const Plan = this.Store.Data.Writes.find(Value => Value.Id === Id);
		const Record = this.Store.Data.Records.find(Value => Value.Spec.Id === Plan?.TaskId);
		if(!Record || !Plan || this.Host.protected_source({ ...Record.Spec, Target: Plan.Target })) { throw new Error("修改基线缺失或目标现已只读"); }
		await this.Writer.confirm(Id); this.Host.changed();
	}
	async undo(Id: string): Promise<void>
	{
		const Plan = this.Store.Data.Writes.find(Value => Value.Id === Id);
		const Record = this.Store.Data.Records.find(Value => Value.Spec.Id === Plan?.TaskId);
		if(!Record || !Plan || this.Host.protected_source({ ...Record.Spec, Target: Plan.Target })) { throw new Error("修改基线缺失或目标现已只读, 不自动撤销"); }
		await this.Writer.undo(Id); this.Host.changed();
	}
	cancel(TaskId: string): void
	{
		this.Store.change(Data =>
		{
			const Record = Data.Records.find(Value => Value.Spec.Id === TaskId);
			if(Data.Writes.some(Value => Value.TaskId === TaskId && ["pending", "applied"].includes(Value.State))) { throw new Error("写入已开始或已采用, 请使用安全撤销"); }
			if(Record) { Record.Status = "cancelled"; }
			Data.Writes = Data.Writes.filter(Value => Value.TaskId !== TaskId);
		});
		this.Host.changed();
	}
}
