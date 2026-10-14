import { MarkdownView, type MarkdownPostProcessorContext, type App } from "obsidian";
import { bound_text, heading_at, source_excerpt, type ContextSnapshot } from "./prompt";
import { version_of } from "./study/document";

export class ContextCapture
{
	private Blocks = new WeakMap<Element, MarkdownPostProcessorContext>();
	LastView: MarkdownView | null = null;
	Snapshot: ContextSnapshot | null = null;

	constructor(private App: App)
	{
	}

	register_block(ElementValue: HTMLElement, Context: MarkdownPostProcessorContext): void
	{
		ElementValue.dataset.codexSource = Context.sourcePath;
		this.Blocks.set(ElementValue, Context);
	}

	track_view(): void
	{
		const ActiveFile = this.App.workspace.getActiveFile();
		const View = this.App.workspace.getActiveViewOfType(MarkdownView)
			?? (this.LastView?.containerEl.isConnected ? this.LastView : null)
			?? this.App.workspace.getLeavesOfType("markdown").map(Leaf => Leaf.view)
				.find(Value => Value instanceof MarkdownView && Value.file?.path === ActiveFile?.path)
			?? this.App.workspace.getLeavesOfType("markdown").map(Leaf => Leaf.view)
				.find(Value => Value instanceof MarkdownView);
		if(View)
		{
			this.LastView = View as MarkdownView;
		}
	}

	async capture(Kind: "选区" | "当前位置", View = this.LastView): Promise<ContextSnapshot | null>
	{
		if(!View?.file || !View.containerEl.isConnected)
		{
			return null;
		}
		const Path = View.file.path;
		const Source = View.getViewData();
		let VersionSource = Source;
		let Text = "";
		let SelectedText = "";
		let Start: number | null = null;
		let End: number | null = null;
		let FocusLine: number | undefined;
		let Mapping: ContextSnapshot["Mapping"] = "源文本";
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
			Version: await version_of(VersionSource),
			FocusLine: FocusLine ?? Start ?? undefined
		};
		return this.Snapshot;
	}
}
