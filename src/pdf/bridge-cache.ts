import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { jpeg_info, reference_id, PdfCacheLimit } from "./types";

export class BridgePdfImages
{
	private Epoch = "";
	constructor(private Root: string) { }
	private file(Id: string): string
	{
		if(!/^[0-9a-f]{64}$/.test(Id)) { throw new Error("PDF 页图 ID 无效"); }
		return join(this.Root, Id + ".jpeg-data");
	}
	private directory(): void
	{
		mkdirSync(this.Root, { recursive: true, mode: 0o700 });
		if(!lstatSync(this.Root).isDirectory() || lstatSync(this.Root).isSymbolicLink()) { throw new Error("PDF 缓存目录无效"); }
		if(!this.Epoch)
		{
			const File = join(this.Root, "epoch");
			if(existsSync(File))
			{
				if(lstatSync(File).isSymbolicLink() || !lstatSync(File).isFile() || lstatSync(File).size > 80) { throw new Error("PDF 缓存版本文件无效"); }
				this.Epoch = readFileSync(File, "utf8");
				if(!/^[0-9a-f-]{36}$/.test(this.Epoch)) { throw new Error("PDF 缓存版本无效"); }
			}
			else { this.Epoch = randomUUID(); writeFileSync(File, this.Epoch, { mode: 0o600, flag: "wx" }); }
		}
	}
	get(Id: string): string
	{
		this.directory();
		const File = this.file(Id);
		if(!existsSync(File) || !lstatSync(File).isFile() || lstatSync(File).isSymbolicLink() || lstatSync(File).size > 1500000) { throw new Error("本设备的原 PDF 页图缺失或损坏, 不能自动换用其他页面"); }
		const Data = readFileSync(File, "utf8"); jpeg_info(Data);
		if(createHash("sha256").update(Data).digest("hex") !== Id) { throw new Error("PDF 缓存校验失败"); }
		return Data;
	}
	resolve(Url: unknown): string { return this.get(reference_id(Url)); }
	request(Params: any): any
	{
		const Allowed: Record<string, string[]> = { has: ["action", "ids"], put: ["action", "id", "data", "epoch"], clear: ["action"] };
		if(!Params || !Allowed[Params.action] || Object.keys(Params).some(Key => !Allowed[Params.action].includes(Key))) { throw new Error("未知 PDF 缓存操作或字段"); }
		this.directory();
		if(Params.action === "has")
		{
			if(!Array.isArray(Params.ids) || Params.ids.length > 32) { throw new Error("PDF 页图列表无效"); }
			return { epoch: this.Epoch, present: Params.ids.filter((Id: string) => existsSync(this.file(Id))) };
		}
		if(Params.action === "put")
		{
			if(Params.epoch !== this.Epoch) { throw new Error("PDF 缓存已被清除, 拒绝迟到上传"); }
			const File = this.file(Params.id); const Info = jpeg_info(Params.data);
			if(createHash("sha256").update(Params.data).digest("hex") !== Params.id) { throw new Error("上传页图的哈希不匹配"); }
			if(existsSync(File)) { this.get(Params.id); return { Id: Params.id, ...Info }; }
			const Files = readdirSync(this.Root).filter(Name => /^[0-9a-f]{64}\.jpeg-data$/.test(Name));
			const Size = Files.reduce((Sum, Name) => Sum + lstatSync(join(this.Root, Name)).size, 0);
			if(Size + Params.data.length > PdfCacheLimit) { throw new Error("本设备远程 PDF 缓存已满, 请清除页图缓存"); }
			writeFileSync(File + ".tmp", Params.data, { mode: 0o600, flag: "wx" }); renameSync(File + ".tmp", File);
			return { Id: Params.id, ...Info };
		}
		if(Params.action === "clear")
		{
			this.Epoch = randomUUID(); writeFileSync(join(this.Root, "epoch"), this.Epoch, { mode: 0o600 });
			for(const Name of readdirSync(this.Root))
			{
				if(/^[0-9a-f]{64}\.jpeg-data(?:\.tmp)?$/.test(Name) && lstatSync(join(this.Root, Name)).isFile() && !lstatSync(join(this.Root, Name)).isSymbolicLink()) { unlinkSync(join(this.Root, Name)); }
			}
			return {};
		}
		throw new Error("未知 PDF 缓存操作");
	}
}
