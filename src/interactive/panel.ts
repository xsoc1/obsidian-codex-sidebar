import type { ContextSnapshot } from "../prompt";
import type { SourceReference } from "../sources";
import { interactive_markdown, type InteractiveOutput } from "./protocol";
import { InteractiveStateStore, type InteractiveState } from "./state";
import { plot_values } from "./plot";
import { render_plot } from "./plot-view";
import { render_symbol_detail, symbol_reading } from "./symbol-view";
import { render_relation, render_walkthrough, structures_reading } from "./structures-view";

export interface InteractivePanelOptions
{
	Scope: string; SessionId: string; MessageId: string;
	Contexts: readonly ContextSnapshot[]; Sources: readonly SourceReference[];
	Storage: { getItem(Key: string): string | null; setItem(Key: string, Value: string): void };
	Active: () => boolean;
	Markdown: (Text: string, Root: HTMLElement) => Promise<void>;
	OpenSource: (Source: SourceReference) => Promise<string>;
	Followup: (Question: string, Selection: string) => void;
	Copy: (Text: string) => Promise<void>;
}

function element<K extends keyof HTMLElementTagNameMap>(Root: HTMLElement, Tag: K, Class = "", Text = ""): HTMLElementTagNameMap[K]
{
	const E = Root.ownerDocument.createElement(Tag); E.className = Class; E.textContent = Text; Root.append(E); return E;
}

export async function render_interactive(Parent: HTMLElement, Body: HTMLElement, Text: string, Output: InteractiveOutput, Options: InteractivePanelOptions): Promise<() => void>
{
	if(Output.Status === "none") { return () => {}; }
	const Panel = element(Parent, "section", "codex-interactive"), Status = element(Panel, "div", "codex-interactive-status"); Status.setAttribute("role", "status");
	if(Output.Status !== "ready" || !Output.Spec)
	{
		Status.textContent = Output.Status === "pending" ? "交互内容待回答完整完成后启用" : "交互内容未启用: " + Output.Error;
		return () => Panel.remove();
	}
	const Spec = Output.Spec, Disposers: (() => void)[] = [];
	let Alive = true, Ticket = 0, Store: InteractiveStateStore | undefined, StorageError = "";
	const Active = () => Alive && Options.Active();
	let State: InteractiveState = { Values: Object.fromEntries(Spec.plots.map(P => [P.id, plot_values(P)])), Symbol: "" };
	try { Store = new InteractiveStateStore(Options.Storage, Options.Scope, Options.SessionId, Options.MessageId, Spec); State = Store.load(); }
	catch(E) { Store = undefined; StorageError = E instanceof Error ? E.message : "本设备交互状态无法读取"; Status.textContent = StorageError + "; 本次调整暂不保存"; }
	const Save = () =>
	{
		if(!Active()) { return; }
		try { Store?.save(State); Status.textContent = Store ? "交互状态已保存在本设备" : StorageError + "; 本次调整暂不保存"; }
		catch(E) { Status.textContent = E instanceof Error ? E.message : "交互状态未保存"; }
	};
	for(const P of Spec.plots)
	{
		const Root = element(Panel, "div", "codex-interactive-plot");
		const Plot = render_plot(Root, P, State.Values[P.id], Values => { if(Active()) { State.Values[P.id] = Values; Save(); } }, Active);
		Disposers.push(Plot.dispose);
		const Ask = element(Root, "button", "codex-interactive-followup", "带当前参数追问"); Ask.type = "button";
		Ask.addEventListener("click", () => { if(Active()) { Options.Followup(`请结合图“${P.title}”继续解释. 函数 y=${P.expression}; 当前参数: ${JSON.stringify(Plot.values())}. 请连接完整说明与这些参数的作用.`, P.expression); } });
	}
	if(Spec.symbols.length)
	{
		const Symbols = element(Panel, "div", "codex-interactive-symbols"), Label = element(Symbols, "div", "codex-interactive-heading", "符号与条件");
		Label.id = "codex-symbols-" + crypto.randomUUID();
		const Choices = element(Symbols, "div", "codex-symbol-choices"); Choices.setAttribute("role", "group"); Choices.setAttribute("aria-labelledby", Label.id);
		const Detail = element(Symbols, "div", "codex-symbol-detail"); Detail.id = "codex-symbol-detail-" + crypto.randomUUID();
		let InlineOrigin: HTMLElement | undefined;
		const Buttons = new Map<string, HTMLButtonElement>();
		const Select = async (Id: string, Persist: boolean) =>
		{
			if(!Active()) { return; }
			const S = Spec.symbols.find(S => S.id === Id)!; State.Symbol = Id;
			if(Persist) { Save(); }
			for(const [Key, B] of Buttons) { B.setAttribute("aria-pressed", String(Key === Id)); }
			const Current = ++Ticket, Next = Detail.ownerDocument.createElement("div"), CurrentSelection = () => Active() && Ticket === Current;
			await render_symbol_detail(Next, S, { ...Options, Active: CurrentSelection, Status: Message => { Status.textContent = Message; } }, `请进一步解释符号 ${S.symbol} 的含义、使用条件及它在原说明中的作用.`, "追问此符号");
			if(InlineOrigin)
			{
				const Back = element(Next, "button", "codex-symbol-back", "返回刚才的符号"); Back.type = "button";
				Back.addEventListener("click", () => { if(Active() && InlineOrigin?.isConnected) { InlineOrigin.scrollIntoView({ block: "nearest" }); InlineOrigin.focus({ preventScroll: true }); } });
			}
			if(Active() && Ticket === Current) { Detail.replaceChildren(Next); }
		};
		for(const S of Spec.symbols)
		{
			const Button = element(Choices, "button", "codex-symbol-choice"); Button.type = "button"; Button.setAttribute("aria-pressed", "false");
			await Options.Markdown(S.symbol, Button); Buttons.set(S.id, Button);
			Button.addEventListener("click", () => { void Select(S.id, true).catch(E => { Status.textContent = String(E); }); });
		}
		// Native MathJax exposes the exact original TeX. Do not guess from glyph text.
		for(const Math of Body.querySelectorAll<HTMLElement>(".math-inline"))
		{
			const Latex = Math.querySelector("mjx-math")?.getAttribute("data-latex");
			const Matches = Spec.symbols.filter(S => S.symbol.match(/^\$([^$\n]+)\$$/)?.[1] === Latex);
			if(!Latex || Matches.length !== 1) { continue; }
			const S = Matches[0], Previous = ["role", "tabindex", "aria-label", "aria-controls"].map(Name => [Name, Math.getAttribute(Name)] as const);
			Math.classList.add("codex-symbol-inline"); Math.setAttribute("role", "button"); Math.tabIndex = 0; Math.setAttribute("aria-label", "查看符号 " + Latex + " 的含义与条件"); Math.setAttribute("aria-controls", Detail.id);
			const Click = () =>
			{
				if(!Active() || Body.ownerDocument.defaultView?.getSelection()?.toString()) { return; }
				InlineOrigin = Math;
				void Select(S.id, true).then(() => { if(Active()) { Detail.scrollIntoView({ block: "nearest" }); } }).catch(E => { Status.textContent = String(E); });
			};
			const Key = (E: KeyboardEvent) => { if(E.key === "Enter" || E.key === " ") { E.preventDefault(); Click(); } };
			Math.addEventListener("click", Click); Math.addEventListener("keydown", Key);
			Disposers.push(() => { Math.removeEventListener("click", Click); Math.removeEventListener("keydown", Key); Math.classList.remove("codex-symbol-inline"); for(const [Name, Value] of Previous) { if(Value === null) { Math.removeAttribute(Name); } else { Math.setAttribute(Name, Value); } } });
		}
		await Select(State.Symbol || Spec.symbols[0].id, false);
	}
	for(const Group of [...(Spec.relations ?? []), ...(Spec.walkthroughs ?? [])])
	{
		if(!Active()) { break; }
		const ViewOptions = { ...Options, Active, Status: (Message: string) => { if(Active()) { Status.textContent = Message; } }, Changed: (Id: string) => { if(Active()) { State.Views = { ...State.Views, [Group.id]: Id }; Save(); } } };
		const View = await ("nodes" in Group ? render_relation(Panel, Group, State.Views?.[Group.id], ViewOptions) : render_walkthrough(Panel, Group, State.Views?.[Group.id], ViewOptions));
		Disposers.push(View.dispose);
	}
	const Copy = element(Panel, "button", "codex-interactive-copy", Spec.relations?.length || Spec.walkthroughs?.length ? "复制阅读版与当前选择" : "复制阅读版与当前参数"); Copy.type = "button";
	Copy.addEventListener("click", () =>
	{
		if(!Active()) { return; }
		const Reading = [interactive_markdown(Text, Output), ...Spec.plots.map(P => `### ${P.title}\n\n函数: \`${P.expression}\`; 当前参数: \`${JSON.stringify(State.Values[P.id])}\`.\n\n${P.caption ?? ""}`), ...(State.Symbol ? ["当前符号: " + Spec.symbols.find(S => S.id === State.Symbol)!.symbol] : []), ...Spec.symbols.map(S => `### ${S.symbol}\n\n${symbol_reading(S, Options)}`), ...structures_reading(Spec.relations ?? [], Spec.walkthroughs ?? [], State, Options)].join("\n\n");
		void Options.Copy(Reading).then(() => { if(Active()) { Status.textContent = "已复制普通 Markdown 阅读版"; } }).catch(E => { if(Active()) { Status.textContent = String(E); } });
	});
	const Raw = element(Panel, "details", "codex-interactive-raw"); element(Raw, "summary", "", "交互数据"); element(Raw, "pre", "", Output.Raw);
	// Bind Markdown blocks before this step; ordinary answer selections keep original offsets.
	const Code = [...Body.querySelectorAll("pre code")].filter(C => C.textContent?.trim() === Output.Raw);
	if(Code.length === 1) { Code[0].closest("pre")!.hidden = true; }
	return () => { Alive = false; Ticket++; Disposers.forEach(Dispose => Dispose()); Panel.remove(); };
}
