import type { LocalStorageLike, WritePlan } from "../study/store";
import type { TaskSpec } from "../study/task";
import { note_path } from "../study/document";
import { valid_range } from "../study/writer";
import { parse_edit, type EditOutput } from "./protocol";

export interface EditRecord
{
	Spec: TaskSpec;
	Status: "pending" | "complete" | "rejected" | "cancelled";
	Output?: EditOutput;
	Error?: string;
}
export interface EditData
{
	schemaVersion: 1;
	DeviceId: string;
	Records: EditRecord[];
	Writes: WritePlan[];
}

export function validate_edits(Data: EditData): void
{
	if(!Data || Data.schemaVersion !== 1 || typeof Data.DeviceId !== "string" || !Array.isArray(Data.Records) || !Array.isArray(Data.Writes) || Data.Records.length > 50 || Data.Writes.length > 50) { throw new Error("修改记录版本不支持或损坏, 原数据保留"); }
	const Seen = new Set<string>();
	for(const Record of Data.Records)
	{
		const Task = Record.Spec, Target = Task?.Target;
		if(!Task || typeof Task.Id !== "string" || Seen.has(Task.Id) || Task.Action !== "edit" || Task.Scope !== "note-edit" || typeof Task.Request !== "string" || Task.Request.length > 24000 || !Task.Source || !Task.WriteUnit || !Target || Target.Role !== "note" || Target.Operation !== "replace-range" || !valid_range(Target) || Target.Before!.length > 500000 || !/^[0-9a-f]{64}$/.test(Target.Version) || Target.Path !== Task.Source.Path || Target.Path !== Task.WriteUnit.Path || Task.WriteUnit.Text !== Target.Before!.slice(Target.Range!.From, Target.Range!.To) || !["note", "problem", "complete-answer", "outline", "lecture"].includes(Task.Role) || !["pending", "complete", "rejected", "cancelled"].includes(Record.Status)) { throw new Error("本设备修改目标或原文范围损坏"); }
		note_path(Target.Path); Seen.add(Task.Id);
		if(Task.SchemaVersion !== 1 || Task.Source.Version !== Target.Version || Task.WriteUnit.Version !== Target.Version || Task.Source.Pdf || Task.WriteUnit.Pdf) { throw new Error("修改来源版本或类型无效"); }
		if(Record.Output) { parse_edit(JSON.stringify(Record.Output)); }
	}
	Seen.clear();
	for(const Plan of Data.Writes)
	{
		const Record = Data.Records.find(Value => Value.Spec.Id === Plan.TaskId);
		if(!Record || Seen.has(Plan.Id) || typeof Plan.Id !== "string" || !["preview", "pending", "applied", "undone", "conflict"].includes(Plan.State) || typeof Plan.After !== "string" || Plan.After.length > 550000 || typeof Plan.Rationale !== "string" || JSON.stringify(Plan.Target) !== JSON.stringify(Record.Spec.Target)) { throw new Error("修改写回日志损坏"); }
		const Target = Record.Spec.Target!, Range = Target.Range!;
		if(Record.Output?.status !== "proposal" || Plan.After !== Target.Before!.slice(0, Range.From) + Record.Output.markdown! + Target.Before!.slice(Range.To)) { throw new Error("修改稿与原始提案不一致"); }
		Seen.add(Plan.Id);
	}
}

export class EditStore
{
	Data: EditData;
	readonly Key: string;
	Generation = 0;
	constructor(private Storage: LocalStorageLike, Vault: string)
	{
		this.Key = `codex-sidebar-edits:v1:${Vault}`;
		const Raw = Storage.getItem(this.Key);
		this.Data = Raw ? JSON.parse(Raw) : { schemaVersion: 1, DeviceId: crypto.randomUUID(), Records: [], Writes: [] };
		validate_edits(this.Data);
	}
	change(Update: (Data: EditData) => void): void
	{
		const Next = structuredClone(this.Data); Update(Next); validate_edits(Next);
		const Raw = JSON.stringify(Next);
		if(Raw.length > 2000000) { throw new Error("本设备修改记录已满, 请先导出并清除旧记录"); }
		this.Storage.setItem(this.Key, Raw); this.Data = Next;
	}
	clear(): void
	{
		this.Generation++;
		this.change(Data =>
		{
			Data.Writes = Data.Writes.filter(Value => Value.State === "pending");
			Data.Records = Data.Records.filter(Value => Data.Writes.some(Plan => Plan.TaskId === Value.Spec.Id));
		});
	}
	export_records(): string { return JSON.stringify(this.Data, null, 2); }
}
