import type { ContextSnapshot } from "../prompt";
import type { ChatMessage } from "../history";
import { make_task, type TaskSpec } from "./task";
import { ConfirmedWriter, type WriteHost } from "./writer";
import { bind_edit, edit_plan, parse_edit, type EditRole, type EditScope } from "./protocol";
import { EditStore, type EditData } from "./store";
import { EditCache, cache_owner, arm_cache, type CacheContext } from "./cache";

interface EditHost extends WriteHost
{
	protected_source(Task: TaskSpec): boolean;
	send(Task: TaskSpec): Promise<boolean>;
	changed(): void;
	cache_context?(Key?: string): CacheContext | null;
}

export class ChatEdits
{
	readonly Writer: ConfirmedWriter<EditData>;
	readonly Cache: EditCache;
	Error = "";
	ErrorTaskId: string | null = null;
	private Processing = new Set<string>();
	constructor(readonly Store: EditStore, readonly Host: EditHost)
	{
		this.Writer = new ConfirmedWriter(Store, Host, (Data, Plan) =>
		{
			const Record = Data.Records.find(R => R.Spec.Id === Plan.TaskId);
			if(Record) { arm_cache(Data, Record, Host.cache_context?.(Record.Cache?.Context) ?? null); }
		});
		this.Cache = new EditCache(Store, Key => Host.cache_context?.(Key) ?? null, () => this.Writer.is_busy() || this.Processing.size > 0, () => Host.changed());
	}
	async request(Request: string, Source: ContextSnapshot, Scope: EditScope, Role: EditRole, Signal?: AbortSignal): Promise<boolean>
	{
		const Check = () => { if(Signal?.aborted) { throw new Error("准备已取消, 未提交修改请求"); } }; Check();
		const Generation = this.Store.Generation;
		const Bound = await bind_edit(this.Host, Source, Scope, Role);
		Check();
		if(Generation !== this.Store.Generation) { throw new Error("修改记录已清除, 拒绝迟到任务"); }
		const Task = make_task("edit", Source, Request, Bound.Role); Task.Scope = "note-edit";
		Task.Target = Bound.Target; Task.WriteUnit = { ...Bound.Source, SelectedText: "" };
		if(Scope === "ai") { Task.EditMode = "ai"; }
		if(Role === "auto") { Task.EditRoleMode = "auto"; }
		if(this.Host.protected_source({ ...Task, Target: { ...Task.Target, Range: Bound.Focus } })) { throw new Error("此范围包含标为只读的源书或教师原题, 不生成写回提案"); }
		await this.register(Task);
		Check();
		if(Generation !== this.Store.Generation) { throw new Error("修改记录已清除, 拒绝迟到任务"); }
		this.Error = ""; this.ErrorTaskId = null;
		try
		{
			const Accepted = await this.Host.send(Task);
			if(!Accepted) { throw new Error("修改任务未提交, 请检查技能与连接后重试"); }
			return true;
		}
		catch(ErrorValue)
		{
			await this.Store.change(Data => { const Value = Data.Records.find(Value => Value.Spec.Id === Task.Id); if(Value?.Status === "pending") { Value.Status = "rejected"; Value.Error = String(ErrorValue); } });
			this.Host.changed(); throw ErrorValue;
		}
	}
	async register(Task: TaskSpec): Promise<void>
	{
		if(this.Store.Data.Records.some(Value => Value.Spec.Id === Task.Id)) { return; }
		const Cache = cache_owner(this.Host.cache_context?.() ?? null);
		await this.Store.change(Data => { if(!Data.Records.some(Value => Value.Spec.Id === Task.Id)) { Data.Records.push({ Spec: structuredClone(Task), Status: "pending", ...(Cache ? { Cache } : {}) }); } });
	}
	async clear(): Promise<void>
	{
		if(this.Writer.is_busy()) { throw new Error("正在写入或撤销, 请等待回读后再清除记录"); }
		await this.Cache.flush();
		await this.Store.clear(); this.Error = ""; this.ErrorTaskId = null; this.Host.changed();
	}
	replay(Task: TaskSpec, Request?: string): TaskSpec
	{
		const Original = this.Store.Data.Records.find(Value => Value.Spec.Id === Task.Id)?.Spec;
		if(!Original) { throw new Error("本设备缺少原修改基线, 不会改用当前选区; 请明确重新捕获后发起新修改"); }
		return { ...structuredClone(Original), Id: crypto.randomUUID(), Request: Request ?? Original.Request };
	}
	can_retry(TaskId: string): boolean
	{
		const Record = this.Store.Data.Records.find(Value => Value.Spec.Id === TaskId);
		return Record?.Status === "rejected" && !!Record.Error?.includes("本设备修改记录已满");
	}
	async retry_result(TaskId: string, Messages: ChatMessage[]): Promise<void>
	{
		if(!this.can_retry(TaskId) || this.Processing.has(TaskId)) { throw new Error("这条记录不属于可恢复的旧容量错误"); }
		const User = Messages.find(Value => Value.Role === "user" && Value.Task?.Id === TaskId);
		const Replies = User?.TurnId ? Messages.filter(Value => Value.Role === "assistant" && Value.TurnId === User.TurnId) : [];
		const Final = Replies.filter(Value => Value.Phase === "final_answer").at(-1) ?? Replies.at(-1);
		if(!Final || Replies.some(Value => Value.CompletionStatus !== "completed") || (Replies.some(Value => Value.Phase) && !Replies.some(Value => Value.Phase === "final_answer"))) { throw new Error("缺少完整原始回复, 不恢复中断或其他轮次的输出"); }
		this.Processing.add(TaskId);
		try
		{
			await this.Store.change(Data =>
			{
				const Record = Data.Records.find(Value => Value.Spec.Id === TaskId);
				if(Record?.Status !== "rejected" || !Record.Error?.includes("本设备修改记录已满")) { throw new Error("原修改记录已变化, 请重新检查"); }
				Record.ErrorHistory = [...(Record.ErrorHistory ?? []), Record.Error];
				Record.Status = "pending"; delete Record.Error;
			});
			await this.accept_result(TaskId, Final.Text, true);
		}
		catch(ErrorValue)
		{
			this.Error = String(ErrorValue); this.ErrorTaskId = TaskId;
			await this.Store.change(Data => { const Record = Data.Records.find(Value => Value.Spec.Id === TaskId); if(Record?.Status === "pending") { Record.Status = "rejected"; Record.Error = this.Error; } });
			throw ErrorValue;
		}
		finally { this.Processing.delete(TaskId); this.Host.changed(); }
	}
	async accept_result(TaskId: string, Text: string, Completed: boolean): Promise<void>
	{
		const Record = this.Store.Data.Records.find(Value => Value.Spec.Id === TaskId);
		if(!Record || Record.Status !== "pending") { return; }
		if(!Completed) { throw new Error("修改输出中断或失败, 不生成可采用的提案"); }
		const Output = parse_edit(Text), Plan = edit_plan(Record.Spec, Output);
		if(Plan && this.Host.protected_source({ ...Record.Spec, Target: Plan.Target })) { throw new Error("AI 选择的实际范围包含只读内容, 提案已拒绝"); }
		await this.Store.change(Data =>
		{
			const Entry = Data.Records.find(Value => Value.Spec.Id === TaskId);
			if(Entry?.Status !== "pending") { return; }
			Entry.Status = "complete"; Entry.Output = Output;
			if(Plan) { Data.Writes.push(Plan); arm_cache(Data, Entry, this.Host.cache_context?.(Entry.Cache?.Context) ?? null); }
		});
		this.Error = ""; this.ErrorTaskId = null;
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
			void this.accept_result(Id, Final.Text, Complete).catch(async ErrorValue =>
			{
				this.Error = String(ErrorValue); this.ErrorTaskId = Id;
				try { await this.Store.change(Data => { const Value = Data.Records.find(Value => Value.Spec.Id === Id); if(Value?.Status === "pending") { Value.Status = "rejected"; Value.Error = this.Error; } }); }
				catch(ErrorValue) { if(String(ErrorValue) !== this.Error) { this.Error += "; 无法保存修改记录: " + String(ErrorValue); } }
				this.Host.changed();
			}).finally(() => this.Processing.delete(Id));
		}
	}
	async confirm(Id: string): Promise<void>
	{
		if(this.Cache.Working) { throw new Error("正在整理修改缓存, 请稍后再确认"); }
		const Plan = this.Store.Data.Writes.find(Value => Value.Id === Id);
		const Record = this.Store.Data.Records.find(Value => Value.Spec.Id === Plan?.TaskId);
		if(!Record || !Plan || this.Host.protected_source({ ...Record.Spec, Target: Plan.Target })) { throw new Error("修改基线缺失或目标现已只读"); }
		await this.Writer.confirm(Id);
		this.Host.changed();
	}
	async undo(Id: string): Promise<void>
	{
		if(this.Cache.Working) { throw new Error("正在整理修改缓存, 请稍后再撤销"); }
		const Plan = this.Store.Data.Writes.find(Value => Value.Id === Id);
		const Record = this.Store.Data.Records.find(Value => Value.Spec.Id === Plan?.TaskId);
		if(!Record || !Plan || this.Host.protected_source({ ...Record.Spec, Target: Plan.Target })) { throw new Error("修改基线缺失或目标现已只读, 不自动撤销"); }
		await this.Writer.undo(Id); this.Host.changed();
	}
	async cancel(TaskId: string): Promise<void>
	{
		await this.Store.change(Data =>
		{
			const Record = Data.Records.find(Value => Value.Spec.Id === TaskId);
			if(Data.Writes.some(Value => Value.TaskId === TaskId && ["pending", "applied"].includes(Value.State))) { throw new Error("写入已开始或已采用, 请使用安全撤销"); }
			if(Record) { Record.Status = "cancelled"; }
			Data.Writes = Data.Writes.filter(Value => Value.TaskId !== TaskId);
		});
		this.Host.changed();
	}
}
