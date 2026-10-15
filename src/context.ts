import { MarkdownView, type FileView, type TFile, type MarkdownPostProcessorContext, type App } from "obsidian";
import { bound_text, heading_at, source_excerpt, type ContextSnapshot } from "./prompt";
import { version_of } from "./study/document";
import { PdfReader, is_pdf_view, pdf_location } from "./pdf/reader";
import { BrowserPdfImages, type PdfImages } from "./pdf/image-store";

export class ContextCapture
{
	private Blocks = new WeakMap<Element, MarkdownPostProcessorContext>();
	LastView: MarkdownView | FileView | null = null;
	Snapshot: ContextSnapshot | null = null;
	readonly Pdf: PdfReader;
	PdfPending = 0;
	Suspended = false;
	private Generation = 0;
	private LastPath = "";

	constructor(private App: App, Images: PdfImages = new BrowserPdfImages(App.vault.getName()))
	{
		this.Pdf = new PdfReader(App, Images);
	}

	register_block(ElementValue: HTMLElement, Context: MarkdownPostProcessorContext): void
	{
		ElementValue.dataset.codexSource = Context.sourcePath;
		this.Blocks.set(ElementValue, Context);
	}

	track_view(): void
	{
		const ActiveFile = this.App.workspace.getActiveFile();
		const Active = this.App.workspace.activeLeaf?.view;
		const View = this.App.workspace.getActiveViewOfType(MarkdownView)
			?? (is_pdf_view(Active) ? Active : null)
			?? (this.LastView?.containerEl.isConnected ? this.LastView : null)
			?? this.App.workspace.getLeavesOfType("pdf").map(Leaf => Leaf.view).find(Value => is_pdf_view(Value) && Value.file?.path === ActiveFile?.path)
			?? this.App.workspace.getLeavesOfType("markdown").map(Leaf => Leaf.view)
				.find(Value => Value instanceof MarkdownView && Value.file?.path === ActiveFile?.path)
			?? this.App.workspace.getLeavesOfType("markdown").map(Leaf => Leaf.view)
				.find(Value => Value instanceof MarkdownView);
		if(View)
		{
			if(this.LastView !== View || this.LastPath !== (View as FileView).file?.path) { this.Generation++; }
			this.LastView = View as MarkdownView | FileView;
			this.LastPath = this.LastView.file?.path ?? "";
		}
	}

	async capture(Kind: "选区" | "当前位置", View = this.LastView): Promise<ContextSnapshot | null>
	{
		if(this.Suspended || !View?.file || !View.containerEl.isConnected)
		{
			return null;
		}
		const Path = View.file.path;
		if(is_pdf_view(View))
		{
			const Location = pdf_location(View.containerEl, Kind);
			if(!Location) { return null; }
			return this.capture_pdf(View.file!, Location.Pages, View.containerEl.ownerDocument, Kind, Location.SelectedText, Location.Truncated);
		}
		if(!(View instanceof MarkdownView)) { return null; }
		const Generation = ++this.Generation;
		const Source = View.getViewData();
		let VersionSource = Source;
		let Text = "";
		let SelectedText = "";
		let Start: number | null = null;
		let End: number | null = null;
		let FocusLine: number | undefined;
		let Mapping: ContextSnapshot["Mapping"] = "源文本";
		let Selection: ContextSnapshot["Selection"];
		const Mode = View.getMode() === "preview" ? "阅读" : "编辑";
		let ContextPath = Path;
		if(Mode === "编辑")
		{
			const Editor = View.editor;
			SelectedText = Kind === "选区" ? Editor.getSelection() : "";
			if(Kind === "选区" && !SelectedText.trim())
			{
				return null;
			}
			const From = Editor.getCursor(Kind === "选区" ? "from" : "head");
			const To = Editor.getCursor(Kind === "选区" ? "to" : "head");
			if(Kind === "选区" && SelectedText) { Selection = { From: Editor.posToOffset(From), To: Editor.posToOffset(To) }; }
			FocusLine = From.line;
			Start = Math.max(0, From.line - 5);
			End = Math.min(Editor.lineCount() - 1, To.line + 5);
			Text = source_excerpt(Source, Start, End);
		}
		else
		{
			const DocumentValue = View.containerEl.ownerDocument;
			const SelectionValue = DocumentValue.defaultView?.getSelection();
			const RangeValue = SelectionValue?.rangeCount ? SelectionValue.getRangeAt(0) : null;
			const HasSelection = !!RangeValue && !RangeValue.collapsed && View.containerEl.contains(RangeValue.commonAncestorContainer);
			if(Kind === "选区" && !HasSelection)
			{
				return null;
			}
			SelectedText = Kind === "选区" ? SelectionValue?.toString() ?? "" : "";
			const Scroller = View.containerEl.querySelector(".markdown-preview-view") ?? View.containerEl;
			const Bounds = Scroller.getBoundingClientRect();
			const Sections: { Path: string; Start: number; End: number }[] = [];
			for(const ElementValue of View.containerEl.querySelectorAll<HTMLElement>("[data-codex-source]"))
			{
				const Rect = ElementValue.getBoundingClientRect();
				const Included = Kind === "选区" ? RangeValue!.intersectsNode(ElementValue) : Rect.bottom > Bounds.top && Rect.top < Bounds.bottom;
				if(!Included || !Rect.height)
				{
					continue;
				}
				const Context = this.Blocks.get(ElementValue);
				const Info = Context?.getSectionInfo(ElementValue);
				if(Info)
				{
					Sections.push({ Path: Context!.sourcePath, Start: Info.lineStart, End: Info.lineEnd });
				}
			}
			const SourcePaths = new Set(Sections.map(Section => Section.Path));
			if(Sections.length && SourcePaths.size === 1)
			{
				ContextPath = Sections[0].Path;
				Start = Math.min(...Sections.map(Section => Section.Start));
				End = Math.max(...Sections.map(Section => Section.End));
				const ContextFile = this.App.vault.getFileByPath(ContextPath);
				const ContextSource = ContextPath === Path ? Source : ContextFile ? await this.App.vault.cachedRead(ContextFile) : null;
				if(ContextSource !== null)
				{
					VersionSource = ContextSource;
					Text = source_excerpt(ContextSource, Start, End);
					Mapping = "源块";
				}
			}
			if(!Text)
			{
				if(Kind === "选区")
				{
					Text = SelectedText;
					Start = End = null;
					ContextPath = Path;
					Mapping = "渲染文本";
				}
				else
				{
					return null;
				}
			}
		}
		const Bounded = bound_text(Text);
		const ContextFile = this.App.vault.getFileByPath(ContextPath);
		const Headings = ContextFile ? this.App.metadataCache.getFileCache(ContextFile)?.headings ?? [] : [];
		const Version = await version_of(VersionSource);
		if(Generation !== this.Generation) { return null; }
		this.Snapshot =
		{
			Path: ContextPath,
			Mode,
			Kind,
			Text: Bounded.Text,
			SelectedText: bound_text(SelectedText, 12000).Text,
			LineStart: Start,
			LineEnd: End,
			Heading: Start === null ? "" : heading_at(Headings, Start),
			Mapping,
			CapturedAt: new Date().toISOString(),
			Truncated: Bounded.Truncated || SelectedText.length > 12000,
			Version,
			...(Selection ? { Selection } : {}),
			FocusLine: FocusLine ?? Start ?? undefined
		};
		return this.Snapshot;
	}

	async capture_pdf(File: TFile, Pages: number[], OwnerDocument: Document, Kind: "选区" | "当前位置" = "当前位置", SelectedText = "", Truncated = false): Promise<ContextSnapshot | null>
	{
		if(this.Suspended) { throw new Error("PDF 缓存正在清除, 请稍后重新捕获"); }
		const Generation = ++this.Generation;
		this.PdfPending++;
		try
		{
			const Snapshot = await this.Pdf.capture(File, Pages, OwnerDocument, Kind, SelectedText, Truncated);
			if(Generation !== this.Generation) { return null; }
			this.Snapshot = Snapshot; return Snapshot;
		}
		catch(ErrorValue)
		{
			if(Generation !== this.Generation) { return null; }
			this.Snapshot = null; throw ErrorValue;
		}
		finally { this.PdfPending--; }
	}

	close(): void
	{
		this.Generation++; this.Pdf.close();
	}
	clear(): void { this.Generation++; this.Snapshot = null; }
}
