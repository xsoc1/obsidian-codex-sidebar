import { pack_edits, unpack_edits, type PackedEdits } from "./codec";
import { EditStore, type EditData, type EditPersistence } from "./store";
import type { LocalStorageLike } from "./write-types";

interface StoredRoot { Scope: string; Revision: number; Data: PackedEdits; }
interface StoredText { Key: string; Scope: string; Id: string; Text: string; }

function storage_error(ErrorValue: unknown): Error
{
	return new Error(ErrorValue instanceof DOMException && ErrorValue.name === "QuotaExceededError" ? "本设备存储空间不足, 本次记录未保存; 已有记录保留, 请先导出备份并释放设备空间" : "无法保存本设备修改记录, 本次记录未保存; 已有记录保留. " + String(ErrorValue ?? "事务已中断"));
}

export class EditDatabase implements EditPersistence
{
	private Database: IDBDatabase | null = null;
	private Revision = 0;
	constructor(private Scope: string, private Factory: IDBFactory = indexedDB) { }
	private async database(): Promise<IDBDatabase>
	{
		if(this.Database) { return this.Database; }
		return new Promise((Resolve, Reject) =>
		{
			let Blocked = false;
			const Request = this.Factory.open("codex-sidebar-edits-v3", 1);
			Request.onupgradeneeded = () =>
			{
				Request.result.createObjectStore("roots", { keyPath: "Scope" });
				Request.result.createObjectStore("texts", { keyPath: "Key" }).createIndex("scope", "Scope");
			};
			Request.onsuccess = () =>
			{
				if(Blocked) { Request.result.close(); return; }
				this.Database = Request.result;
				this.Database.onversionchange = () => this.close();
				Resolve(this.Database);
			};
			Request.onerror = () => Reject(storage_error(Request.error));
			Request.onblocked = () => { Blocked = true; Reject(new Error("修改记录数据库升级被另一个窗口占用, 请关闭旧窗口后重试; 原记录保留")); };
		});
	}
	async load(): Promise<EditData | null>
	{
		const Database = await this.database();
		const Saved = await new Promise<{ Root?: StoredRoot; Texts: StoredText[] }>((Resolve, Reject) =>
		{
			const Transaction = Database.transaction(["roots", "texts"], "readonly");
			const Root = Transaction.objectStore("roots").get(this.Scope), Texts = Transaction.objectStore("texts").index("scope").getAll(this.Scope);
			Transaction.oncomplete = () => Resolve({ Root: Root.result, Texts: Texts.result });
			Transaction.onabort = () => Reject(new Error("无法读取本设备修改记录, 原数据保留"));
		});
		if(!Saved.Root) { if(Saved.Texts.length) { throw new Error("修改记录索引缺失, 原文本保留, 不自动覆盖"); } this.Revision = 0; return null; }
		if(Saved.Root.Scope !== this.Scope || !Number.isSafeInteger(Saved.Root.Revision) || Saved.Root.Revision < 1 || Saved.Texts.some(Value => Value.Scope !== this.Scope || Value.Key !== this.Scope + ":" + Value.Id)) { throw new Error("修改记录设备索引损坏, 原数据保留"); }
		const Data = await unpack_edits(Saved.Root.Data, new Map(Saved.Texts.map(Value => [Value.Id, Value.Text])));
		this.Revision = Saved.Root.Revision; return Data;
	}
	async save(Data: EditData): Promise<void>
	{
		const Packed = await pack_edits(Data), Database = await this.database(), Revision = this.Revision;
		await new Promise<void>((Resolve, Reject) =>
		{
			const Transaction = Database.transaction(["roots", "texts"], "readwrite", { durability: "strict" });
			let Failure: Error | null = null;
			const Roots = Transaction.objectStore("roots"), Texts = Transaction.objectStore("texts"), Current = Roots.get(this.Scope);
			Current.onsuccess = () =>
			{
				if((Current.result?.Revision ?? 0) !== Revision)
				{
					Failure = new Error("另一个窗口已更新修改记录, 请重载插件后重试; 不覆盖现有记录"); Transaction.abort(); return;
				}
				const Cursor = Texts.index("scope").openCursor(this.Scope), Existing = new Set<string>();
				Cursor.onsuccess = () =>
				{
					const Entry = Cursor.result;
					if(!Entry)
					{
						for(const [Id, Text] of Packed.Texts) { if(!Existing.has(Id)) { Texts.put({ Key: this.Scope + ":" + Id, Scope: this.Scope, Id, Text } satisfies StoredText); } }
						Roots.put({ Scope: this.Scope, Revision: Revision + 1, Data: Packed.Data } satisfies StoredRoot); return;
					}
					if(!Packed.Texts.has(Entry.value.Id)) { Entry.delete(); }
					else if(Packed.Texts.get(Entry.value.Id) !== Entry.value.Text) { Failure = new Error("已保存修改文本校验不一致, 原记录保留"); Transaction.abort(); return; }
					else { Existing.add(Entry.value.Id); }
					Entry.continue();
				};
			};
			Transaction.oncomplete = () => Resolve();
			Transaction.onabort = () => Reject(Failure ?? storage_error(Transaction.error));
		});
		this.Revision = Revision + 1;
	}
	close(): void { this.Database?.close(); this.Database = null; }
}

function canonical_data(Data: EditData): string
{
	return JSON.stringify(Data, (_Key, Value) => Value && typeof Value === "object" && !Array.isArray(Value) ? Object.fromEntries(Object.entries(Value).sort(([A], [B]) => A.localeCompare(B))) : Value);
}

export async function open_edit_store(Storage: LocalStorageLike, Vault: string, Factory?: IDBFactory): Promise<EditStore>
{
	const Database = new EditDatabase(Vault, Factory);
	try
	{
		let Data = await Database.load();
		if(!Data)
		{
			const Legacy = new EditStore(Storage, Vault);
			await Database.save(Legacy.Data);
			Data = await Database.load();
			if(!Data || canonical_data(Data) !== canonical_data(Legacy.Data)) { throw new Error("修改记录迁移回读不一致, 旧数据保留, 停止使用新记录"); }
		}
		return new EditStore(Storage, Vault, Data, Database);
	}
	catch(ErrorValue) { Database.close(); throw ErrorValue; }
}
