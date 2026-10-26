// Native PDF.js/canvas acceptance using supplied original bytes and memory-only images.
import type { App, TFile } from "obsidian";
import { PdfReader } from "../src/pdf/reader";
import { jpeg_info, pdf_hash, validate_pdf, type PdfImageOrigin } from "../src/pdf/types";

export async function pdf_region_probe(AppValue: App, Bytes: ArrayBuffer, Owner: Document = document)
{
	const Images = new Map<string, string>();
	const Reader = new PdfReader({ vault: { readBinary: async () => Bytes } } as unknown as App, {
		put: async (Data: string, Origin?: PdfImageOrigin) => { const Id = await pdf_hash(Data); Images.set(Id, Data); return { Id, ...jpeg_info(Data), ...(Origin ?? {}) }; },
		get: async Id => { const Value = Images.get(Id); if(!Value) { throw Error("Missing original image"); } return Value; }, clear: async () => { Images.clear(); }
	});
	const File = { path: "Original-density.pdf", extension: "pdf", stat: { size: Bytes.byteLength, mtime: 1 } } as TFile;
	try
	{
		const Full = await Reader.capture(File, [1], Owner), Version = Full.Version!;
		const Snapshot = await Reader.capture(File, [{ Number: 1, Kind: "page", Version }, { Number: 1, Kind: "region", Region: { X: 0.07, Y: 0.24, Width: 0.43, Height: 0.245 }, Version }], Owner);
		validate_pdf(Snapshot.Pdf!);
		const Page = Snapshot.Pdf!.Pages[0], Crop = Snapshot.Pdf!.Pages[1], FullScale = Page.Image.Height / 792;
		if(Snapshot.Pdf!.Pages.length !== 2 || Page.Number !== 1 || Crop.Number !== 1 || !Crop.Region || Crop.Region.Scale <= FullScale || Crop.Image.Id === Page.Image.Id) { throw Error("Native crop identity, two-image budget or magnification failed"); }
		return { Report: { tier: "native PDF.js and canvas with original bytes; no real vault PDF or model request", pageIdentityPreserved: true, versionPreserved: Snapshot.Version === Version, imageCount: 2, full: { Width: Page.Image.Width, Height: Page.Image.Height }, crop: { Width: Crop.Image.Width, Height: Crop.Image.Height, Region: Crop.Region }, pixelMagnification: Crop.Region.Scale / FullScale, noVaultWrites: true }, Full: Images.get(Page.Image.Id)!, Crop: Images.get(Crop.Image.Id)! };
	}
	finally { Reader.close(); }
}
