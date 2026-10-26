import { jpeg_info, pdf_hash, PdfCacheLimit, validate_image_origin, validate_origin_image, type PdfImageRef, type PdfImageOrigin } from "./types";

export interface PdfImages
{
	put(Data: string, Origin?: PdfImageOrigin): Promise<PdfImageRef>;
	get(Id: string): Promise<string>;
	clear(): Promise<void>;
}

export class BrowserPdfImages implements PdfImages
{
	private Database: Promise<IDBDatabase> | null = null;
	private Generation = 0;
	constructor(private Scope: string) { }

	private database(): Promise<IDBDatabase>
	{
		if(!this.Database)
		{
			this.Database = new Promise((Resolve, Reject) =>
			{
				if(typeof indexedDB === "undefined") { Reject(new Error("此设备不支持 PDF 页图缓存")); return; }
				const Request = indexedDB.open("codex-sidebar-pdf-v1", 1);
				Request.onupgradeneeded = () => Request.result.createObjectStore("images", { keyPath: "Key" }).createIndex("scope", "Scope");
				Request.onsuccess = () => Resolve(Request.result);
				Request.onerror = () => Reject(new Error("无法打开 PDF 页图缓存"));
			});
		}
		return this.Database;
	}

	async put(Data: string, Origin?: PdfImageOrigin): Promise<PdfImageRef>
	{
		if(Origin) { validate_image_origin(Origin); }
		const Generation = this.Generation;
		const Info = jpeg_info(Data);
		if(Origin) { validate_origin_image(Origin, Info); }
		const Id = await pdf_hash(Data);
		const Database = await this.database();
		if(Generation !== this.Generation) { throw new Error("PDF 捕获已被缓存清除取消"); }
		await new Promise<void>((Resolve, Reject) =>
		{
			const Transaction = Database.transaction("images", "readwrite");
			const Store = Transaction.objectStore("images");
			const Request = Store.index("scope").getAll(this.Scope);
			let Failure = "无法保存 PDF 页图";
			Request.onsuccess = () =>
			{
				const Entries = Request.result.filter(Value => Value.Scope === this.Scope);
				if(!Entries.some(Value => Value.Id === Id) && Entries.reduce((Sum, Value) => Sum + Value.Data.length, 0) + Data.length > PdfCacheLimit)
				{
					Failure = "PDF 页图缓存已满, 请在插件设置中清除页图缓存"; Transaction.abort(); return;
				}
				const Previous = Entries.find(Value => Value.Id === Id), Origins = [...new Map([...(Previous?.Origins ?? []), ...(Origin ? [Origin] : [])].map(Value => [JSON.stringify(Value), Value])).values()];
				Store.put({ Key: this.Scope + ":" + Id, Scope: this.Scope, Id, Data, ...(Origins.length ? { Origins } : {}) });
			};
			Transaction.oncomplete = () => Resolve();
			Transaction.onabort = Transaction.onerror = () => Reject(new Error(Failure));
		});
		if(Generation !== this.Generation) { throw new Error("PDF 捕获已被缓存清除取消"); }
		return { Id, ...Info, ...(Origin ? structuredClone(Origin) : {}) };
	}

	async get(Id: string): Promise<string>
	{
		if(!/^[0-9a-f]{64}$/.test(Id)) { throw new Error("PDF 页图引用无效"); }
		const Database = await this.database();
		const Data = await new Promise<string>((Resolve, Reject) =>
		{
			const Request = Database.transaction("images", "readonly").objectStore("images").get(this.Scope + ":" + Id);
			Request.onsuccess = () => Request.result ? Resolve(Request.result.Data) : Reject(new Error("原 PDF 页图缓存已缺失, 请明确重新捕获并提出新问题; 原问题不能换图重发"));
			Request.onerror = () => Reject(new Error("无法读取 PDF 页图缓存"));
		});
		jpeg_info(Data);
		if(await pdf_hash(Data) !== Id) { throw new Error("PDF 页图缓存校验失败"); }
		return Data;
	}

	async clear(): Promise<void>
	{
		this.Generation++;
		const Database = await this.database();
		await new Promise<void>((Resolve, Reject) =>
		{
			const Transaction = Database.transaction("images", "readwrite");
			const Store = Transaction.objectStore("images");
			const Request = Store.index("scope").openCursor(this.Scope);
			Request.onsuccess = () =>
			{
				const Cursor = Request.result;
				if(!Cursor) { return; }
				if(Cursor.value.Scope === this.Scope) { Cursor.delete(); }
				Cursor.continue();
			};
			Transaction.oncomplete = () => Resolve();
			Transaction.onabort = Transaction.onerror = () => Reject(new Error("无法清除 PDF 页图缓存"));
		});
	}
}
