import type { InteractivePanelOptions } from "./panel";
import { locate_symbol, validate_symbol, type SymbolSpec } from "./symbols";

export function ui_element<K extends keyof HTMLElementTagNameMap>(Root: HTMLElement, Tag: K, Class = "", Text = ""): HTMLElementTagNameMap[K]
{
	const E = Root.ownerDocument.createElement(Tag); E.className = Class; E.textContent = Text; Root.append(E); return E;
}

type SymbolViewOptions = Pick<InteractivePanelOptions, "Contexts" | "Sources" | "Markdown" | "OpenSource" | "Followup" | "Active"> & { Status: (Text: string) => void };

/** Only a current, live selection may publish asynchronous render/navigation results. */
export async function render_symbol_detail(Root: HTMLElement, S: SymbolSpec, Options: SymbolViewOptions, Question?: string, AskLabel = "追问此符号"): Promise<void>
{
	const Active = Options.Active;
	if(!Active()) { return; }
	await Options.Markdown(S.meaning, ui_element(Root, "div", "codex-symbol-meaning markdown-rendered"));
	if(!Active()) { return; }
	if(S.conditions)
	{
		ui_element(Root, "div", "codex-interactive-heading", "使用条件");
		await Options.Markdown(S.conditions, ui_element(Root, "div", "codex-symbol-conditions markdown-rendered"));
		if(!Active()) { return; }
	}
	const Location = locate_symbol(S, Options.Contexts, Options.Sources);
	ui_element(Root, "div", "codex-symbol-origin", Location.Message);
	if(Location.Quote)
	{
		const Quote = ui_element(Root, "blockquote", "codex-symbol-source markdown-rendered");
		let Safe = false;
		try { validate_symbol({ id: "quote", symbol: "引用", meaning: Location.Quote }); Safe = true; } catch { /* Unsafe source syntax stays literal. */ }
		if(Safe) { await Options.Markdown(Location.Quote, Quote); } else { Quote.textContent = Location.Quote; }
		if(!Active()) { return; }
	}
	if(Location.Source)
	{
		const Ref = Location.Source;
		ui_element(Root, "div", "codex-symbol-metadata", [Ref.Path, Ref.Page ? `PDF 第 ${Ref.Page} 页` : Ref.LineStart != null ? `第 ${Ref.LineStart + 1} 行` : "", Ref.Host === "windows-copy" ? "Windows 副本" : "原来源快照", Ref.Mapping, Ref.CapturedAt, Ref.Truncated ? "来源已截断" : ""].filter(Boolean).join(" · "));
		const Open = ui_element(Root, "button", "codex-symbol-open", Ref.Kind === "pdf" ? "打开原 PDF 来源" : "定位原文"); Open.type = "button";
		Open.addEventListener("click", () =>
		{
			if(!Active() || Open.disabled) { return; }
			Open.disabled = true;
			void Options.OpenSource(Ref).then(Result => { if(Active()) { Options.Status(Result); } }).catch(E => { if(Active()) { Options.Status(String(E)); } }).finally(() => { if(Active()) { Open.disabled = false; } });
		});
	}
	if(Question)
	{
		const Ask = ui_element(Root, "button", "codex-interactive-followup", AskLabel); Ask.type = "button";
		Ask.addEventListener("click", () => { if(Active()) { Options.Followup(Question, S.symbol); } });
	}
}

export function symbol_reading(S: SymbolSpec, Options: Pick<InteractivePanelOptions, "Contexts" | "Sources">): string
{
	const L = locate_symbol(S, Options.Contexts, Options.Sources), Fence = "`".repeat(Math.max(3, ...[...S.quote?.matchAll(/`+/g) ?? []].map(M => M[0].length + 1)));
	return `${S.meaning}${S.conditions ? "\n\n使用条件: " + S.conditions : ""}\n\n${L.Message}${L.Source ? "\n\n来源: " + L.Source.Path + (L.Source.Page ? " / PDF 第 " + L.Source.Page + " 页" : "") : ""}${S.quote ? "\n\n引用片段:\n\n" + Fence + "text\n" + S.quote + "\n" + Fence : ""}`;
}
