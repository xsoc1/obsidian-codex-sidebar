import type { InteractivePanelOptions } from "./panel";
import type { InteractiveState } from "./state";
import type { SymbolSpec } from "./symbols";
import { validate_relation, validate_walkthrough, type RelationSpec, type WalkthroughSpec } from "./structures";
import { render_symbol_detail, symbol_reading, ui_element as element } from "./symbol-view";
import { ExplanationActions, explanation_question } from "../explanation-actions";

type ViewOptions = InteractivePanelOptions & { Status: (Text: string) => void; Changed: (Id: string) => void };
interface StructureView { dispose: () => void; }

/** Both structures share one selection machine; each instance has its own async ticket. */
async function render_structure(Parent: HTMLElement, Spec: RelationSpec | WalkthroughSpec, Selected: string | undefined, Options: ViewOptions): Promise<StructureView>
{
	const Relation = "nodes" in Spec, Items = Relation ? Spec.nodes : Spec.steps;
	const Root = element(Parent, "section", "codex-structure " + (Relation ? "codex-relation" : "codex-walkthrough"));
	Root.setAttribute("data-component-id", Spec.id);
	let Alive = true, Ticket = 0, Selection = Items.find(S => S.id === Selected)?.id ?? Items[0].id;
	const Active = () => Alive && Options.Active(), Buttons = new Map<string, HTMLButtonElement>(), Cleanups: (() => void)[] = [];
	const Heading = element(Root, "h4", "codex-structure-title"); Heading.id = "codex-structure-" + crypto.randomUUID();
	Root.setAttribute("aria-labelledby", Heading.id);
	const Choices = element(Root, "div", Relation ? "codex-relation-canvas" : "codex-walkthrough-choices");
	Choices.setAttribute("role", "group"); Choices.setAttribute("aria-labelledby", Heading.id);
	const Controls = Relation ? undefined : element(Root, "div", "codex-walkthrough-controls");
	const Previous = Controls ? element(Controls, "button", "codex-walkthrough-previous", "上一步") : undefined;
	const Position = Controls ? element(Controls, "span", "codex-walkthrough-position") : undefined;
	if(Position) { Position.setAttribute("role", "status"); Position.setAttribute("aria-live", "polite"); }
	const Next = Controls ? element(Controls, "button", "codex-walkthrough-next", "下一步") : undefined;
	if(Previous) { Previous.type = "button"; }
	if(Next) { Next.type = "button"; }
	const Detail = element(Root, "div", "codex-structure-detail"); Detail.id = "codex-structure-detail-" + crypto.randomUUID();
	let Draw = () => {};
	const Select = async (Id: string, Persist: boolean) =>
	{
		if(!Active()) { return; }
		const S = Items.find(S => S.id === Id); if(!S) { return; }
		Selection = Id; if(Persist) { Options.Changed(Id); }
		for(const [Key, Button] of Buttons) { Button.setAttribute("aria-pressed", String(Key === Id)); }
		const Index = Items.indexOf(S);
		if(Previous) { Previous.disabled = Index === 0; }
		if(Next) { Next.disabled = Index === Items.length - 1; }
		if(Position) { Position.textContent = `第 ${Index + 1} / ${Items.length} 步`; }
		Draw();
		const Current = ++Ticket, CurrentSelection = () => Active() && Ticket === Current;
		const Content = Detail.ownerDocument.createElement("div");
		Detail.setAttribute("aria-busy", "true");
		try
		{
			await Options.Markdown(S.symbol, element(Content, "div", "codex-structure-current markdown-rendered"));
			if(!CurrentSelection()) { return; }
			await render_symbol_detail(Content, S, { ...Options, Active: CurrentSelection });
			if(!CurrentSelection()) { return; }
			const Actions = element(Content, "div", "codex-structure-actions"); Actions.setAttribute("role", "group"); Actions.setAttribute("aria-label", Relation ? "解释当前节点" : "解释当前步骤");
			for(const Action of ExplanationActions)
			{
				const Button = element(Actions, "button", "codex-structure-action", Action.Label); Button.type = "button"; Button.setAttribute("data-action", Action.Id);
				Button.addEventListener("click", () => { if(CurrentSelection()) { Options.Followup(explanation_question(Action.Id), S.symbol + "\n\n" + S.meaning + (S.conditions ? "\n\n使用条件: " + S.conditions : "")); } });
			}
			Detail.replaceChildren(Content);
		}
		catch(E) { if(CurrentSelection()) { Options.Status(String(E)); } }
		finally { if(CurrentSelection()) { Detail.setAttribute("aria-busy", "false"); } }
	};
	const Run = (Id: string) => { void Select(Id, true).catch(E => { if(Active()) { Options.Status(String(E)); } }); };
	const Move = (Delta: number) => { const Index = Items.findIndex(S => S.id === Selection), S = Items[Index + Delta]; if(S) { Run(S.id); } };
	const Dispose = () => { if(!Alive) { return; } Alive = false; Ticket++; Cleanups.forEach(F => F()); Root.remove(); };
	try
	{
		await Options.Markdown(Spec.title, Heading);
		if(!Active()) { Dispose(); return { dispose: Dispose }; }
		for(const [Index, S] of Items.entries())
		{
			const Button = element(Choices, "button", Relation ? "codex-relation-node" : "codex-walkthrough-step");
			Button.setAttribute("data-item-id", S.id);
			Button.type = "button"; Button.setAttribute("aria-controls", Detail.id); Button.setAttribute("aria-pressed", String(S.id === Selection));
			if(!Relation) { element(Button, "span", "codex-walkthrough-number", String(Index + 1)); }
			await Options.Markdown(S.symbol, element(Button, "span", "codex-structure-label markdown-rendered"));
			if(!Active()) { Dispose(); return { dispose: Dispose }; }
			Buttons.set(S.id, Button);
			Button.addEventListener("click", () => { Run(S.id); });
			Button.addEventListener("keydown", Event =>
			{
				if(!Active()) { return; }
				const Target = Event.key === "Home" ? 0 : Event.key === "End" ? Items.length - 1 : ["ArrowRight", "ArrowDown"].includes(Event.key) ? Math.min(Items.length - 1, Index + 1) : ["ArrowLeft", "ArrowUp"].includes(Event.key) ? Math.max(0, Index - 1) : -1;
				if(Target < 0) { return; }
				Event.preventDefault(); Buttons.get(Items[Target].id)?.focus(); Run(Items[Target].id);
			});
		}
		Previous?.addEventListener("click", () => { if(Active() && !Previous.disabled) { Move(-1); } });
		Next?.addEventListener("click", () => { if(Active() && !Next.disabled) { Move(1); } });
		if(Relation)
		{
			const Svg = Choices.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
			Svg.setAttribute("class", "codex-relation-arrows"); Svg.setAttribute("aria-hidden", "true"); Choices.prepend(Svg);
			function svg(Tag: string, Attributes: Record<string, string>, Into: SVGElement): SVGElement
			{
				const E = Svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", Tag); for(const [K, V] of Object.entries(Attributes)) { E.setAttribute(K, V); } Into.append(E); return E;
			}
			const MarkerId = "codex-arrow-" + crypto.randomUUID(), Defs = svg("defs", {}, Svg), Marker = svg("marker", { id: MarkerId, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, Defs);
			svg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--text-muted, #888)" }, Marker);
			const Paths = Spec.edges.map(() => svg("path", { class: "codex-relation-edge", fill: "none", "stroke-width": "2", "marker-end": `url(#${MarkerId})` }, Svg));
			const Legend = element(Root, "ol", "codex-relation-edges"); Root.insertBefore(Legend, Detail);
			for(const E of Spec.edges)
			{
				const Row = element(Legend, "li", "codex-relation-edge-label");
				// Validated fragments must not combine into new Markdown/HTML syntax.
				for(const [Index, Part] of [Spec.nodes.find(S => S.id === E.from)!.symbol, Spec.nodes.find(S => S.id === E.to)!.symbol, E.label].entries())
				{
					if(Index) { element(Row, "span", "", Index === 1 ? " → " : ": "); }
					await Options.Markdown(Part, element(Row, "span", "codex-structure-edge-text markdown-rendered"));
					if(!Active()) { Dispose(); return { dispose: Dispose }; }
				}
			}
			Draw = () =>
			{
				if(!Active()) { return; }
				const Area = Choices.getBoundingClientRect(); if(!Area.width || !Area.height) { return; }
				Svg.setAttribute("viewBox", `0 0 ${Area.width} ${Area.height}`);
				for(const [Index, E] of Spec.edges.entries())
				{
					const A = Buttons.get(E.from)!.getBoundingClientRect(), B = Buttons.get(E.to)!.getBoundingClientRect();
					const AX = A.x - Area.x, AY = A.y - Area.y, BX = B.x - Area.x, BY = B.y - Area.y;
					const SameColumn = Math.abs(AX - BX) < Math.min(A.width, B.width) / 2, Right = AX > Area.width / 2, Offset = 18 + (Index % 3) * 8;
					let X1: number, X2: number, Y1 = AY + A.height / 2, Y2 = BY + B.height / 2, C1: number, C2: number;
					if(E.from === E.to)
					{
						X1 = AX + A.width; X2 = X1; Y1 = AY + A.height / 3; Y2 = AY + A.height * 2 / 3; C1 = C2 = X1 + 32;
					}
					else if(SameColumn)
					{
						X1 = AX + (Right ? A.width : 0); X2 = BX + (Right ? B.width : 0); C1 = C2 = (Right ? Math.max(X1, X2) + Offset : Math.min(X1, X2) - Offset);
					}
					else
					{
						const Forward = AX < BX; X1 = AX + (Forward ? A.width : 0); X2 = BX + (Forward ? 0 : B.width); C1 = X1 + (Forward ? Offset : -Offset); C2 = X2 + (Forward ? -Offset : Offset);
					}
					Paths[Index].setAttribute("d", `M ${X1} ${Y1} C ${C1} ${Y1} ${C2} ${Y2} ${X2} ${Y2}`);
					Paths[Index].setAttribute("data-selected", String(E.from === Selection || E.to === Selection));
				}
			};
			const Observer = Root.ownerDocument.defaultView?.ResizeObserver;
			if(Observer) { const R = new Observer(Draw); R.observe(Choices); for(const B of Buttons.values()) { R.observe(B); } Cleanups.push(() => R.disconnect()); }
			const Window = Root.ownerDocument.defaultView; Window?.addEventListener("resize", Draw); Cleanups.push(() => Window?.removeEventListener("resize", Draw));
		}
		await Select(Selection, false);
		return { dispose: Dispose };
	}
	catch(E) { Dispose(); throw E; }
}

export function render_relation(Parent: HTMLElement, Spec: RelationSpec, Selected: string | undefined, Options: ViewOptions): Promise<StructureView>
{
	return render_structure(Parent, validate_relation(Spec), Selected, Options);
}

export function render_walkthrough(Parent: HTMLElement, Spec: WalkthroughSpec, Selected: string | undefined, Options: ViewOptions): Promise<StructureView>
{
	return render_structure(Parent, validate_walkthrough(Spec), Selected, Options);
}

export function structures_reading(Relations: readonly RelationSpec[], Walkthroughs: readonly WalkthroughSpec[], State: InteractiveState, Options: Pick<InteractivePanelOptions, "Contexts" | "Sources">): string[]
{
	const Entry = (S: SymbolSpec, Index: number) => `#### ${Index + 1}. ${S.symbol}\n\n${symbol_reading(S, Options)}`;
	return [
		...Relations.map(R => `### ${R.title}\n\n当前节点: ${R.nodes.find(S => S.id === State.Views?.[R.id])?.symbol ?? R.nodes[0].symbol}\n\n方向关系:\n\n${R.edges.map(E => `- ${R.nodes.find(S => S.id === E.from)!.symbol} → ${R.nodes.find(S => S.id === E.to)!.symbol}: ${E.label}`).join("\n") || "无边"}\n\n${R.nodes.map(Entry).join("\n\n")}`),
		...Walkthroughs.map(W => `### ${W.title}\n\n当前步骤: ${W.steps.findIndex(S => S.id === State.Views?.[W.id]) + 1 || 1} / ${W.steps.length} · ${W.steps.find(S => S.id === State.Views?.[W.id])?.symbol ?? W.steps[0].symbol}\n\n${W.steps.map(Entry).join("\n\n")}`)
	];
}
