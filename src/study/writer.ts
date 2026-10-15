import { note_path, unique_blocks, unit_range, version_of } from "./document";
import type { DraftOutput, ProposalOutput } from "./schema";
import type { TaskSpec, WriteTarget } from "./task";
import type { StudyData, WritePlan } from "./store";

export interface WriteHost
{
	read_current(Path: string): Promise<string | null>;
	source_version?(Path: string): Promise<string>;
	compare_write(Path: string, Before: string | null, After: string): Promise<void>;
}
export function valid_range(Target: WriteTarget): boolean
{
	const Range = Target.Range;
	return typeof Target.Before === "string" && !!Range && Object.keys(Range).every(Key => ["From", "To"].includes(Key)) && Number.isInteger(Range.From) && Number.isInteger(Range.To) && Range.From >= 0 && Range.To > Range.From && Range.To <= Target.Before.length;
}
export async function bind_target(Host: WriteHost, Path: string, Operation: WriteTarget["Operation"], BlockId: string | null): Promise<WriteTarget>
{
	note_path(Path);
	const Before = await Host.read_current(Path);
	if(Operation === "create" && Before !== null)
	{
		throw new Error("新稿目标已存在, 请选择新文件名");
	}
	if(Operation !== "create")
	{
		if(Before === null || !BlockId)
		{
			throw new Error("指定单元不存在");
		}
		unit_range(Before, BlockId);
	}
	return { Path, Before, Version: await version_of(Before), BlockId, Operation, Role: "lecture" };
}
export function plan_write(Task: TaskSpec, Output: DraftOutput | ProposalOutput): WritePlan
{
	const Target = Task.Target;
	if(!Target || !((Task.Scope === "new-lecture" && Target.Operation === "create") || (Task.Scope === "unit-suggestion" && Task.Role === "lecture")))
	{
		throw new Error("当前任务没有讲义写回范围; 源书与教师原题只读");
	}
	note_path(Target.Path);
	if("operation" in Output && Output.operation !== Target.Operation)
	{
		throw new Error("模型操作与用户指定范围不符");
	}
	const OwnId = `study-unit-${Task.Id.replace(/-/g, "").slice(0, 16)}`;
	let Markdown = Output.markdown.trim();
	unique_blocks(Markdown);
	let After: string;
	if(Target.Operation === "create")
	{
		if(Target.Before !== null)
		{
			throw new Error("创建目标基线无效");
		}
		After = /(?:^|\n)\^[A-Za-z0-9-]+$/.test(Markdown) ? Markdown + "\n" : `${Markdown}\n\n^${OwnId}\n`;
	}
	else
	{
		if(Target.Before === null || !Target.BlockId)
		{
			throw new Error("缺少实际单元快照");
		}
		const Range = unit_range(Target.Before, Target.BlockId);
		if(Target.Operation === "replace-unit")
		{
			if(Markdown.includes(`^${Target.BlockId}`))
			{
				Markdown = Markdown.replace(new RegExp(`\\n?\\^${Target.BlockId}\\s*$`), "").trim();
			}
			After = Target.Before.slice(0, Range.From) + Markdown + `\n\n^${Target.BlockId}` + Target.Before.slice(Range.To);
		}
		else if(Target.Operation === "insert-after")
		{
			const Anchored = /(?:^|\n)\^[A-Za-z0-9-]+$/.test(Markdown) ? Markdown : `${Markdown}\n\n^${OwnId}`;
			After = Target.Before.slice(0, Range.To) + `\n\n${Anchored}` + Target.Before.slice(Range.To);
		}
		else
		{
			throw new Error("未知写入操作");
		}
	}
	unique_blocks(After);
	if(!/^#{1,6} /m.test(Markdown))
	{
		throw new Error("讲义单元需包含标题");
	}
	return { Id: crypto.randomUUID(), TaskId: Task.Id, Target: structuredClone(Target), After, Rationale: Output.rationale, State: "preview" };
}
export class ConfirmedWriter<Data extends { Writes: WritePlan[] } = StudyData>
{
	private Locked = new Set<string>();
	constructor(private Store: { Data: Data; change(Update: (Value: Data) => void): void }, private Host: WriteHost)
	{
	}
	is_busy(): boolean { return this.Locked.size > 0; }
	async confirm(Id: string): Promise<void>
	{
		const Plan = this.Store.Data.Writes.find(Value => Value.Id === Id);
		if(!Plan || this.Locked.has(Plan.Target.Path) || ["applied", "undone"].includes(Plan.State))
		{
			return;
		}
		this.Locked.add(Plan.Target.Path);
		try
		{
			note_path(Plan.Target.Path);
			if(!((["create", "insert-after", "replace-unit"].includes(Plan.Target.Operation) && Plan.Target.Role === "lecture") || (Plan.Target.Operation === "replace-range" && Plan.Target.Role === "note" && valid_range(Plan.Target))) || await version_of(Plan.Target.Before) !== Plan.Target.Version)
			{
				throw new Error("写回操作或宿主基线无效");
			}
			unique_blocks(Plan.After);
			if(Plan.Target.Operation === "replace-range")
			{
				const Range = Plan.Target.Range!, Before = Plan.Target.Before!;
				const Tail = Before.length - Range.To;
				if(Plan.After.length < Range.From + Tail || Plan.After.slice(0, Range.From) !== Before.slice(0, Range.From) || (Tail && Plan.After.slice(-Tail) !== Before.slice(Range.To))) { throw new Error("修改超出宿主绑定的原文范围"); }
			}
			const Current = await this.Host.read_current(Plan.Target.Path);
			if(!this.Store.Data.Writes.some(Value => Value.Id === Id))
			{
				throw new Error("提案已清除或取消, 不再写入");
			}
			if(Plan.State === "pending" && Current === Plan.After)
			{
				this.set_state(Id, "applied"); return;
			}
			if(await version_of(Current) !== Plan.Target.Version || Current !== Plan.Target.Before)
			{
				throw new Error("内容已变化, 拒绝陈旧预览; 请重新生成提案");
			}
			this.set_state(Id, "pending");
			await this.Host.compare_write(Plan.Target.Path, Current, Plan.After);
			if(await this.Host.read_current(Plan.Target.Path) !== Plan.After)
			{
				throw new Error("写入回读不一致, 请核对当前内容");
			}
			this.set_state(Id, "applied");
		}
		catch(ErrorValue)
		{
			this.set_state(Id, "conflict", ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue));
			throw ErrorValue;
		}
		finally
		{
			this.Locked.delete(Plan.Target.Path);
		}
	}
	async undo(Id: string): Promise<void>
	{
		const Plan = this.Store.Data.Writes.find(Value => Value.Id === Id);
		if(!Plan || Plan.State !== "applied" || this.Locked.has(Plan.Target.Path))
		{
			return;
		}
		if(Plan.Target.Before === null)
		{
			throw new Error("新建文件保留以避免删除后续内容; 可在 Obsidian 中手动撤销创建");
		}
		this.Locked.add(Plan.Target.Path);
		try
		{
			if(await this.Host.read_current(Plan.Target.Path) !== Plan.After)
			{
				throw new Error("写入后已有其他编辑, 无法安全撤销");
			}
			await this.Host.compare_write(Plan.Target.Path, Plan.After, Plan.Target.Before);
			if(await this.Host.read_current(Plan.Target.Path) !== Plan.Target.Before)
			{
				throw new Error("撤销回读不一致");
			}
			this.set_state(Id, "undone");
		}
		finally
		{
			this.Locked.delete(Plan.Target.Path);
		}
	}
	private set_state(Id: string, State: WritePlan["State"], Error?: string): void
	{
		this.Store.change(Data =>
		{
			const Plan = Data.Writes.find(Value => Value.Id === Id)!;
			if(!Plan)
			{
				return;
			}
			Plan.State = State; Plan.Error = Error;
		});
	}
}
