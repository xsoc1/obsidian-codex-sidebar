import { note_path, unique_blocks, version_of } from "./document";
import type { WriteTarget } from "./task";
import type { WritePlan } from "./write-types";

export interface WriteHost
{
	read_current(Path: string): Promise<string | null>;
	compare_write(Path: string, Before: string | null, After: string): Promise<void>;
}
export function valid_range(Target: WriteTarget): boolean
{
	const Range = Target.Range;
	return typeof Target.Before === "string" && !!Range && Object.keys(Range).every(Key => ["From", "To"].includes(Key)) && Number.isInteger(Range.From) && Number.isInteger(Range.To) && Range.From >= 0 && Range.To > Range.From && Range.To <= Target.Before.length;
}
export class ConfirmedWriter<Data extends { Writes: WritePlan[] } = { Writes: WritePlan[] }>
{
	private Locked = new Set<string>();
	constructor(private Store: { Data: Data; change(Update: (Value: Data) => void): void | Promise<void> }, private Host: WriteHost)
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
		let ReadbackComplete = false;
		try
		{
			note_path(Plan.Target.Path);
			if(!(Plan.Target.Operation === "replace-range" && Plan.Target.Role === "note" && valid_range(Plan.Target)) || await version_of(Plan.Target.Before) !== Plan.Target.Version)
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
				ReadbackComplete = true;
				await this.set_state(Id, "applied"); return;
			}
			if(await version_of(Current) !== Plan.Target.Version || Current !== Plan.Target.Before)
			{
				throw new Error("内容已变化, 拒绝陈旧预览; 请重新生成提案");
			}
			await this.set_state(Id, "pending");
			await this.Host.compare_write(Plan.Target.Path, Current, Plan.After);
			if(await this.Host.read_current(Plan.Target.Path) !== Plan.After)
			{
				throw new Error("写入回读不一致, 请核对当前内容");
			}
			ReadbackComplete = true;
			await this.set_state(Id, "applied");
		}
		catch(ErrorValue)
		{
			if(ReadbackComplete) { throw new Error("笔记已写入, 完成日志未保存; 存储恢复后可再次确认核对, 不会重复写入. " + String(ErrorValue)); }
			if(this.Store.Data.Writes.find(Value => Value.Id === Id)?.State !== "pending") { await this.set_state(Id, "conflict", ErrorValue instanceof Error ? ErrorValue.message : String(ErrorValue)); }
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
		if(Plan.Target.Operation !== "replace-range" || Plan.Target.Role !== "note" || !valid_range(Plan.Target) || Plan.Target.Before === null)
		{
			throw new Error("只支持当前笔记修改的安全撤销");
		}
		this.Locked.add(Plan.Target.Path);
		try
		{
			const Current = await this.Host.read_current(Plan.Target.Path);
			if(Plan.UndoPending && Current === Plan.Target.Before) { await this.set_state(Id, "undone"); return; }
			if(Current !== Plan.After)
			{
				throw new Error("写入后已有其他编辑, 无法安全撤销");
			}
			await this.set_state(Id, "applied", undefined, true);
			await this.Host.compare_write(Plan.Target.Path, Plan.After, Plan.Target.Before);
			if(await this.Host.read_current(Plan.Target.Path) !== Plan.Target.Before)
			{
				throw new Error("撤销回读不一致");
			}
			await this.set_state(Id, "undone");
		}
		finally
		{
			this.Locked.delete(Plan.Target.Path);
		}
	}
	private async set_state(Id: string, State: WritePlan["State"], Error?: string, UndoPending = false): Promise<void>
	{
		await this.Store.change(Data =>
		{
			const Plan = Data.Writes.find(Value => Value.Id === Id)!;
			if(!Plan)
			{
				return;
			}
			Plan.State = State; Plan.Error = Error;
			if(UndoPending) { Plan.UndoPending = true; } else { delete Plan.UndoPending; }
		});
	}
}
