import type { ContextSnapshot } from "../prompt";
import type { TaskSpec, WriteTarget } from "./task";
import type { EditOutput } from "./protocol";
import { edit_plan } from "./protocol";
import { validate_edits, type EditData, type EditRecord } from "./store";
import type { WritePlan } from "./write-types";

interface TextRef { TextId: string; }
type PackedSnapshot = Omit<ContextSnapshot, "Text" | "SelectedText"> & { Text: TextRef; SelectedText: TextRef };
type PackedTarget = Omit<WriteTarget, "Before"> & { Before: TextRef | null };
type PackedTask = Omit<TaskSpec, "Source" | "WriteUnit" | "Prerequisites" | "Target" | "Request"> & { Source: PackedSnapshot | null; WriteUnit?: PackedSnapshot; Prerequisites: PackedSnapshot[]; Target?: PackedTarget; Request: TextRef };
type PackedOutput = Omit<EditOutput, "markdown" | "original"> & { markdown: TextRef | null; original?: TextRef | null };
type PackedRecord = Omit<EditRecord, "Spec" | "Output"> & { Spec: PackedTask; Output?: PackedOutput };
export interface PackedEdits
{
	schemaVersion: 3;
	DeviceId: string;
	Records: PackedRecord[];
	Writes: Omit<WritePlan, "Target" | "After">[];
	Refs: string[];
}

async function text_id(Text: string): Promise<string>
{
	const Bytes = new Uint8Array(Text.length * 2);
	for(let Index = 0; Index < Text.length; Index++) { const Unit = Text.charCodeAt(Index); Bytes[Index * 2] = Unit & 255; Bytes[Index * 2 + 1] = Unit >>> 8; }
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Bytes)), Value => Value.toString(16).padStart(2, "0")).join("");
}

export async function pack_edits(Data: EditData): Promise<{ Data: PackedEdits; Texts: Map<string, string> }>
{
	validate_edits(Data);
	const Texts = new Map<string, string>(), Cache = new Map<string, Promise<TextRef>>();
	const Text = (Value: string): Promise<TextRef> =>
	{
		if(!Cache.has(Value)) { Cache.set(Value, text_id(Value).then(Id => { if(Texts.has(Id) && Texts.get(Id) !== Value) { throw new Error("修改文本摘要冲突, 保留原记录"); } Texts.set(Id, Value); return { TextId: Id }; })); }
		return Cache.get(Value)!;
	};
	const Snapshot = async (Value: ContextSnapshot): Promise<PackedSnapshot> => ({ ...structuredClone(Value), Text: await Text(Value.Text), SelectedText: await Text(Value.SelectedText) });
	const Records: PackedRecord[] = [];
	for(const Record of Data.Records)
	{
		const Value = structuredClone(Record), Task = Value.Spec;
		const Spec: PackedTask = { ...Task, Request: await Text(Task.Request), Source: Task.Source ? await Snapshot(Task.Source) : null, WriteUnit: Task.WriteUnit ? await Snapshot(Task.WriteUnit) : undefined, Prerequisites: await Promise.all(Task.Prerequisites.map(Snapshot)), Target: Task.Target ? { ...Task.Target, Before: Task.Target.Before === null ? null : await Text(Task.Target.Before) } : undefined };
		let Output: PackedOutput | undefined;
		if(Value.Output)
		{
			const { markdown, original, ...Meta } = Value.Output;
			Output = { ...Meta, markdown: markdown === null ? null : await Text(markdown), ...("original" in Value.Output ? { original: original == null ? null : await Text(original) } : {}) };
		}
		const { Spec: _Spec, Output: _Output, ...Meta } = Value;
		Records.push({ ...Meta, Spec, ...(Output ? { Output } : {}) });
	}
	const Writes = Data.Writes.map(({ Target: _Target, After: _After, ...Plan }) => structuredClone(Plan));
	return { Data: { schemaVersion: 3, DeviceId: Data.DeviceId, Records, Writes, Refs: [...Texts.keys()].sort() }, Texts };
}

export async function unpack_edits(Data: PackedEdits, Texts: Map<string, string>): Promise<EditData>
{
	if(!Data || Data.schemaVersion !== 3 || !Array.isArray(Data.Records) || !Array.isArray(Data.Writes) || !Array.isArray(Data.Refs) || new Set(Data.Refs).size !== Data.Refs.length) { throw new Error("修改记录索引版本不支持或损坏, 原数据保留"); }
	for(const Id of Data.Refs)
	{
		if(!/^[0-9a-f]{64}$/.test(Id) || typeof Texts.get(Id) !== "string" || await text_id(Texts.get(Id)!) !== Id) { throw new Error("修改记录文本缺失或校验失败, 原数据保留"); }
	}
	const Used = new Set<string>();
	const Text = (Ref: TextRef): string =>
	{
		if(!Ref || Object.keys(Ref).length !== 1 || typeof Ref.TextId !== "string" || !Data.Refs.includes(Ref.TextId) || !Texts.has(Ref.TextId)) { throw new Error("修改记录文本引用损坏, 原数据保留"); }
		Used.add(Ref.TextId); return Texts.get(Ref.TextId)!;
	};
	const Snapshot = (Value: PackedSnapshot): ContextSnapshot => ({ ...Value, Text: Text(Value.Text), SelectedText: Text(Value.SelectedText) });
	const Records: EditRecord[] = Data.Records.map(Value =>
	{
		const Task = structuredClone(Value.Spec);
		const Spec: TaskSpec = { ...Task, Request: Text(Task.Request), Source: Task.Source ? Snapshot(Task.Source) : null, WriteUnit: Task.WriteUnit ? Snapshot(Task.WriteUnit) : undefined, Prerequisites: Task.Prerequisites.map(Snapshot), Target: Task.Target ? { ...Task.Target, Before: Task.Target.Before === null ? null : Text(Task.Target.Before) } : undefined };
		let Output: EditOutput | undefined;
		if(Value.Output)
		{
			const { markdown, original, ...Meta } = Value.Output;
			Output = { ...Meta, markdown: markdown === null ? null : Text(markdown), ...("original" in Value.Output ? { original: original == null ? null : Text(original) } : {}) };
		}
		const { Spec: _Spec, Output: _Output, ...Meta } = Value;
		return { ...Meta, Spec, ...(Output ? { Output } : {}) };
	});
	const Writes = Data.Writes.map(Value =>
	{
		const Record = Records.find(Entry => Entry.Spec.Id === Value.TaskId);
		if(!Record?.Output) { throw new Error("修改日志缺少对应提案, 原数据保留"); }
		const Plan = edit_plan(Record.Spec, Record.Output);
		if(!Plan) { throw new Error("修改日志缺少可用修改稿, 原数据保留"); }
		return { ...Plan, ...Value };
	});
	const Result: EditData = { schemaVersion: 2, DeviceId: Data.DeviceId, Records, Writes };
	if(Used.size !== Data.Refs.length) { throw new Error("修改记录存在未绑定的文本引用"); }
	validate_edits(Result); return Result;
}
