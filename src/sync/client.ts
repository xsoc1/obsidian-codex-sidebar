import { deleted_messages, restore_sessions, type SessionState } from "../sessions";
import { canonical_json, client_sync, content_digest, entity_key, SyncBudgets, type ClientSync, type DeltaMutation, type EntityVersion, type SendOperation } from "./types";
import { merge_operations } from "./operations";

type Http = (Path: string, Method: string, Body?: unknown) => Promise<any>;
const bytes = (Value: unknown) => new TextEncoder().encode(canonical_json(Value));
const base64 = (Value: Uint8Array): string => { let Text = ""; for(let I = 0; I < Value.length; I += 16000) { Text += String.fromCharCode(...Value.subarray(I, I + 16000)); } return btoa(Text); };
const unbase64 = (Value: string): Uint8Array => Uint8Array.from(atob(Value), C => C.charCodeAt(0));
function normalized(Value: any): any { const { SyncVersion: _Version, ...Content } = Value; return Content; }

export class DeltaSyncClient
{
	private Blobs = new Map<string, any>();
	private Uploaded = new Set<string>();
	private Mutations = new Set<string>();
	private Versions: Record<string, EntityVersion> = {};
	private Revision = 0;
	private SettingsBaseline: string | null = null;
	private SettingsExpected: number | undefined;
	Conflicts: { Key: string; Reason: string; Local: unknown; Remote: unknown }[] = [];
	constructor(private Http: Http, readonly Scope: string) { }
	owns_mutation(Id: string): boolean { return this.Mutations.has(Id); }
	private adopt_versions(Versions: Record<string, EntityVersion> = {}): void
	{
		for(const [Key, Version] of Object.entries(Versions))
		{
			if(Version.Origin !== this.Scope) { continue; }
			const Current = this.Versions[Key]; if(!Current || Version.Revision > Current.Revision) { this.Versions[Key] = structuredClone(Version); }
			else if(Version.Revision === Current.Revision && Version.Digest !== Current.Digest)
			{
				const Evidence = { Key, Reason: "相同服务器版本的内容摘要不同, 未猜选其一", Local: Current, Remote: Version };
				if(!this.Conflicts.some(C => canonical_json(C) === canonical_json(Evidence))) { this.Conflicts.push(Evidence); }
			}
		}
	}
	private async read_blob(Id: string): Promise<any>
	{
		if(!/^[0-9a-f]{64}$/.test(Id)) { throw new Error("同步内容摘要无效"); }
		if(this.Blobs.has(Id)) { return structuredClone(this.Blobs.get(Id)); }
		let Index = 0, Count = 1; const Parts: Uint8Array[] = []; let Total = 0;
		do
		{
			const Part = await this.Http(`/sync/blob?id=${Id}&index=${Index}`, "GET");
			if(Part.id !== Id || Part.index !== Index || !Number.isSafeInteger(Part.count) || Part.count < 1 || Part.count > 1024 || typeof Part.data !== "string" || Part.data.length > 90000) { throw new Error("同步内容分页损坏"); }
			Count = Part.count; const Decoded = unbase64(Part.data); Parts.push(Decoded); Total += Decoded.length; Index++;
		} while(Index < Count);
		const Combined = new Uint8Array(Total); let Offset = 0; for(const Part of Parts) { Combined.set(Part, Offset); Offset += Part.length; }
		const Value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Combined));
		if(await content_digest(Value) !== Id) { throw new Error("同步内容摘要不匹配, 保留本机状态"); } this.Blobs.set(Id, Value); this.Uploaded.add(Id); return structuredClone(Value);
	}
	async upload(Value: unknown, Signal?: AbortSignal): Promise<string>
	{
		if(Signal?.aborted) { throw new DOMException("发送准备已取消", "AbortError"); }
		const Id = await content_digest(Value); if(this.Uploaded.has(Id)) { return Id; }
		const Data = bytes(Value), Count = Math.max(1, Math.ceil(Data.length / SyncBudgets.blobChunkBytes));
		if(Data.length > SyncBudgets.maxBlobBytes) { throw new Error("单个同步内容超过 64 MiB 分片预算, 本机原文保留; 请分段处理"); }
		for(let Index = 0; Index < Count; Index++)
		{
			if(Signal?.aborted) { throw new DOMException("发送准备已取消", "AbortError"); }
			const Body = { id: Id, index: Index, count: Count, data: base64(Data.subarray(Index * SyncBudgets.blobChunkBytes, (Index + 1) * SyncBudgets.blobChunkBytes)) };
			if(bytes(Body).length > SyncBudgets.pageBytes) { throw new Error("同步分片超过 UTF-8 字节预算"); } await this.Http("/sync/blob", "POST", Body);
		}
		this.Uploaded.add(Id); this.Blobs.set(Id, structuredClone(Value)); return Id;
	}
	private async pages(Path: string, Revision?: number): Promise<{ Rows: any[]; Revision: number; Cursor: number }>
	{
		const Rows: any[] = []; let Offset: number | null = 0, Current = Revision, Cursor = 0;
		do
		{
			const Sep = Path.includes("?") ? "&" : "?", Page = await this.Http(Path + Sep + "offset=" + Offset + (Current === undefined ? "" : "&revision=" + Current), "GET");
			if(Page.schemaVersion !== 2 || Page.scope !== this.Scope || !Array.isArray(Page.rows) || !Number.isSafeInteger(Page.revision) || (Current !== undefined && Page.revision !== Current) || (Page.next !== null && (!Number.isSafeInteger(Page.next) || Page.next <= Offset!))) { throw new Error("一致性同步分页无效"); }
			Current = Page.revision; Cursor = Page.cursor; Rows.push(...Page.rows); Offset = Page.next;
		} while(Offset !== null);
		return { Rows, Revision: Current!, Cursor };
	}
	async restore<T extends SessionState>(Local: T, Linked: readonly string[] = [], FollowLocal = true): Promise<{ State: T; Cursor: number }>
	{
		if(Local.Sync && Local.Sync.Scope !== this.Scope)
		{
			if(Local.Sync.Scope !== "legacy:" + this.Scope.split(":").at(-1)) { throw new Error("远程稳定身份已改变, 本机数据未覆盖; 请核对配对连接"); }
			Local = { ...Local, Sync: { ...structuredClone(Local.Sync), Scope: this.Scope, Versions: {}, Revision: 0 } };
		}
		for(let Attempt = 0; Attempt < 3; Attempt++)
		{
			try
			{
				const Catalog = await this.pages("/sync/catalog"), Rows = Catalog.Rows, SessionRows = Rows.filter(R => R.Kind === "session");
				for(const Row of SessionRows) { const Page = await this.pages("/sync/history?session=" + encodeURIComponent(Row.SessionId), Catalog.Revision); Rows.push(...Page.Rows); }
				const Root = Rows.find(R => R.Kind === "root"), Settings = Rows.find(R => R.Kind === "settings"), Remote: any = { ...(Root?.Blob ? await this.read_blob(Root.Blob) : {}), Settings: Settings?.Blob ? await this.read_blob(Settings.Blob) : {}, Sessions: [] };
				const Deleted = new Set(Rows.filter(R => R.Kind === "session-delete").map(R => R.SessionId)), DeletedMessages = new Set(Rows.filter(R => R.Kind === "message-delete").map(R => entity_key("message", R.SessionId, R.MessageId)));
				const Versions: Record<string, EntityVersion> = {};
				for(const Row of Rows) { if(typeof Row.Key !== "string" || !Number.isSafeInteger(Row.Revision) || Row.Revision < 1 || Row.Revision > Catalog.Revision || !/^[0-9a-f]{64}$/.test(Row.Digest) || Row.Origin !== this.Scope) { throw new Error("同步对象版本校验失败"); } Versions[Row.Key] = { Revision: Row.Revision, Digest: Row.Digest, Origin: Row.Origin }; }
				for(const Row of SessionRows.filter(R => !Deleted.has(R.SessionId)))
				{
					const Session = await this.read_blob(Row.Blob); Session.Messages = [];
					for(const M of Rows.filter(R => R.Kind === "message" && R.SessionId === Row.SessionId && !DeletedMessages.has(R.Key))) { Session.Messages.push({ ...await this.read_blob(M.Blob), SyncVersion: Versions[M.Key] }); }
					Remote.Sessions.push(Session);
				}
				if(Deleted.size) { Remote.DeletedSessionIds = [...Deleted]; }
				const MessageMarkers = Rows.filter(R => R.Kind === "message-delete").map(R => ({ SessionId: R.SessionId, MessageId: R.MessageId })); if(MessageMarkers.length) { Remote.DeletedMessages = deleted_messages(MessageMarkers); }
				const Operations = await this.operation_pages();
				Remote.Sync = { ...client_sync(this.Scope), Revision: Catalog.Revision, Versions, Operations };
				const State = restore_sessions(Local, Remote, Linked, FollowLocal) as T;
				const Conflicts = [...(State.Sync?.Conflicts ?? State.MessageConflicts ?? [])];
				State.Sync = { ...Remote.Sync, Operations: merge_operations(Local.Sync?.Operations, Operations, Conflicts), Conflicts }; delete State.MessageConflicts;
				const SettingsDigest = await content_digest((Local as any).Settings ?? {}), PreviousDigest = Local.Sync?.SettingsDigest;
				const Dirty = PreviousDigest !== undefined && SettingsDigest !== PreviousDigest;
				const ExpectedSettings = Dirty ? Local.Sync?.SettingsRevision ?? Local.Sync?.Versions[entity_key("settings")]?.Revision ?? 0 : Settings?.Revision ?? 0;
				if(this.SettingsExpected === undefined || ExpectedSettings >= this.SettingsExpected) { this.SettingsBaseline = Dirty ? PreviousDigest : SettingsDigest; this.SettingsExpected = ExpectedSettings; }
				State.Sync!.SettingsDigest = this.SettingsBaseline ?? undefined; State.Sync!.SettingsRevision = this.SettingsExpected;
				for(const C of State.Sync!.Conflicts) { if(!this.Conflicts.some(P => canonical_json(P) === canonical_json(C))) { this.Conflicts.push(C); } }
				this.adopt_versions(Local.Sync?.Versions); this.adopt_versions(Versions); this.Revision = Math.max(this.Revision, Local.Sync?.Revision ?? 0, Catalog.Revision);
				State.Sync!.Conflicts = structuredClone(this.Conflicts); State.Sync!.Versions = structuredClone(this.Versions); State.Sync!.Revision = this.Revision;
				return { State, Cursor: Catalog.Cursor };
			}
			catch(ErrorValue) { if(Attempt === 2 || !/一致性快照已变化|快照.*过期/.test(String(ErrorValue))) { throw ErrorValue; } }
		}
		throw new Error("同步快照未取得");
	}
	async sync(State: any): Promise<void>
	{
		if(State.Sync && State.Sync.Scope !== this.Scope) { throw new Error("同步状态跨连接作用域, 未上传"); }
		for(const Conflict of State.Sync?.Conflicts ?? []) { if(!this.Conflicts.some(C => canonical_json(C) === canonical_json(Conflict))) { this.Conflicts.push(structuredClone(Conflict)); } }
		this.adopt_versions(State.Sync?.Versions); this.Revision = Math.max(this.Revision, State.Sync?.Revision ?? 0);
		const Work: DeltaMutation[] = [], Deleted = new Set<string>(State.DeletedSessionIds ?? []);
		const MessageMarkers = deleted_messages(State.DeletedMessages), MessageKeys = new Set(MessageMarkers.map(M => entity_key("message", M.SessionId, M.MessageId)));
		const Add = async (Kind: DeltaMutation["Kind"], Value: unknown, SessionId = "", MessageId = "") =>
		{
			const Key = entity_key(Kind, SessionId, MessageId), Version = this.Versions[Key] ?? State.Sync?.Versions?.[Key];
			if(Kind.endsWith("-delete")) { if(!Version) { Work.push({ Key, Kind, SessionId, ...(MessageId ? { MessageId } : {}), Expected: 0 }); } return; }
			const Digest = await content_digest(Value); if(Version?.Digest === Digest) { return; }
			const Blob = await this.upload(Value); Work.push({ Key, Kind, ...(SessionId ? { SessionId } : {}), ...(MessageId ? { MessageId } : {}), Expected: Version?.Revision ?? 0, Blob });
		};
		for(const Id of Deleted) { await Add("session-delete", null, Id); }
		for(const M of MessageMarkers) { await Add("message-delete", null, M.SessionId, M.MessageId); }
		const { Sessions, Settings, Sync: _Sync, Outbox: _Outbox, ...Root } = State;
		await Add("root", Root);
		const SettingsKey = entity_key("settings"), SettingsDigest = await content_digest(Settings ?? {}), SettingsVersion = this.Versions[SettingsKey] ?? State.Sync?.Versions?.[SettingsKey];
		if(this.SettingsBaseline === null) { this.SettingsBaseline = State.Sync?.SettingsDigest ?? SettingsVersion?.Digest ?? null; this.SettingsExpected = State.Sync?.SettingsRevision ?? SettingsVersion?.Revision ?? 0; }
		if(!SettingsVersion || SettingsDigest !== this.SettingsBaseline)
		{
			Work.push({ Key: SettingsKey, Kind: "settings", Expected: this.SettingsExpected ?? 0, Blob: await this.upload(Settings ?? {}) });
		}
		for(const Session of Sessions ?? [])
		{
			if(Deleted.has(Session.Id)) { continue; } const { Messages, ...Meta } = Session; await Add("session", Meta, Session.Id);
			for(const Message of Messages ?? [])
			{
				if(MessageKeys.has(entity_key("message", Session.Id, Message.Id))) { continue; }
				if(Message.Role !== "user" && this.Versions[entity_key("message", Session.Id, Message.Id)]) { continue; }
				await Add("message", normalized(Message), Session.Id, Message.Id);
			}
		}
		for(let Offset = 0; Offset < Work.length; Offset += SyncBudgets.deltaMutations)
		{
			const Body = { scope: this.Scope, id: crypto.randomUUID(), baseRevision: this.Revision, mutations: Work.slice(Offset, Offset + SyncBudgets.deltaMutations) };
			if(bytes(Body).length > SyncBudgets.requestBytes) { throw new Error("增量请求超过 UTF-8 字节预算, 未提交"); }
			this.Mutations.add(Body.id); if(this.Mutations.size > 256) { this.Mutations.delete(this.Mutations.values().next().value!); }
			const Result = await this.Http("/sync/delta", "POST", Body);
			if(!Result.ok)
			{
				for(const Conflict of Result.conflicts ?? [])
				{
					const Mutation = Body.mutations.find(M => M.Key === Conflict.key), Remote = Conflict.current?.Blob ? await this.read_blob(Conflict.current.Blob) : Conflict.current ?? null;
					const Local = Mutation?.Blob ? await this.read_blob(Mutation.Blob) : Mutation ?? null;
					const Evidence = { Key: Conflict.key, Reason: Conflict.reason ?? "对象版本已变化, 本次修改未覆盖远端", Local, Remote };
					if(!this.Conflicts.some(C => canonical_json(C) === canonical_json(Evidence))) { this.Conflicts.push(Evidence); }
					if(Conflict.key === SettingsKey) { this.SettingsExpected = Conflict.current?.Revision ?? 0; this.SettingsBaseline = SettingsDigest; }
				}
				if(!State.Sync) { State.Sync = client_sync(this.Scope); }
				State.Sync.Conflicts = structuredClone(this.Conflicts); State.Sync.SettingsDigest = this.SettingsBaseline ?? undefined; State.Sync.SettingsRevision = this.SettingsExpected;
				throw new Error("远程版本冲突, 本机修改与远端证据均已保留; 请核对双方数据, 不自动覆盖");
			}
			this.Revision = Result.revision; for(const Version of Result.versions) { this.Versions[Version.key] = Version.version; }
			if(Body.mutations.some(M => M.Key === SettingsKey)) { this.SettingsBaseline = SettingsDigest; this.SettingsExpected = this.Versions[SettingsKey].Revision; }
		}
		if(!State.Sync) { State.Sync = client_sync(this.Scope); }
		State.Sync.Revision = this.Revision; State.Sync.Versions = structuredClone(this.Versions); State.Sync.SettingsDigest = this.SettingsBaseline ?? undefined; State.Sync.SettingsRevision = this.SettingsExpected; State.Sync.Conflicts = structuredClone(this.Conflicts);
	}
	private async operation_pages(): Promise<SendOperation[]>
	{
		const Operations: SendOperation[] = []; let Offset: number | null = 0, Snapshot: string | undefined;
		do
		{
			const Page = await this.Http("/operations?offset=" + Offset + (Snapshot ? "&snapshot=" + encodeURIComponent(Snapshot) : ""), "GET");
			if(!Array.isArray(Page.operations) || Page.operations.length > SyncBudgets.historyPage || (Page.next !== null && (!Number.isSafeInteger(Page.next) || Page.next <= Offset!)) || typeof Page.snapshot !== "string" || Snapshot !== undefined && Snapshot !== Page.snapshot) { throw new Error("发送操作分页无效"); }
			Snapshot = Page.snapshot; for(const Meta of Page.operations) { Operations.push(await this.expand_operation(Meta)); } Offset = Page.next;
		} while(Offset !== null);
		return Operations;
	}
	private async expand_operation(Meta: any): Promise<SendOperation>
	{
		if(Meta.Scope !== this.Scope) { throw new Error("发送操作来自其他作用域"); }
		const { InputBlob, RequestBlob, ResultBlob, ConflictsBlob, ...Data } = Meta; return { ...Data, Input: await this.read_blob(InputBlob), ...(RequestBlob ? { Request: await this.read_blob(RequestBlob) } : {}), ...(ResultBlob ? { Result: await this.read_blob(ResultBlob) } : {}), ...(ConflictsBlob ? { Conflicts: await this.read_blob(ConflictsBlob) } : {}) };
	}
	async message_value(Blob: string, Version: EntityVersion): Promise<any> { return { ...await this.read_blob(Blob), SyncVersion: Version }; }
	async operation_status(Id: string): Promise<SendOperation | null> { const Result = await this.Http("/operations?id=" + encodeURIComponent(Id), "GET"); return Result.operation ? this.expand_operation(Result.operation) : null; }
	async prepare(Operation: SendOperation, Params: unknown, Signal?: AbortSignal): Promise<{ InputBlob: string; RequestBlob: string }>
	{
		return { InputBlob: await this.upload(Operation.Input, Signal), RequestBlob: await this.upload(Params, Signal) };
	}
	async submit(Operation: SendOperation, Params: unknown, Prepared?: { InputBlob: string; RequestBlob: string }): Promise<{ operation: SendOperation; result?: any }>
	{
		const { InputBlob, RequestBlob } = Prepared ?? await this.prepare(Operation, Params), { Input: _Input, Request: _Request, Result: _Result, ...Meta } = Operation;
		const Response = await this.Http("/operations", "POST", { operation: { ...Meta, InputBlob }, requestBlob: RequestBlob });
		return { operation: await this.expand_operation(Response.operation), ...(Response.result ? { result: Response.result } : {}) };
	}
}
