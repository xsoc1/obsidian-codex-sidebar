export function observe_sidebar_footer(Root: HTMLElement): () => void
{
	const DocumentValue = Root.ownerDocument;
	const View = DocumentValue.defaultView;
	if(!View) { return () => {}; }
	let Status: HTMLElement | null = null;
	let Frame = 0;
	let Closed = false;
	const Host = DocumentValue.querySelector(".app-container") ?? DocumentValue.body;
	const update = () =>
	{
		Frame = 0;
		if(Closed) { return; }
		const Bounds = Root.getBoundingClientRect();
		const Footer = Status?.getBoundingClientRect();
		const Visible = Status && View.getComputedStyle(Status).visibility !== "hidden";
		const Overlap = Footer && Visible && Footer.width > 0 && Footer.height > 0
			&& Footer.left < Bounds.right && Footer.right > Bounds.left
			&& Footer.top < Bounds.bottom && Footer.bottom >= Bounds.bottom - 1;
		const Inset = Overlap ? Math.ceil(Bounds.bottom - Math.max(Bounds.top, Footer.top)) : 0;
		const Value = `${Inset}px`;
		if(Root.style.getPropertyValue("--codex-footer-inset") !== Value) { Root.style.setProperty("--codex-footer-inset", Value); }
	};
	const schedule = () => { if(!Closed && !Frame) { Frame = View.requestAnimationFrame(update); } };
	const Sizes = new View.ResizeObserver(schedule);
	const Changes = new View.MutationObserver(() => { watch_status(); schedule(); });
	const watch_status = () =>
	{
		const Next = DocumentValue.querySelector<HTMLElement>(".status-bar");
		if(Next === Status) { return; }
		if(Status) { Sizes.unobserve(Status); }
		Status = Next;
		Changes.disconnect();
		Changes.observe(Host, { childList: true });
		if(Status)
		{
			Sizes.observe(Status);
			Changes.observe(Status, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
		}
	};
	Changes.observe(Host, { childList: true });
	Sizes.observe(Root);
	Sizes.observe(Host);
	watch_status();
	View.addEventListener("resize", schedule);
	update();
	return () =>
	{
		Closed = true;
		if(Frame) { View.cancelAnimationFrame(Frame); }
		Sizes.disconnect(); Changes.disconnect();
		View.removeEventListener("resize", schedule);
		Root.style.removeProperty("--codex-footer-inset");
	};
}
