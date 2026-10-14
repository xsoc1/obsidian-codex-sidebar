export const PdfImageLimit = 1500000;
export const PdfCacheLimit = 64 * 1024 * 1024;
export const PdfReferencePrefix = "obsidian-pdf:";

export interface PdfImageRef
{
	Id: string;
	Width: number;
	Height: number;
	Bytes: number;
}

export interface PdfSnapshot
{
	schemaVersion: 1;
	ReadOnly: true;
	PageCount: number;
	Pages: { Number: number; TextLayer: boolean; Image: PdfImageRef }[];
}

export async function pdf_hash(Value: string | ArrayBuffer): Promise<string>
{
	const BufferValue = typeof Value === "string" ? new TextEncoder().encode(Value) : new Uint8Array(Value);
	const Digest = await crypto.subtle.digest("SHA-256", BufferValue);
	return Array.from(new Uint8Array(Digest), Byte => Byte.toString(16).padStart(2, "0")).join("");
}

export function pdf_reference(Id: string): string
{
	if(!/^[0-9a-f]{64}$/.test(Id)) { throw new Error("PDF 页图引用无效"); }
	return PdfReferencePrefix + Id;
}

export function reference_id(Url: unknown): string
{
	if(typeof Url !== "string" || !/^obsidian-pdf:[0-9a-f]{64}$/.test(Url)) { throw new Error("只允许本设备已缓存的 PDF 页图引用"); }
	return Url.slice(PdfReferencePrefix.length);
}

export function jpeg_info(Data: unknown): Omit<PdfImageRef, "Id">
{
	if(typeof Data !== "string" || Data.length > PdfImageLimit || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(Data)) { throw new Error("PDF 页图格式或大小无效"); }
	const Bytes = atob(Data.slice("data:image/jpeg;base64,".length));
	const Byte = (Index: number) => Bytes.charCodeAt(Index);
	if(Bytes.length < 24 || Byte(0) !== 255 || Byte(1) !== 216 || Byte(Bytes.length - 2) !== 255 || Byte(Bytes.length - 1) !== 217) { throw new Error("PDF 页图不是完整 JPEG"); }
	let Offset = 2;
	while(Offset + 4 < Bytes.length)
	{
		if(Byte(Offset++) !== 255) { break; }
		while(Byte(Offset) === 255) { Offset++; }
		const Marker = Byte(Offset++);
		const Length = Byte(Offset) * 256 + Byte(Offset + 1);
		if(Length < 2 || Offset + Length > Bytes.length) { break; }
		if([192, 193, 194].includes(Marker) && Length >= 8)
		{
			const Height = Byte(Offset + 3) * 256 + Byte(Offset + 4);
			const Width = Byte(Offset + 5) * 256 + Byte(Offset + 6);
			if(Width < 1 || Height < 1 || Width > 1600 || Height > 1600) { throw new Error("PDF 页图尺寸超过上限"); }
			return { Width, Height, Bytes: Bytes.length };
		}
		Offset += Length;
	}
	throw new Error("无法核验 PDF 页图尺寸");
}

export function validate_pdf(Value: PdfSnapshot): void
{
	const Keys = (ObjectValue: object, Allowed: string[]) => Object.keys(ObjectValue).every(Key => Allowed.includes(Key));
	if(!Value || !Keys(Value, ["schemaVersion", "ReadOnly", "PageCount", "Pages"]) || Value.schemaVersion !== 1 || Value.ReadOnly !== true || !Number.isInteger(Value.PageCount) || Value.PageCount < 1 || Value.PageCount > 10000 || !Array.isArray(Value.Pages) || Value.Pages.length < 1 || Value.Pages.length > 2) { throw new Error("PDF 来源快照无效"); }
	let Previous = 0;
	for(const Page of Value.Pages)
	{
		const Image = Page?.Image;
		if(!Page || !Image || !Keys(Page, ["Number", "TextLayer", "Image"]) || !Keys(Image, ["Id", "Width", "Height", "Bytes"])) { throw new Error("PDF 来源含未知字段"); }
		if(!Number.isInteger(Page?.Number) || Page.Number <= Previous || Page.Number > Value.PageCount || typeof Page.TextLayer !== "boolean" || !Image || !/^[0-9a-f]{64}$/.test(Image.Id) || ![Image.Width, Image.Height, Image.Bytes].every(Number.isInteger) || Image.Width < 1 || Image.Height < 1 || Image.Width > 1600 || Image.Height > 1600 || Image.Bytes < 24 || Image.Bytes > PdfImageLimit) { throw new Error("PDF 页码或页图引用无效"); }
		Previous = Page.Number;
	}
}
