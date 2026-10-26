export const PdfImageLimit = 1500000;
export const PdfCacheLimit = 64 * 1024 * 1024;
export const PdfReferencePrefix = "obsidian-pdf:";

export interface PdfImageRef
{
	Id: string;
	Width: number;
	Height: number;
	Bytes: number;
	Kind?: "page" | "region";
	Region?: PdfRegion;
}

export interface PdfRegionInput { X: number; Y: number; Width: number; Height: number; }
export interface PdfRegion extends PdfRegionInput { PageWidth: number; PageHeight: number; Scale: number; Rotation: number; }
export interface PdfCaptureRequest { Number: number; Kind?: "page" | "region"; Region?: PdfRegionInput; Version?: string; }
export interface PdfImageOrigin { Kind: "page" | "region"; Region?: PdfRegion; }
export function validate_region(Region: PdfRegionInput, Full = false): void
{
	const Keys = Full ? ["X", "Y", "Width", "Height", "PageWidth", "PageHeight", "Scale", "Rotation"] : ["X", "Y", "Width", "Height"];
	if(!Region || Object.keys(Region).some(Key => !Keys.includes(Key)) || ![Region.X, Region.Y, Region.Width, Region.Height].every(Number.isFinite) || Region.X < 0 || Region.Y < 0 || Region.Width <= 0 || Region.Height <= 0 || Region.X + Region.Width > 1.000001 || Region.Y + Region.Height > 1.000001 || Region.Width * Region.Height >= 0.999999) { throw new Error("PDF 局部区域必须是页面内有效矩形, 不能伪装为额外整页"); }
	if(Full)
	{
		const R = Region as PdfRegion;
		if(![R.PageWidth, R.PageHeight, R.Scale, R.Rotation].every(Number.isFinite) || R.PageWidth <= 0 || R.PageHeight <= 0 || R.Scale <= 0 || R.Scale > 20 || ![0, 90, 180, 270].includes(R.Rotation)) { throw new Error("PDF 局部区域尺寸或缩放关系无效"); }
	}
}
export function validate_image_origin(Value: PdfImageOrigin): void
{
	if(!Value || Object.keys(Value).some(Key => !["Kind", "Region"].includes(Key)) || !["page", "region"].includes(Value.Kind) || (Value.Kind === "region" ? !Value.Region : Value.Region !== undefined)) { throw new Error("PDF 页图/局部图类型无效"); }
	if(Value.Region) { validate_region(Value.Region, true); }
}
export function validate_origin_image(Origin: PdfImageOrigin, Image: Pick<PdfImageRef, "Width" | "Height">): void
{
	validate_image_origin(Origin);
	if(Origin.Region)
	{
		const R = Origin.Region;
		if(Math.abs(Image.Width - Math.max(1, Math.floor(R.PageWidth * R.Scale * R.Width))) > 1 || Math.abs(Image.Height - Math.max(1, Math.floor(R.PageHeight * R.Scale * R.Height))) > 1) { throw new Error("PDF 局部图像尺寸与裁切缩放关系不一致"); }
	}
}

export interface PdfSnapshot
{
	schemaVersion: 1 | 2;
	ReadOnly: true;
	PageCount: number;
	Pages: { Number: number; TextLayer: boolean; Image: PdfImageRef; Kind?: "page" | "region"; Region?: PdfRegion }[];
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
	if(!Value || !Keys(Value, ["schemaVersion", "ReadOnly", "PageCount", "Pages"]) || ![1, 2].includes(Value.schemaVersion) || Value.ReadOnly !== true || !Number.isInteger(Value.PageCount) || Value.PageCount < 1 || Value.PageCount > 10000 || !Array.isArray(Value.Pages) || Value.Pages.length < 1 || Value.Pages.length > 2) { throw new Error("PDF 来源快照无效"); }
	let Previous = 0;
	const Sources = new Set<string>();
	for(const Page of Value.Pages)
	{
		const Image = Page?.Image;
		if(!Page || !Image || !Keys(Page, Value.schemaVersion === 1 ? ["Number", "TextLayer", "Image"] : ["Number", "TextLayer", "Image", "Kind", "Region"]) || !Keys(Image, Value.schemaVersion === 1 ? ["Id", "Width", "Height", "Bytes"] : ["Id", "Width", "Height", "Bytes", "Kind", "Region"])) { throw new Error("PDF 来源含未知字段"); }
		if(!Number.isInteger(Page?.Number) || (Value.schemaVersion === 1 ? Page.Number <= Previous : Page.Number < Previous) || Page.Number > Value.PageCount || Page.Number < 1 || typeof Page.TextLayer !== "boolean" || !Image || !/^[0-9a-f]{64}$/.test(Image.Id) || ![Image.Width, Image.Height, Image.Bytes].every(Number.isInteger) || Image.Width < 1 || Image.Height < 1 || Image.Width > 1600 || Image.Height > 1600 || Image.Bytes < 24 || Image.Bytes > PdfImageLimit) { throw new Error("PDF 页码或页图引用无效"); }
		if(Value.schemaVersion === 2)
		{
			validate_image_origin({ Kind: Page.Kind!, ...(Page.Region ? { Region: Page.Region } : {}) });
			validate_origin_image({ Kind: Page.Kind!, ...(Page.Region ? { Region: Page.Region } : {}) }, Image);
			if(Image.Kind && (Image.Kind !== Page.Kind || ["X", "Y", "Width", "Height", "PageWidth", "PageHeight", "Scale", "Rotation"].some(Key => (Image.Region as any)?.[Key] !== (Page.Region as any)?.[Key]))) { throw new Error("PDF 图像缓存类型与来源不一致"); }
			const Key = JSON.stringify([Page.Number, Page.Kind, Page.Region]); if(Sources.has(Key)) { throw new Error("PDF 来源重复, 总图像预算为两张"); } Sources.add(Key);
		}
		Previous = Page.Number;
	}
}
