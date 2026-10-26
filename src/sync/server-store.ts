import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonical_json, entity_key, SyncBudgets, type DeltaMutation, type EntityVersion, type SendOperation } from "./types";
import { merge_operations } from "./operations";
import { deleted_messages } from "../sessions";

interface Row extends EntityVersion { Key: string; Kind: DeltaMutation["Kind"]; SessionId?: string; MessageId?: string; Blob?: string; Deleted?: boolean; }
interface Journal
{
	SchemaVersion: 2; Identity: string; Client: string; Revision: number; ProtocolUsed: boolean;
	Rows: Row[]; Operations: SendOperation[]; Receipts: { Id: string; Digest: string; Result: any }[];
}
const hash = (Bytes: string | Uint8Array): string => createHash("sha256").update(Bytes).digest("hex");
const digest_id = (Id: unknown): string => { if(typeof Id !== "string" || !/^[0-9a-f]{64}$/.test(Id)) { throw new Error("内容摘要无效"); } return Id; };
const object_id = (Id: unknown): string => { if(typeof Id !== "string" || !Id || Id.length > 256 || /[\u0000-\u001f]/.test(Id)) { throw new Error("对象身份无效"); } return Id; };
function immutable_message(Value: any): string { return canonical_json({ Id: Value.Id, Role: Value.Role, Text: Value.Text, Prompt: Value.Prompt, Context: Value.Context, Quote: Value.Quote, Task: Value.Task, OperationId: Value.OperationId }); }
function durable_write(File: string, Text: string): void
{
	const Temp = File + ".tmp", Handle = openSync(Temp, "w", 0o600);
	try { writeFileSync(Handle, Text); fsyncSync(Handle); } finally { closeSync(Handle); }
	if(readFileSync(Temp, "utf8") !== Text) { throw new Error("持久化候选读回失败"); } renameSync(Temp, File);
}

export class SyncServerStore
{
	Data: Journal;
	private File: string;
	private BlobDir: string;
	private ChunkDir: string;
	private Snapshots = new Map<number, Row[]>();
	constructor(Root: string, Client: string, LegacyFile?: string)
	{
		if(!/^[a-z0-9_-]{8,80}$/i.test(Client)) { throw new Error("设备身份无效"); }
		this.File = join(Root, Client + "-sync-v2.json"); this.BlobDir = join(Root, Client + "-blobs"); this.ChunkDir = join(Root, Client + "-upload-parts");
		mkdirSync(this.BlobDir, { recursive: true }); mkdirSync(this.ChunkDir, { recursive: true });
		if(existsSync(this.File))
		{
			this.Data = this.decode(JSON.parse(readFileSync(this.File, "utf8"))); this.validate(this.Data);
			if(this.Data.Client !== Client) { throw new Error("同步日志属于其他配对身份"); }
			for(const Row of this.Data.Rows) { if(Row.Blob) { this.value(Row.Blob); } }
			let Changed = false;
			for(const Operation of this.Data.Operations) { if(Operation.Status === "running") { Operation.Status = "submission-unknown"; Operation.Revision = ++this.Data.Revision; Operation.Origin = this.Scope; Operation.Error = "桥重启后不能证明旧运行回合仍在执行, 已保存接收凭证与回合 ID; 不自动重发"; Changed = true; } }
			if(Changed) { this.save(); }
			return;
		}
		this.Data = { SchemaVersion: 2, Identity: randomUUID(), Client, Revision: 0, ProtocolUsed: false, Rows: [], Operations: [], Receipts: [] };
		if(LegacyFile && existsSync(LegacyFile))
		{
			const Raw = readFileSync(LegacyFile, "utf8"), Legacy = JSON.parse(Raw);
			if(!Array.isArray(Legacy.Sessions) || !Legacy.Settings || Legacy.SchemaVersion !== undefined && Legacy.SchemaVersion !== 2) { throw new Error("旧远程状态结构或版本无效, 原文件保留"); }
			const Backup = LegacyFile + ".before-sync-v2"; if(!existsSync(Backup)) { copyFileSync(LegacyFile, Backup); }
			if(readFileSync(Backup, "utf8") !== Raw || readFileSync(LegacyFile, "utf8") !== Raw) { throw new Error("旧远程状态备份不一致或发生并发变化, 未切换"); }
			this.import_state(Legacy); this.validate(this.Data);
		}
		this.save();
		const Readback = this.decode(JSON.parse(readFileSync(this.File, "utf8"))); if(canonical_json(Readback) !== canonical_json(this.Data)) { throw new Error("同步迁移回读不一致, 旧文件保留"); }
	}
	get Scope(): string { return this.Data.Identity + ":" + this.Data.Client; }
	private validate(Data: Journal): void
	{
		if(Data.SchemaVersion !== 2 || typeof Data.Identity !== "string" || !Number.isSafeInteger(Data.Revision) || Data.Revision < 0 || !Array.isArray(Data.Rows) || !Array.isArray(Data.Operations) || !Array.isArray(Data.Receipts)) { throw new Error("同步日志损坏, 原数据保留"); }
		if(!Data.Identity || Data.Identity.length > 128 || typeof Data.Client !== "string" || !/^[a-z0-9_-]{8,80}$/i.test(Data.Client)) { throw new Error("同步日志作用域身份损坏"); }
		const Seen = new Set<string>();
		for(const Row of Data.Rows)
		{
			if(!Row.Key || Seen.has(Row.Key) || !["root", "settings", "session", "message", "session-delete", "message-delete"].includes(Row.Kind) || Row.Key !== entity_key(Row.Kind, Row.SessionId, Row.MessageId) || !Number.isSafeInteger(Row.Revision) || Row.Revision < 1 || Row.Revision > Data.Revision || Row.Origin !== Data.Identity + ":" + Data.Client) { throw new Error("同步对象版本损坏"); }
			digest_id(Row.Digest); Seen.add(Row.Key);
			if(Row.Kind.endsWith("-delete")) { if(!Row.Deleted || Row.Blob) { throw new Error("删除标记结构无效"); } }
			else if(!Row.Blob || Row.Digest !== Row.Blob) { throw new Error("同步内容摘要与索引不一致"); }
		}
		Seen.clear();
		for(const O of Data.Operations)
		{
			if(!O || typeof O.Id !== "string" || Seen.has(O.Id) || O.Scope !== Data.Identity + ":" + Data.Client || !["local", "received", "submission-unknown", "running", "completed", "cancelled", "failed"].includes(O.Status) || O.Digest !== hash(canonical_json({ Scope: O.Scope, SessionId: O.SessionId, MessageId: O.MessageId, Input: O.Input })) || O.RequestDigest !== undefined && O.RequestDigest !== hash(canonical_json(O.Request)) || O.Revision !== undefined && (!Number.isSafeInteger(O.Revision) || O.Revision < 1 || O.Revision > Data.Revision || O.Origin !== O.Scope)) { throw new Error("发送操作日志损坏, 不执行推理"); } Seen.add(O.Id);
		}
	}
	private decode(Saved: any): Journal
	{
		if(Saved.OperationEncoding === undefined) { return Saved; }
		if(Saved.OperationEncoding !== 1 || !Array.isArray(Saved.Operations)) { throw new Error("发送操作存储版本不支持"); }
		const { OperationEncoding: _Encoding, ...Data } = Saved;
		Data.Operations = Saved.Operations.map((Value: any) => { const { InputBlob, RequestBlob, ...Meta } = Value; return { ...Meta, Input: this.value(InputBlob), ...(RequestBlob ? { Request: this.value(RequestBlob) } : {}) }; }); return Data;
	}
	private save(): void
	{
		this.validate(this.Data);
		const Operations = this.Data.Operations.map(O => { const { Input, Request, ...Meta } = O; return { ...Meta, InputBlob: this.store_value(Input), ...(Request ? { RequestBlob: this.store_value(Request) } : {}) }; });
		const Text = canonical_json({ ...this.Data, OperationEncoding: 1, Operations });
		if(existsSync(this.File)) { copyFileSync(this.File, this.File + ".last-committed"); }
		durable_write(this.File, Text);
	}
	private blob(Text: string): string
	{
		const Id = hash(Text), File = join(this.BlobDir, Id + ".json");
		if(!existsSync(File)) { durable_write(File, Text); }
		if(hash(readFileSync(File)) !== Id) { throw new Error("内容存储摘要冲突"); } return Id;
	}
	value(Id: string): any
	{
		const Text = readFileSync(join(this.BlobDir, digest_id(Id) + ".json"), "utf8");
		if(hash(Text) !== Id) { throw new Error("已保存内容摘要不匹配, 原文件保留, 不执行或覆盖"); }
		return JSON.parse(Text);
	}
	has_blob(Id: string): boolean { return existsSync(join(this.BlobDir, digest_id(Id) + ".json")); }
	blob_part(Id: string, Index: number): any
	{
		const Bytes = readFileSync(join(this.BlobDir, digest_id(Id) + ".json"));
		if(!Number.isSafeInteger(Index) || Index < 0 || Index >= Math.ceil(Bytes.length / 65536)) { throw new Error("内容分页无效"); }
		const Part = Bytes.subarray(Index * 65536, (Index + 1) * 65536); return { id: Id, index: Index, count: Math.ceil(Bytes.length / 65536), data: Part.toString("base64"), bytes: Bytes.length };
	}
	put_part(Input: any): any
	{
		const Id = digest_id(Input.id), Index = Input.index, Count = Input.count;
		if(this.has_blob(Id)) { return { present: true }; }
		if(!Number.isSafeInteger(Count) || Count < 1 || Count > 1024 || !Number.isSafeInteger(Index) || Index < 0 || Index >= Count || typeof Input.data !== "string" || Input.data.length > 90000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(Input.data)) { throw new Error("内容分片格式无效或超过预算"); }
		const Part = Buffer.from(Input.data, "base64"); if(Part.length > 65536) { throw new Error("内容分片超过字节预算"); }
		const Directory = join(this.ChunkDir, Id); mkdirSync(Directory, { recursive: true });
		const Meta = join(Directory, "count"); if(existsSync(Meta) && readFileSync(Meta, "utf8") !== String(Count)) { throw new Error("内容分片总数冲突"); } writeFileSync(Meta, String(Count));
		const File = join(Directory, String(Index)); if(existsSync(File) && !readFileSync(File).equals(Part)) { throw new Error("相同内容分片身份不同内容"); } writeFileSync(File, Part, { mode: 0o600 });
		if(Array.from({ length: Count }, (_, I) => existsSync(join(Directory, String(I)))).every(Boolean))
		{
			const Bytes = Buffer.concat(Array.from({ length: Count }, (_, I) => readFileSync(join(Directory, String(I)))));
			if(hash(Bytes) !== Id) { throw new Error("内容分片摘要不匹配, 保留部分数据待恢复"); } const Text = new TextDecoder("utf-8", { fatal: true }).decode(Bytes); JSON.parse(Text);
			this.blob(Text); for(let I = 0; I < Count; I++) { unlinkSync(join(Directory, String(I))); } unlinkSync(Meta); rmdirSync(Directory);
			return { present: true };
		}
		return { present: false };
	}
	private put(Kind: Row["Kind"], Value: any, SessionId = "", MessageId = ""): void
	{
		if(Kind === "message" && (this.deleted_session(SessionId) || this.is_message_deleted(SessionId, MessageId))) { return; }
		if(Kind === "message") { const { SyncVersion: _Version, ...Content } = Value; Value = Content; }
		if(Kind === "root") { const { Sync: _Sync, Outbox: _Outbox, Sessions: _Sessions, Settings: _Settings, ...Content } = Value; Value = Content; }
		const Key = entity_key(Kind, SessionId, MessageId), Blob = this.blob(canonical_json(Value)), Old = this.Data.Rows.find(R => R.Key === Key);
		if(Old?.Blob === Blob) { return; }
		const Row: Row = { Key, Kind, ...(SessionId ? { SessionId } : {}), ...(MessageId ? { MessageId } : {}), Revision: ++this.Data.Revision, Origin: this.Scope, Digest: Blob, Blob };
		if(Old) { Object.assign(Old, Row); } else { this.Data.Rows.push(Row); }
	}
	import_state(State: any): void
	{
		for(const M of deleted_messages(State.DeletedMessages)) { this.delete_row("message-delete", object_id(M.SessionId), object_id(M.MessageId)); }
		const { Sessions, Settings, Sync: _Sync, Outbox: _Outbox, ...Root } = State; this.put("root", Root); this.put("settings", Settings ?? {});
		for(const Session of Sessions ?? [])
		{
			if(this.deleted_session(Session.Id)) { continue; }
			const { Messages, ...Meta } = Session; this.put("session", Meta, object_id(Session.Id));
			for(const Message of Messages ?? []) { this.put("message", Message, Session.Id, object_id(Message.Id)); }
		}
		for(const Id of State.DeletedSessionIds ?? []) { this.delete_row("session-delete", Id); }
	}
	private deleted_session(Id: string): boolean { return this.Data.Rows.some(R => R.Kind === "session-delete" && R.SessionId === Id); }
	is_deleted(Id: string): boolean { return this.deleted_session(Id); }
	is_message_deleted(SessionId: string, MessageId: string): boolean { return this.Data.Rows.some(R => R.Kind === "message-delete" && R.SessionId === SessionId && R.MessageId === MessageId); }
	store_value(Value: unknown): string { return this.blob(canonical_json(Value)); }
	message_version(SessionId: string, MessageId: string): { blob: string; version: EntityVersion } | null
	{
		if(this.deleted_session(SessionId) || this.is_message_deleted(SessionId, MessageId)) { return null; }
		const Row = this.Data.Rows.find(R => R.Key === entity_key("message", SessionId, MessageId));
		return Row?.Blob ? { blob: Row.Blob, version: { Revision: Row.Revision, Digest: Row.Digest, Origin: Row.Origin } } : null;
	}
	private delete_row(Kind: "session-delete" | "message-delete", SessionId: string, MessageId = ""): void
	{
		const Key = entity_key(Kind, SessionId, MessageId); if(this.Data.Rows.some(R => R.Key === Key)) { return; }
		this.Data.Rows.push({ Key, Kind, SessionId, ...(MessageId ? { MessageId } : {}), Revision: ++this.Data.Revision, Origin: this.Scope, Digest: hash(Key), Deleted: true });
		for(const O of this.Data.Operations)
		{
			if(O.SessionId !== SessionId || Kind === "message-delete" && O.MessageId !== MessageId) { continue; }
			if(Kind === "session-delete") { O.SessionDeleted = true; } else { O.MessageDeleted = true; }
			if(O.Status === "received" || O.Status === "local") { O.Status = "cancelled"; } O.Revision = ++this.Data.Revision; O.Origin = this.Scope;
		}
	}
	materialize(): any
	{
		const Root = this.Data.Rows.find(R => R.Kind === "root"), Settings = this.Data.Rows.find(R => R.Kind === "settings");
		const Result: any = { ...(Root?.Blob ? this.value(Root.Blob) : {}), Settings: Settings?.Blob ? this.value(Settings.Blob) : {}, Sessions: [] };
		for(const Row of this.Data.Rows.filter(R => R.Kind === "session" && !this.deleted_session(R.SessionId!)))
		{
			const Session = this.value(Row.Blob!); Session.Messages = this.Data.Rows.filter(R => R.Kind === "message" && R.SessionId === Session.Id && !this.Data.Rows.some(D => D.Kind === "message-delete" && D.SessionId === R.SessionId && D.MessageId === R.MessageId)).map(R => ({ ...this.value(R.Blob!), SyncVersion: { Revision: R.Revision, Digest: R.Digest, Origin: this.Scope } })); Result.Sessions.push(Session);
		}
		const Deleted = this.Data.Rows.filter(R => R.Kind === "session-delete").map(R => R.SessionId!); if(Deleted.length) { Result.DeletedSessionIds = Deleted; }
		const Messages = this.Data.Rows.filter(R => R.Kind === "message-delete").map(R => ({ SessionId: R.SessionId!, MessageId: R.MessageId! })); if(Messages.length) { Result.DeletedMessages = Messages; }
		return Result;
	}
	legacy_write(State: any): any
	{
		if(this.Data.ProtocolUsed) { throw new Error("此设备已启用增量同步, 旧版整份 /state 写入被拒绝; 请升级客户端, 原数据保留"); }
		this.import_state(State); this.save(); return this.materialize();
	}
	page(Kind: "catalog" | "history", Revision: number | null, Offset: number, SessionId?: string): any
	{
		if(Revision === null)
		{
			Revision = this.Data.Revision; if(!this.Snapshots.has(Revision)) { this.Snapshots.set(Revision, structuredClone(this.Data.Rows)); }
			if(this.Snapshots.size > 8) { this.Snapshots.delete(this.Snapshots.keys().next().value!); }
		}
		const Snapshot = this.Snapshots.get(Revision);
		if(!Snapshot) { throw new Error("一致性快照已变化或过期, 请重新获取第一页"); }
		if(!Number.isSafeInteger(Offset) || Offset < 0) { throw new Error("同步分页位置无效"); }
		const Rows = Snapshot.filter(R => Kind === "history" ? R.Kind === "message" && R.SessionId === SessionId : R.Kind !== "message");
		const Values: Row[] = []; let Bytes = 512;
		for(const Row of Rows.slice(Offset, Offset + SyncBudgets.historyPage)) { const Size = Buffer.byteLength(canonical_json(Row)); if(Bytes + Size > SyncBudgets.pageBytes) { break; } Values.push(Row); Bytes += Size; }
		const Next = Offset + Values.length; return { schemaVersion: 2, scope: this.Scope, revision: Revision, rows: Values, next: Next < Rows.length ? Next : null };
	}
	delta(Body: any): any
	{
		if(Body.scope !== this.Scope) { throw new Error("增量同步作用域不匹配"); }
		const Id = object_id(Body.id), Digest = hash(canonical_json(Body)), Receipt = this.Data.Receipts.find(R => R.Id === Id);
		if(Receipt) { if(Receipt.Digest !== Digest) { throw new Error("增量操作 ID 被不同输入复用"); } return Receipt.Result; }
		if(!Array.isArray(Body.mutations) || Body.mutations.length > SyncBudgets.deltaMutations) { throw new Error("增量超出对象预算"); }
		if(!Number.isSafeInteger(Body.baseRevision) || Body.baseRevision < 0 || Body.baseRevision > this.Data.Revision) { return { ok: false, conflict: true, revision: this.Data.Revision }; }
		const Next = structuredClone(this.Data), Conflicts: any[] = [], Seen = new Set<string>();
		for(const M of Body.mutations as DeltaMutation[])
		{
			if(!["root", "settings", "session", "message", "session-delete", "message-delete"].includes(M.Kind) || M.Key !== entity_key(M.Kind, M.SessionId, M.MessageId)) { throw new Error("未知同步操作或对象定位无效"); }
			if(Seen.has(M.Key) || !Number.isSafeInteger(M.Expected) || M.Expected < 0 || (["root", "settings"].includes(M.Kind) ? !!M.SessionId || !!M.MessageId : M.Kind === "session" || M.Kind === "session-delete" ? !M.SessionId || !!M.MessageId : !M.SessionId || !M.MessageId)) { throw new Error("重复或模糊同步目标、基准版本无效"); } Seen.add(M.Key);
			if(M.SessionId) { object_id(M.SessionId); } if(M.MessageId) { object_id(M.MessageId); }
			const Old = this.Data.Rows.find(R => R.Key === M.Key);
			let Compatible = false;
			if(Old?.Blob && M.Blob && M.Kind === "message")
			{
				const Current = this.value(Old.Blob), Incoming = this.value(M.Blob);
				Compatible = Current.Role === "user" && Incoming.Role === "user" && immutable_message(Current) === immutable_message(Incoming);
				if(Current.Role === "user" && Incoming.Role === "user" && !Compatible) { Conflicts.push({ key: M.Key, expected: M.Expected, current: Old, reason: "已发送输入不可在原消息身份下改写, 请保留双方并分支" }); continue; }
			}
			if((Old?.Revision ?? 0) !== M.Expected && !Compatible) { Conflicts.push({ key: M.Key, expected: M.Expected, current: Old ?? null }); }
			if(M.Blob) { this.value(M.Blob); }
		}
		if(Conflicts.length) { return { ok: false, conflict: true, revision: this.Data.Revision, conflicts: Conflicts }; }
		try
		{
			for(const M of Body.mutations as DeltaMutation[])
			{
				if(M.Kind === "session-delete" || M.Kind === "message-delete") { this.delete_row(M.Kind, object_id(M.SessionId), M.MessageId); }
				else
				{
					if(M.SessionId && this.deleted_session(M.SessionId)) { continue; }
					if(!M.Blob) { throw new Error("同步对象缺少已上传内容"); } let Value = this.value(M.Blob);
					const Existing = this.Data.Rows.find(R => R.Key === M.Key);
					if(M.Kind === "message" && Value.Role === "user" && Existing?.Blob)
					{
						const Current = this.value(Existing.Blob), Incoming = Value; Value = { ...Current, ...Incoming };
						if(Current.TurnId) { Value.TurnId = Current.TurnId; } if(Current.CompletionStatus) { Value.CompletionStatus = Current.CompletionStatus; }
						if(Current.Sources?.length || Incoming.Sources?.length) { const Sources = new Map<string, unknown>(); for(const Source of [...(Current.Sources ?? []), ...(Incoming.Sources ?? [])]) { Sources.set(Source.Id, Source); } Value.Sources = [...Sources.values()]; }
						if(!Current.TurnId && this.Data.Operations.some(O => O.SessionId === M.SessionId && O.MessageId === M.MessageId && O.TurnId)) { Value.TurnId = this.Data.Operations.find(O => O.SessionId === M.SessionId && O.MessageId === M.MessageId && O.TurnId)!.TurnId; }
					}
					if(M.Kind === "message" && (Value.Id !== M.MessageId || !["user", "assistant", "reasoning", "system"].includes(Value.Role) || typeof Value.Text !== "string")) { throw new Error("消息对象无效"); }
					if(M.Kind === "session" && Value.Id !== M.SessionId) { throw new Error("会话对象无效"); }
					this.put(M.Kind, Value, M.SessionId, M.MessageId);
				}
			}
			this.Data.ProtocolUsed = true;
			const Result = { ok: true, revision: this.Data.Revision, versions: this.Data.Rows.filter(R => Body.mutations.some((M: DeltaMutation) => M.Key === R.Key)).map(R => ({ key: R.Key, version: { Revision: R.Revision, Digest: R.Digest, Origin: R.Origin } })) };
			this.Data.Receipts.push({ Id, Digest, Result }); this.save(); return Result;
		}
		catch(ErrorValue) { this.Data = Next; throw ErrorValue; }
	}
	operation(Id: string): SendOperation | null { return structuredClone(this.Data.Operations.find(O => O.Id === Id) ?? null); }
	put_operation(Operation: SendOperation): void
	{
		const Old = this.Data.Operations.find(O => O.Id === Operation.Id);
		if(Old && (Old.Digest !== Operation.Digest || Old.Scope !== Operation.Scope)) { throw new Error("操作 ID 的输入摘要或作用域冲突"); }
		const Candidate = { ...structuredClone(Operation), Revision: this.Data.Revision + 1, Origin: this.Scope };
		const Next = Old ? merge_operations([Old], [Candidate])[0] : Candidate;
		if(Old && canonical_json(Old) === canonical_json(Next)) { return; }
		Next.Revision = ++this.Data.Revision; Next.Origin = this.Scope;
		if(Old) { Object.assign(Old, Next); } else { this.Data.Operations.push(Next); }
		this.Data.ProtocolUsed = true; this.save();
	}
	observe_message(SessionId: string, Message: any): void
	{
		if(this.deleted_session(SessionId)) { return; } this.put("message", Message, SessionId, Message.Id); this.save();
	}
}
