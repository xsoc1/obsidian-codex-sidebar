import { Component, MarkdownRenderer, Modal, parseLinktext, resolveSubpath, type App, type TFile } from "obsidian";
import { markdown_blocks } from "./markdown-blocks";
import { locate_source, open_source, safe_source_path, type SourceReference } from "./sources";
import { error_text } from "./ui-helpers";
import { render_pdf_page } from "./pdf/page-preview";

interface PreviewTarget
{
	File: TFile;
	Subpath?: string;
	Markdown?: string;
	Line?: number;
	LastLine?: number;
	Note?: string;
	Open: () => Promise<unknown>;
}

export function bind_sidebar_links(Body: HTMLElement, ComponentValue: Component, Preview: SidebarLinkPreview, SourcePath: string, Unreliable = false): void
{
	ComponentValue.registerDomEvent(Body, "click", Event =>
	{
		const Link = (Event.target as Element | null)?.closest?.<HTMLAnchorElement>("a");
		if(!Link || !Body.contains(Link) || ["external-link", "footnote-link", "footnote-backref"].some(Class => Link.classList.contains(Class))) { return; }
		const Destination = Link.dataset.href || Link.getAttribute("href") || "";
		if(!Destination || /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(Destination)) { return; }
		// Keep Obsidian's modified-click navigation only when the original base is usable.
		if(SourcePath && !Unreliable && (Event.ctrlKey || Event.metaKey || Event.shiftKey || Event.altKey)) { return; }
		Event.preventDefault();
		Event.stopImmediatePropagation();
		Preview.link(Destination, Link.classList.contains("internal-link") && !!Link.dataset.href, Unreliable ? "" : SourcePath, Link);
	}, { capture: true });
}

function link_parts(Destination: string, NativeLinktext: boolean): { path: string; subpath: string }
{
	const Parts = parseLinktext(Destination);
	// Obsidian supplies linktext in data-href; only a plain Markdown href needs URL decoding.
	if(NativeLinktext) { return Parts; }
	try { return { path: decodeURIComponent(Parts.path), subpath: decodeURIComponent(Parts.subpath) }; } catch { return Parts; }
}

export function preview_excerpt(Text: string, Line?: number, LastLine = Line): { Text: string; Limited: boolean }
{
	const Limit = 48_000;
	if(Line !== undefined)
	{
		// Preserve block syntax when an original range overlaps a formula or callout.
		const Blocks = markdown_blocks(Text).filter(B => B.LineEnd >= Line && B.LineStart <= (LastLine ?? Line));
		if(Blocks.length) { Text = Text.slice(Blocks[0].From, Blocks.at(-1)!.To); }
	}
	if(Text.length <= Limit) { return { Text, Limited: false }; }
	const End = markdown_blocks(Text.slice(0, Limit + 1)).filter(B => B.To <= Limit && B.Closed).at(-1)?.To ?? 0;
	return { Text: Text.slice(0, End), Limited: true };
}

export class SidebarLinkPreview
{
	private Active: Modal | null = null;
	private ReturnFocus: HTMLElement | undefined;
	constructor(private AppValue: App) {}

	close(): void { this.Active?.close(); }

	link(Linktext: string, NativeLinktext: boolean, SourcePath: string, Trigger: HTMLElement): void
	{
		this.show(Trigger.textContent?.trim() || "链接预览", Trigger, async () =>
		{
			const { path: Path, subpath: Subpath } = link_parts(Linktext, NativeLinktext);
			let File: TFile | null;
			if(SourcePath)
			{
				File = Path ? this.AppValue.metadataCache.getFirstLinkpathDest(Path, SourcePath) : this.AppValue.vault.getFileByPath(SourcePath);
			}
			else
			{
				// No captured base: only an exact vault file path, not a relative or basename search.
				try { File = this.AppValue.vault.getFileByPath(safe_source_path(Path)); } catch { File = null; }
			}
			if(!File) { throw Error(SourcePath ? "当前库找不到链接指向的文件" : "没有可靠的链接基准, 请使用库内完整文件路径"); }
			const FilePath = safe_source_path(File.path);
			const Open = (Anchor = "") =>
			{
				if(this.AppValue.vault.getFileByPath(FilePath) !== File) { throw Error("文件已移动或不存在, 请关闭浮窗后重新核对链接"); }
				return this.AppValue.workspace.openLinkText(FilePath + Anchor, "", true);
			};
			let Markdown: string | undefined;
			if(File.extension.toLowerCase() === "md")
			{
				const Cache = this.AppValue.metadataCache.getFileCache(File), Text = await this.AppValue.vault.cachedRead(File);
				if(Subpath)
				{
					const Part = Cache && resolveSubpath(Cache, Subpath);
					if(!Part)
					{
						return { File, Note: "当前笔记找不到链接指定的位置", Open: () => Open() };
					}
					Markdown = Text.slice(Part.start.offset, Part.end?.offset ?? Text.length);
				}
				else { Markdown = Text.slice(Cache?.frontmatterPosition?.end.offset ?? 0).trimStart(); }
			}
			return { File, Subpath, Markdown, Open: () => Open(Subpath) };
		});
	}

	source(Ref: SourceReference, Trigger?: HTMLElement): void
	{
		this.show("来源预览", Trigger, async () =>
		{
			let Markdown: string | undefined;
			const Target = await locate_source(this.AppValue, Ref, Text => { Markdown = Text; });
			const File = this.AppValue.vault.getFileByPath(Target.Path);
			if(!File) { throw Error("当前库找不到原来源文件"); }
			const Subpath = Target.Page ? `#page=${Target.Page}` : undefined;
			const Note = Target.Status === "exact" ? (Target.Page ? `PDF 第 ${Target.Page} 页` : "") : Target.Message;
			return { File, Markdown, Line: Target.Line, LastLine: Target.Status === "exact" ? Ref.LineEnd ?? undefined : undefined, Subpath, Note, Open: () => open_source(this.AppValue, Ref) };
		});
	}

	private show(Title: string, Trigger: HTMLElement | undefined, Load: () => Promise<PreviewTarget>): void
	{
		const ReturnFocus = Trigger?.closest(".codex-link-preview") ? this.ReturnFocus : Trigger;
		this.close();
		const Dialog = new Modal(this.AppValue), Render = new Component(), Abort = new AbortController();
		this.Active = Dialog;
		this.ReturnFocus = ReturnFocus;
		let OpenedOriginal = false;
		Dialog.modalEl.addClass("codex-link-preview");
		Dialog.setTitle(Title);
		Dialog.shouldRestoreSelection = false;
		Dialog.onOpen = async () =>
		{
			Render.load();
			const Root = Dialog.contentEl;
			const Detail = Root.createDiv({ cls: "codex-link-preview-path" });
			const Body = Root.createDiv({ cls: "codex-link-preview-body markdown-rendered", attr: { tabindex: "0", "aria-label": "链接内容" } });
			const Status = Root.createDiv({ cls: "codex-link-preview-status", text: "正在读取…", attr: { role: "status" } });
			const Footer = Root.createDiv({ cls: "codex-link-preview-footer" });
			const Close = Footer.createEl("button", { text: "关闭", attr: { type: "button" } });
			Close.addEventListener("click", () => Dialog.close());
			try
			{
				const Target = await Load();
				if(this.Active !== Dialog) { return; }
				const { File, Subpath } = Target, Type = File.extension.toLowerCase();
				Dialog.setTitle(File.basename);
				Detail.setText(File.path);
				const Open = Footer.createEl("button", { text: "打开原文", cls: "mod-cta", attr: { type: "button" } });
				Open.addEventListener("click", async () =>
				{
					Open.disabled = true;
					try { await Target.Open(); OpenedOriginal = true; if(this.Active === Dialog) { Dialog.close(); } }
					catch(ErrorValue) { if(this.Active === Dialog) { Status.setText(error_text(ErrorValue)); Open.disabled = false; } }
				});
				Status.setText(Target.Note ?? "");
				if(Target.Markdown !== undefined && Type === "md")
				{
					const Excerpt = preview_excerpt(Target.Markdown, Target.Line);
					if(Excerpt.Text.trim()) { await MarkdownRenderer.render(this.AppValue, Excerpt.Text, Body, File.path, Render); }
					else { Body.setText(Excerpt.Limited ? "此段较长, 请打开原文阅读" : "此处没有正文"); }
					if(this.Active !== Dialog) { return; }
					if(Excerpt.Limited) { Status.setText([Target.Note, "仅预览开头"].filter(Boolean).join(" · ")); }
					bind_sidebar_links(Body, Render, this, File.path);
				}
				else if(Type === "pdf")
				{
					const Value = /(?:^#|&)page=([^&]*)/.exec(Subpath ?? ""), Page = Value ? Number(Value[1]) : 1;
					if(Value && !/^\d+$/.test(Value[1])) { throw Error("PDF 链接页码无效"); }
					Status.setText(`正在绘制 PDF 第 ${Page} 页…`);
					const Canvas = Body.createEl("canvas", { cls: "codex-link-preview-pdf", attr: { role: "img", "aria-label": `PDF 第 ${Page} 页` } });
					Canvas.hidden = true;
					await render_pdf_page(this.AppValue, File, Page, Canvas, Abort.signal);
					if(this.Active === Dialog) { Canvas.hidden = false; Status.setText(Target.Note || `PDF 第 ${Page} 页`); }
				}
				else if(/^(?:png|jpe?g|gif|webp|avif|bmp|svg)$/.test(Type))
				{
					const Image = Body.createEl("img", { attr: { src: this.AppValue.vault.getResourcePath(File), alt: File.basename } });
					Render.registerDomEvent(Image, "error", () => Status.setText("图片暂时无法预览, 请打开原文"));
				}
				else { Body.setText("此处无法预览, 请打开原文阅读"); }
			}
			catch(ErrorValue)
			{
				if(this.Active === Dialog) { Body.empty(); Body.setText(error_text(ErrorValue)); Status.setText(""); }
			}
		};
		Dialog.onClose = () =>
		{
			if(this.Active === Dialog) { this.Active = null; this.ReturnFocus = undefined; }
			Abort.abort();
			Render.unload();
			Dialog.contentEl.empty();
			if(!OpenedOriginal && ReturnFocus?.isConnected)
			{
				queueMicrotask(() => { if(!this.Active && ReturnFocus.isConnected) { ReturnFocus.focus({ preventScroll: true }); } });
			}
		};
		Dialog.open();
	}
}
