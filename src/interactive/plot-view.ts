import { plot_values, sample_plot, validate_plot, type PlotSpec } from "./plot";

let PlotSequence = 0;

function display(Value: number): string
{
	const Rounded = Number(Value.toPrecision(5));
	return Rounded !== 0 && (Math.abs(Rounded) >= 1e4 || Math.abs(Rounded) < 0.001) ? Rounded.toExponential().replace("e+", "e") : Rounded.toString();
}

function automatic_y(Spec: PlotSpec): { min: number; max: number }
{
	const Ys = sample_plot(Spec).flatMap(P => P.y === null ? [] : [Math.max(-1e6, Math.min(1e6, P.y))]);
	if(!Ys.length) { return { min: -1, max: 1 }; }
	const Min = Math.min(0, ...Ys), Max = Math.max(0, ...Ys), Pad = Math.max((Max - Min) * 0.1, 0.1);
	return { min: Math.max(-1e6, Min - Pad), max: Math.min(1e6, Max + Pad) };
}

export function render_plot(Parent: HTMLElement, Spec: PlotSpec, Values: Record<string, number> | undefined, Changed: (Values: Record<string, number>) => void, Active: () => boolean = () => true): { values: () => Record<string, number>; dispose: () => void }
{
	const Plot = validate_plot(Spec), Defaults = plot_values(Plot), Doc = Parent.ownerDocument, Instance = ++PlotSequence;
	let Current = plot_values(Plot, Values), Disposed = false;
	const Root = Doc.createElement("section"); Root.className = "codex-plot";
	function html<K extends keyof HTMLElementTagNameMap>(Tag: K, Class: string, Text?: string, Into: HTMLElement = Root): HTMLElementTagNameMap[K]
	{
		const Element = Doc.createElement(Tag); Element.className = "codex-plot-" + Class;
		if(Text !== undefined) { Element.textContent = Text; }
		Into.appendChild(Element); return Element;
	}
	function svg<K extends keyof SVGElementTagNameMap>(Tag: K, Attributes: Record<string, string>, Into: SVGElement): SVGElementTagNameMap[K]
	{
		const Element = Doc.createElementNS("http://www.w3.org/2000/svg", Tag);
		for(const [Key, Value] of Object.entries(Attributes)) { Element.setAttribute(Key, Value); }
		Into.appendChild(Element); return Element;
	}
	html("h4", "title", Plot.title);
	html("span", "kind", "有限采样图 · 固定纵轴");
	html("code", "expression", "y = " + Plot.expression);
	const Chart = Doc.createElementNS("http://www.w3.org/2000/svg", "svg");
	Chart.classList.add("codex-plot-svg"); Chart.setAttribute("viewBox", "0 0 360 240"); Chart.setAttribute("width", "100%"); Chart.setAttribute("role", "img");
	Chart.setAttribute("aria-label", Plot.title + ": y = " + Plot.expression);
	Root.appendChild(Chart);
	svg("title", {}, Chart).textContent = Plot.title + ": y = " + Plot.expression;
	const Description = svg("desc", {}, Chart), Y = Plot.y ?? automatic_y(Plot);
	const Left = 50, Top = 18, Width = 280, Height = 174;
	for(let Index = 0; Index <= 4; Index++)
	{
		const Ratio = Index / 4, XPosition = Left + Width * Ratio, YPosition = Top + Height * (1 - Ratio);
		svg("line", { x1: String(XPosition), x2: String(XPosition), y1: String(Top), y2: String(Top + Height), stroke: "var(--background-modifier-border, #ccc)" }, Chart);
		svg("line", { x1: String(Left), x2: String(Left + Width), y1: String(YPosition), y2: String(YPosition), stroke: "var(--background-modifier-border, #ccc)" }, Chart);
		svg("text", { x: String(XPosition), y: String(Top + Height + 20), "text-anchor": "middle", fill: "var(--text-muted, #666)", "font-size": "14" }, Chart).textContent = display(Plot.x.min + (Plot.x.max - Plot.x.min) * Ratio);
		svg("text", { x: String(Left - 6), y: String(YPosition + 4), "text-anchor": "end", fill: "var(--text-muted, #666)", "font-size": "14" }, Chart).textContent = display(Y.min + (Y.max - Y.min) * Ratio);
	}
	const Axis = "var(--text-muted, #666)", AxisY = Top + Height * (1 - Math.max(0, Math.min(1, -Y.min / (Y.max - Y.min))));
	const AxisX = Left + Width * Math.max(0, Math.min(1, -Plot.x.min / (Plot.x.max - Plot.x.min)));
	svg("line", { x1: String(Left), x2: String(Left + Width), y1: String(AxisY), y2: String(AxisY), stroke: Axis }, Chart);
	svg("line", { x1: String(AxisX), x2: String(AxisX), y1: String(Top), y2: String(Top + Height), stroke: Axis }, Chart);
	svg("text", { x: "340", y: "232", fill: Axis, "font-size": "14" }, Chart).textContent = "x";
	svg("text", { x: "12", y: "14", fill: Axis, "font-size": "14" }, Chart).textContent = "y";
	const Viewport = svg("svg", { x: String(Left), y: String(Top), width: String(Width), height: String(Height), viewBox: `0 0 ${Width} ${Height}`, overflow: "hidden" }, Chart);
	const Path = svg("path", { class: "codex-plot-path", fill: "none", stroke: "var(--interactive-accent, #6b63d9)", "stroke-width": "2", "vector-effect": "non-scaling-stroke" }, Viewport);
	const Controls = html("div", "controls"), Inputs: HTMLInputElement[] = [], Outputs: HTMLOutputElement[] = [];
	const Listeners: { element: HTMLElement; event: string; handler: () => void }[] = [];
	function listen(Element: HTMLElement, Event: string, Handler: () => void): void
	{
		Element.addEventListener(Event, Handler); Listeners.push({ element: Element, event: Event, handler: Handler });
	}
	for(const Parameter of Plot.parameters)
	{
		const Label = html("label", "parameter", undefined, Controls), Heading = html("span", "parameter-heading", undefined, Label);
		html("span", "parameter-name", Parameter.label, Heading);
		const Output = html("output", "value", undefined, Heading), Input = html("input", "slider", undefined, Label);
		Input.id = `codex-plot-${Instance}-${Parameter.name}`; Label.htmlFor = Input.id;
		Input.type = "range"; Input.min = String(Parameter.min); Input.max = String(Parameter.max); Input.step = String(Parameter.step);
		html("span", "range", `${display(Parameter.min)} – ${display(Parameter.max)}, 步长 ${display(Parameter.step)}`, Label);
		Inputs.push(Input); Outputs.push(Output);
		listen(Input, "input", () =>
		{
			if(!Disposed && !Active()) { Input.value = String(Current[Parameter.name]); return; }
			if(Disposed || !Number.isFinite(Number(Input.value))) { return; }
			const Next = plot_values(Plot, { ...Current, [Parameter.name]: Number(Input.value) });
			if(Next[Parameter.name] === Current[Parameter.name]) { return; }
			Current = Next; update(); Changed({ ...Current });
		});
	}
	const Reset = html("button", "reset", "重置参数"); Reset.type = "button";
	const Status = html("p", "status"); Status.setAttribute("role", "status");
	if(Plot.caption) { html("p", "caption", Plot.caption); }
	listen(Reset, "click", () =>
	{
		if(Disposed || !Active() || Reset.disabled) { return; }
		Current = { ...Defaults }; update(); Changed({ ...Current });
	});
	function update(): void
	{
		const Points = sample_plot(Plot, Current);
		let Data = "", Drawing = false, Missing = 0, Clipped = false;
		for(let Index = 0; Index < Points.length; Index++)
		{
			const Value = Points[Index].y;
			if(Value === null) { Drawing = false; Missing++; continue; }
			Clipped ||= Value < Y.min || Value > Y.max;
			const PX = Width * Index / (Points.length - 1), PY = Height * Math.max(-1e6, Math.min(1e6, 1 - (Value - Y.min) / (Y.max - Y.min)));
			Data += `${Drawing ? "L" : "M"}${PX.toFixed(2)},${PY.toFixed(2)} `; Drawing = true;
		}
		Path.setAttribute("d", Data.trim());
		for(let Index = 0; Index < Plot.parameters.length; Index++)
		{
			const P = Plot.parameters[Index], Value = String(Current[P.name]);
			Inputs[Index].value = Value; Inputs[Index].setAttribute("aria-valuetext", Value); Outputs[Index].value = Value; Outputs[Index].textContent = Value;
		}
		Reset.disabled = Plot.parameters.every(P => Current[P.name] === Defaults[P.name]);
		const Parameters = Plot.parameters.map(P => `${P.name} = ${Current[P.name]}`).join(", ");
		Status.textContent = `x: ${display(Plot.x.min)} … ${display(Plot.x.max)}; y: ${display(Y.min)} … ${display(Y.max)}。${Missing === Points.length ? "当前采样均无定义或非有限。" : Missing ? `${Missing} 个采样断点。` : ""}${Clipped ? "部分曲线超出纵轴范围。" : ""}`;
		Description.textContent = `${Status.textContent}${Parameters ? " 参数: " + Parameters : ""}`;
	}
	update(); Parent.appendChild(Root);
	return {
		values: () => ({ ...Current }),
		dispose: () =>
		{
			if(Disposed) { return; }
			Disposed = true;
			for(const Listener of Listeners) { Listener.element.removeEventListener(Listener.event, Listener.handler); }
			Root.remove();
		}
	};
}
