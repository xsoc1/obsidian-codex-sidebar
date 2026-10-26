import type { LocalStorageLike, WritePlan } from "./write-types";
import type { TaskSpec } from "./task";
import { note_path } from "./document";
import { valid_range } from "./writer";
import { parse_edit, type EditOutput } from "./protocol";
import { resolve_edit_target, validate_edit_mode } from "./range";

export interface EditRecord
{
	Spec: TaskSpec;
	Status: "pending" | "complete" | "rejected" | "cancelled";
	Output?: EditOutput;
	Error?: string;
	ErrorHistory?: string[];
}
export interface EditData
{
	schemaVersion: 2;
	DeviceId: string;
	Records: EditRecord[];
	Writes: WritePlan[];
}

export function validate_edits(Data: EditData): void
{
	if(!Data || Data.schemaVersion !== 2 || typeof Data.DeviceId !== "string" || !Array.isArray(Data.Records) || !Array.isArray(Data.Writes)) { throw new Error("修改记录版本不支持或损坏, 原数据保留"); }
	const Seen = new Set<string>();
	for(const Record of Data.Records)
	{
		const Task = Record.Spec, Target = Task?.Target;
		if(Record.ErrorHistory !== undefined && (!Array.isArray(Record.ErrorHistory) || Record.ErrorHistory.some(Value => typeof Value !== "string"))) { throw new Error("修改记录错误历史损坏"); }
		if(!Task || typeof Task.Id !== "string" || Seen.has(Task.Id) || Task.Action !== "edit" || Task.Scope !== "note-edit" || typeof Task.Request !== "string" || Task.Request.length > 24000 || !Task.Source || !Task.WriteUnit || !Target || Target.Role !== "note" || Target.Operation !== "replace-range" || !valid_range(Target) || Target.Before!.length > 500000 || !/^[0-9a-f]{64}$/.test(Target.Version) || Target.Path !== Task.Source.Path || Target.Path !== Task.WriteUnit.Path || Task.WriteUnit.Text !== Target.Before!.slice(Target.Range!.From, Target.Range!.To) || !["note", "problem", "complete-answer", "outline", "lecture"].includes(Task.Role) || !["pending", "complete", "rejected", "cancelled"].includes(Record.Status)) { throw new Error("本设备修改目标或原文范围损坏"); }
		note_path(Target.Path); Seen.add(Task.Id);
		if(Task.EditRoleMode !== undefined && (Task.EditRoleMode !== "auto" || Task.Role !== "note")) { throw new Error("原文类型辨识方式无效"); }
		if(Task.SchemaVersion !== 1 || (Task.EditMode !== undefined && Task.EditMode !== "ai") || Task.Source.Version !== Target.Version || Task.WriteUnit.Version !== Target.Version || Task.Source.Pdf || Task.WriteUnit.Pdf) { throw new Error("修改来源版本或类型无效"); }
		if(Record.Output) { validate_edit_mode(Task, parse_edit(JSON.stringify(Record.Output))); }
	}
	Seen.clear();
	for(const Plan of Data.Writes)
	{
		if(Plan.UndoPending !== undefined && (typeof Plan.UndoPending !== "boolean" || (Plan.UndoPending && Plan.State !== "applied"))) { throw new Error("修改撤销日志损坏"); }
		const Record = Data.Records.find(Value => Value.Spec.Id === Plan.TaskId);
		if(!Record || Seen.has(Plan.Id) || typeof Plan.Id !== "string" || !["preview", "pending", "applied", "undone", "conflict"].includes(Plan.State) || typeof Plan.After !== "string" || Plan.After.length > 550000 || typeof Plan.Rationale !== "string" || !Record.Output || JSON.stringify(Plan.Target) !== JSON.stringify(resolve_edit_target(Record.Spec, Record.Output))) { throw new Error("修改写回日志损坏"); }
		const Target = Plan.Target, Range = Target.Range!;
		if(Record.Output?.status !== "proposal" || Plan.After !== Target.Before!.slice(0, Range.From) + Record.Output.markdown! + Target.Before!.slice(Range.To)) { throw new Error("修改稿与原始提案不一致"); }
		Seen.add(Plan.Id);
	}
}

export interface EditPersistence
{
	save(Data: EditData): Promise<void>;
	close(): void;
}

export class EditStore
{
	Data: EditData;
	readonly Key: string;
	private PreviousKey: string;
	Generation = 0;
	private Queue: Promise<void> = Promise.resolve();
	private Closed = false;
	constructor(private Storage: LocalStorageLike, Vault: string, Initial?: EditData, private Persistence?: EditPersistence)
	{
		this.Key = `codex-sidebar-edits:v2:${Vault}`;
		this.PreviousKey = `codex-sidebar-edits:v1:${Vault}`;
		const Raw = Initial ? null : Storage.getItem(this.Key), Previous = Initial || Raw ? null : Storage.getItem(this.PreviousKey);
		this.Data = Initial ? structuredClone(Initial) : Raw ? JSON.parse(Raw) : Previous ? JSON.parse(Previous) : { schemaVersion: 2, DeviceId: crypto.randomUUID(), Records: [], Writes: [] };
		if(Previous) { if((this.Data as { schemaVersion: number }).schemaVersion !== 1 || this.Data.Records.some(Value => Value.Spec.EditMode !== undefined || Value.Spec.EditRoleMode !== undefined || (Value.Output && "original" in Value.Output))) { throw new Error("旧版修改记录损坏, 不覆盖原记录"); } this.Data.schemaVersion = 2; }
		validate_edits(this.Data);
	}
	change(Update: (Data: EditData) => void): void | Promise<void>
	{
		if(this.Closed) { throw new Error("修改记录已关闭, 拒绝迟到操作"); }
		if(this.Persistence)
		{
			const Pending = this.Queue.then(async () =>
			{
				const Next = structuredClone(this.Data); Update(Next); validate_edits(Next);
				await this.Persistence!.save(Next);
				this.Data = Next;
			});
			this.Queue = Pending.catch(() => {});
			return Pending;
		}
		const Next = structuredClone(this.Data); Update(Next); validate_edits(Next);
		const Raw = JSON.stringify(Next);
		this.Storage.setItem(this.Key, Raw); this.Data = Next;
	}
	clear(): void | Promise<void>
	{
		this.Generation++;
		const Pending = this.change(Data =>
		{
			Data.Writes = Data.Writes.filter(Value => Value.State === "pending" || Value.UndoPending);
			Data.Records = Data.Records.filter(Value => Data.Writes.some(Plan => Plan.TaskId === Value.Spec.Id));
		});
		const Cleanup = () =>
		{
			if(this.Persistence && this.Storage.getItem(this.Key)) { this.Storage.setItem(this.Key, ""); }
			if(this.Storage.getItem(this.PreviousKey)) { this.Storage.setItem(this.PreviousKey, ""); }
		};
		if(Pending) { return Pending.then(Cleanup); }
		Cleanup();
	}
	async close(): Promise<void> { this.Closed = true; await this.Queue; this.Persistence?.close(); }
	export_records(): string { return JSON.stringify(this.Data, null, 2); }
}
