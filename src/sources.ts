import type { App } from "obsidian";
import type { ContextSnapshot, AnswerQuote } from "./prompt";
import { version_of, block_ids } from "./edit/document";
import { text_identity, markdown_blocks } from "./markdown-blocks";
import { pdf_hash, validate_pdf, validate_image_origin } from "./pdf/types";

export interface SourceReference
{
	Id: string;
	Kind: "markdown" | "pdf" | "tool-read";
	Path: string;
	PathExact?: boolean;
	CurrentPath?: string;
	Version?: string;
	VersionKind?: "file-text" | "cli-output" | "pdf-bytes";
	CapturedAt: string;
	Heading?: string;
	BlockId?: string;
	LineStart?: number | null;
	LineEnd?: number | null;
	Range?: { From: number; To: number; Total?: number };
	Page?: number;
	ImageKind?: "page" | "region";
	Region?: import("./pdf/types").PdfRegion;
	Host: "client-snapshot" | "windows-copy" | "desktop-read" | "unknown";
	Purpose?: "selection" | "capture" | "explanation" | "read";
	Mapping?: ContextSnapshot["Mapping"];
	Truncated: boolean;
	Anchor?: string;
}

interface SourceMessage { Id: string; Role: string; TurnId?: string; Context?: ContextSnapshot | null; Quote?: AnswerQuote | null; Sources?: SourceReference[]; Task?: { Source?: ContextSnapshot | null }; }

function safe_source_path(Path: string): string
{
	if(typeof Path !== "string" || !Path || Path !== Path.trim() || Path.length > 8000 || /[\\:\u0000-\u001f<>"|?*]/.test(Path) || Path.split("/").some(Part => !Part || Part === "." || Part === ".." || Part.startsWith("."))) { throw new Error("来源必须是当前 vault 内准确的普通文件路径"); }
	return Path;
}

export function validate_source_reference(Value: unknown): SourceReference
{
	const Ref = Value as SourceReference, Allowed = ["Id", "Kind", "Path", "PathExact", "CurrentPath", "Version", "VersionKind", "CapturedAt", "Heading", "BlockId", "LineStart", "LineEnd", "Range", "Page", "ImageKind", "Region", "Host", "Purpose", "Mapping", "Truncated", "Anchor"];
	if(!Ref || typeof Ref !== "object" || Array.isArray(Ref) || Object.keys(Ref).some(Key => !Allowed.includes(Key)) || typeof Ref.Id !== "string" || !Ref.Id || Ref.Id.length > 256 || !["markdown", "pdf", "tool-read"].includes(Ref.Kind) || !["client-snapshot", "windows-copy", "desktop-read", "unknown"].includes(Ref.Host) || typeof Ref.CapturedAt !== "string" || Ref.CapturedAt.length > 200 || typeof Ref.Truncated !== "boolean") { throw new Error("来源引用格式无效"); }
	safe_source_path(Ref.Path); if(Ref.CurrentPath !== undefined) { safe_source_path(Ref.CurrentPath); }
	if(Ref.PathExact !== undefined && typeof Ref.PathExact !== "boolean") { throw new Error("来源路径精度无效"); }
	if(Ref.Purpose !== undefined && !["selection", "capture", "explanation", "read"].includes(Ref.Purpose)) { throw new Error("来源用途无效"); }
	if(Ref.Mapping !== undefined && !["源文本", "源块", "渲染文本", "PDF文本层", "PDF页图"].includes(Ref.Mapping)) { throw new Error("来源映射类型无效"); }
	if(Ref.Version !== undefined && (typeof Ref.Version !== "string" || Ref.Version.length > 256)) { throw new Error("来源版本无效"); }
	if(Ref.VersionKind !== undefined && !["file-text", "cli-output", "pdf-bytes"].includes(Ref.VersionKind)) { throw new Error("来源版本种类无效"); }
	for(const Key of ["Heading", "BlockId", "Anchor"] as const) { if(Ref[Key] !== undefined && (typeof Ref[Key] !== "string" || Ref[Key]!.length > (Key === "Anchor" ? 512 : 2000))) { throw new Error("来源锚点无效"); } }
	for(const Line of [Ref.LineStart, Ref.LineEnd]) { if(Line !== undefined && Line !== null && (!Number.isSafeInteger(Line) || Line < 0)) { throw new Error("来源行范围无效"); } }
	if(Ref.LineStart != null && Ref.LineEnd != null && Ref.LineEnd < Ref.LineStart) { throw new Error("来源行范围倒置"); }
	if(Ref.Range && (Object.keys(Ref.Range).some(Key => !["From", "To", "Total"].includes(Key)) || !Number.isSafeInteger(Ref.Range.From) || !Number.isSafeInteger(Ref.Range.To) || Ref.Range.From < 0 || Ref.Range.To < Ref.Range.From || (Ref.Range.Total !== undefined && (!Number.isSafeInteger(Ref.Range.Total) || Ref.Range.Total < Ref.Range.To)))) { throw new Error("来源已读范围无效"); }
	if(Ref.Page !== undefined && (!Number.isSafeInteger(Ref.Page) || Ref.Page < 1)) { throw new Error("PDF 来源页码无效"); }
	if(Ref.ImageKind !== undefined || Ref.Region !== undefined) { if(Ref.Kind !== "pdf") { throw new Error("非 PDF 来源不能携带局部图元数据"); } validate_image_origin({ Kind: Ref.ImageKind!, ...(Ref.Region ? { Region: Ref.Region } : {}) }); }
	return Ref;
}
function usable_sources(Refs: unknown): SourceReference[]
{
	if(!Array.isArray(Refs)) { return []; }
	return Refs.flatMap(Value => { try { return [validate_source_reference(Value)]; } catch { return []; } });
}

export function source_reference(Context: ContextSnapshot, Host: SourceReference["Host"] = "client-snapshot"): SourceReference[]
{
	try { safe_source_path(Context.Path); } catch { return []; }
	if(typeof Context.Text !== "string") { return []; }
	if(Context.Pdf) { try { validate_pdf(Context.Pdf); } catch { return []; } }
	const Anchor = (typeof Context.SelectedText === "string" && Context.SelectedText && Context.Mapping === "源文本" ? Context.SelectedText : Context.Text).slice(0, 512), BlockId = Context.Text.match(/(?:^|\n)\s*\^([a-zA-Z0-9-]+)\s*$/)?.[1];
	const Base = { Path: Context.Path, PathExact: true, Version: Context.Version, CapturedAt: typeof Context.CapturedAt === "string" ? Context.CapturedAt : "", Heading: Context.Heading, Mapping: Context.Mapping, LineStart: Context.LineStart, LineEnd: Context.LineEnd, Host, Purpose: Context.Kind === "选区" ? "selection" as const : "capture" as const, Truncated: !!Context.Truncated, ...(Context.Selection ? { Range: { ...Context.Selection } } : {}), ...(Anchor ? { Anchor } : {}), ...(BlockId ? { BlockId } : {}) };
	const Values: Omit<SourceReference, "Id">[] = Context.Pdf ? Context.Pdf.Pages.map(Page => ({ ...Base, Kind: "pdf", VersionKind: "pdf-bytes", Page: Page.Number, ImageKind: Page.Kind ?? "page", ...(Page.Region ? { Region: structuredClone(Page.Region) } : {}) })) : [{ ...Base, Kind: "markdown", VersionKind: "file-text" }];
	if(Context.Explanation && !Context.Pdf)
	{
		const E = Context.Explanation;
		if(typeof E.Text === "string" && Number.isSafeInteger(E.From) && Number.isSafeInteger(E.To) && E.From >= 0 && E.To >= E.From) { Values.push({ ...Base, Kind: "markdown", VersionKind: "file-text", Purpose: "explanation", Range: { From: E.From, To: E.To }, LineStart: E.LineStart, LineEnd: E.LineEnd, Truncated: E.Truncated, Anchor: E.Text.slice(0, 512) }); }
	}
	return Values.map(Value => ({ ...Value, Id: "source-" + text_identity(JSON.stringify(Value)) }));
}

export function tool_read_reference(Input: unknown, Result: unknown, Host: SourceReference["Host"] = "windows-copy", CapturedAt = new Date().toISOString()): SourceReference | null
{
	const Args = Input as any, Reply = Result as any;
	if(Args?.command !== "read" || Reply?.success !== true || !Array.isArray(Reply.contentItems)) { return null; }
	let Page: any;
	try { Page = JSON.parse(Reply.contentItems.find((Item: any) => Item.type === "inputText")?.text ?? ""); } catch { return null; }
	if(typeof Page?.text !== "string" || !Number.isSafeInteger(Page.offset) || Page.offset < 0 || !Number.isSafeInteger(Page.total_chars) || Page.total_chars < Page.offset + Page.text.length || typeof Page.truncated !== "boolean" || !/^[0-9a-f]{64}$/.test(Page.version)) { return null; }
	const Path = typeof Args.params?.path === "string" ? Args.params.path : typeof Args.params?.file === "string" ? Args.params.file : "";
	if(!Path) { return null; }
	try { safe_source_path(Path); } catch { return null; }
	const Value: Omit<SourceReference, "Id"> = { Kind: "tool-read", Path, PathExact: typeof Args.params?.path === "string", Version: Page.version, VersionKind: "cli-output", CapturedAt, Host, Purpose: "read", Truncated: Page.truncated || Page.offset > 0 || Page.offset + Page.text.length < Page.total_chars, Range: { From: Page.offset, To: Page.offset + Page.text.length, Total: Page.total_chars }, Anchor: Page.text.slice(0, 512) };
	return { ...Value, Id: "source-" + text_identity(JSON.stringify(Value)) };
}

export function answer_sources(Messages: readonly SourceMessage[], Message: SourceMessage): SourceReference[]
{
	const User = Message.Role === "user" ? Message : Messages.find(Value => Value.Role === "user" && !!Message.TurnId && Value.TurnId === Message.TurnId);
	const Sources = [...(User?.Context ? source_reference(User.Context) : User?.Task?.Source ? source_reference(User.Task.Source) : []), ...usable_sources(User?.Quote?.SourceReferences), ...usable_sources(User?.Sources), ...usable_sources(Message.Sources)];
	return [...new Map(Sources.map(Source => [Source.Id, structuredClone(Source)])).values()];
}
export const message_sources = answer_sources;
export function source_path_for_answer(Messages: readonly SourceMessage[], Message: SourceMessage): string
{
	const User = Message.Role === "user" ? Message : Messages.find(Value => Value.Role === "user" && !!Message.TurnId && Value.TurnId === Message.TurnId);
	const Path = User?.Context?.Path ?? User?.Task?.Source?.Path ?? User?.Quote?.SourcePath ?? answer_sources(Messages, Message).find(Ref => Ref.PathExact !== false)?.Path ?? "";
	try { return safe_source_path(Path); } catch { return ""; }
}
export { source_path_for_answer as source_path, source_path_for_answer as message_source_path };
export function source_key(Refs: readonly SourceReference[]): string { return JSON.stringify(Refs.map(Ref => [Ref.Id, Ref.CurrentPath, Ref.Version])); }

export function rename_sources(Refs: readonly SourceReference[], Old: string, Next: string): SourceReference[]
{
	safe_source_path(Next);
	return Refs.map(Ref => { const Path = Ref.CurrentPath ?? Ref.Path; return Path === Old || Path.startsWith(Old + "/") ? { ...structuredClone(Ref), CurrentPath: Next + Path.slice(Old.length) } : structuredClone(Ref); });
}

export interface SourceNavigation { Status: "exact" | "changed" | "unknown"; Path: string; Line?: number; Page?: number; Message: string; }

export async function locate_source(AppValue: App, Ref: SourceReference): Promise<SourceNavigation>
{
	if(Ref.PathExact === false) { throw new Error("旧来源只有名称, 无可靠完整路径; 未跳转到另一份同名笔记"); }
	const Path = safe_source_path(Ref.CurrentPath ?? Ref.Path), File = AppValue.vault.getFileByPath(Path);
	if(!File) { throw new Error("原来源路径已不存在. 请从原快照核对或重新定位, 未按同名文件猜测跳转"); }
	if(Ref.Kind === "pdf")
	{
		if(Ref.Version && Ref.VersionKind === "pdf-bytes" && File.stat.size <= 80 * 1024 * 1024)
		{
			const Same = await pdf_hash(await AppValue.vault.readBinary(File)) === Ref.Version;
			return Same ? { Status: "exact", Path, Page: Ref.Page, Message: "PDF 版本一致, 打开原实际页码" } : { Status: "changed", Path, Message: "PDF 版本已变化, 仅打开准确文件; 未把旧页码当作当前同一内容" };
		}
		return { Status: "unknown", Path, Page: Ref.Page, Message: "打开原 PDF 页码; 当时快照保留, 当前版本未知" };
	}
	const Editors = AppValue.workspace?.getLeavesOfType("markdown").map(Leaf => Leaf.view as unknown as { file?: { path: string }; getViewData?: () => string }).filter(View => View.file?.path === Path && typeof View.getViewData === "function") ?? [];
	const OpenText = Editors.map(View => View.getViewData!()), Distinct = [...new Set(OpenText)];
	if(Distinct.length > 1) { return { Status: "unknown", Path, Message: "同文件的编辑器内容存在差异, 仅打开准确文件; 未将磁盘或另一编辑器内容冒充为当前快照" }; }
	const Text = Distinct[0] ?? await AppValue.vault.cachedRead(File), Same = Ref.VersionKind === "file-text" && !!Ref.Version && await version_of(Text) === Ref.Version;
	if(Same) { return { Status: "exact", Path, Line: Ref.LineStart ?? undefined, Message: "文件版本与捕获时一致" }; }
	if(Ref.Anchor)
	{
		const From = Text.indexOf(Ref.Anchor);
		if(From >= 0 && Text.indexOf(Ref.Anchor, From + 1) < 0) { return { Status: Ref.VersionKind === "file-text" ? "changed" : "unknown", Path, Line: Text.slice(0, From).split("\n").length - 1, Message: "按唯一原文锚点定位; 当前文件与当时来源的整体版本未确认一致" }; }
	}
	if(Ref.BlockId)
	{
		const Lines = markdown_blocks(Text).filter(Block => Block.Kind !== "code" && Block.Kind !== "math").flatMap(Block => Block.Text.split("\n").flatMap((Line, Index) => Line.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/)?.[1] === Ref.BlockId ? [Block.LineStart + Index] : []));
		if(Lines.length === 1 && block_ids(Text).filter(Id => Id === Ref.BlockId).length === 1) { return { Status: "changed", Path, Line: Lines[0], Message: "按唯一原块标识定位; 内容可能已变化, 不能当作原快照" }; }
	}
	if(Ref.Heading)
	{
		const Name = Ref.Heading.split(" > ").at(-1), Matches = markdown_blocks(Text).filter(Block => Block.Kind === "heading" && Block.Text.replace(/^\s*#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim() === Name);
		if(Matches.length === 1) { return { Status: "changed", Path, Line: Matches[0].LineStart, Message: "按唯一原标题定位; 这是当前章节, 未冒称原选段未变" }; }
	}
	return { Status: "unknown", Path, Message: "当前内容或定位已变化, 仅打开准确文件; 未猜测原选区" };
}

export async function open_source(AppValue: App, Ref: SourceReference): Promise<SourceNavigation>
{
	const Target = await locate_source(AppValue, Ref), File = AppValue.vault.getFileByPath(Target.Path)!;
	if(Target.Page) { await AppValue.workspace.openLinkText(`${Target.Path}#page=${Target.Page}`, "", true); }
	else
	{
		const Existing = AppValue.workspace.getLeavesOfType("markdown").find(Leaf => (Leaf.view as any).file?.path === Target.Path);
		if(Existing) { await AppValue.workspace.revealLeaf(Existing); AppValue.workspace.setActiveLeaf(Existing, { focus: true }); (Existing.view as any).setEphemeralState?.({ line: Target.Line, focus: true }); }
		else { await AppValue.workspace.getLeaf("tab").openFile(File, { eState: { line: Target.Line, focus: true } }); }
	}
	return Target;
}

export function render_sources(AppValue: App, Root: HTMLElement, Refs: readonly SourceReference[]): void
{
	if(!Refs.length) { return; }
	const Details = Root.createEl("details", { cls: "codex-answer-sources" }); Details.createEl("summary", { text: `来源 (${Refs.length})` });
	const Status = Details.createDiv({ attr: { role: "status" } });
	for(const Ref of Refs)
	{
		const Row = Details.createDiv(), Label = [Ref.CurrentPath ?? Ref.Path, Ref.Page ? `PDF 第 ${Ref.Page} 页${Ref.ImageKind === "region" ? " 局部图" : ""}` : Ref.LineStart !== null && Ref.LineStart !== undefined ? `第 ${Ref.LineStart + 1}-${(Ref.LineEnd ?? Ref.LineStart) + 1} 行` : Ref.Range ? `已读字符 ${Ref.Range.From + 1}-${Ref.Range.To}` : "原始位置未知", Ref.Purpose === "explanation" ? "解释背景" : Ref.Purpose === "selection" ? "原选区" : Ref.Purpose === "read" ? "实际补读" : "", Ref.Mapping, Ref.Host === "windows-copy" ? "Windows 副本" : Ref.Host === "client-snapshot" ? "客户端当时快照" : Ref.Host === "desktop-read" ? "桌面读取" : "宿主未知", Ref.Truncated ? "部分内容" : ""].filter(Boolean).join(" · ");
		const Button = Row.createEl("button", { text: Label, attr: { type: "button" } });
		Button.addEventListener("click", () => { Button.disabled = true; void open_source(AppValue, Ref).then(Target => Status.setText(Target.Message)).catch(ErrorValue => Status.setText(String(ErrorValue))).finally(() => { Button.disabled = false; }); });
	}
}
