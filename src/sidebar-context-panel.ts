export class SidebarContextPanel
{
	readonly Trigger: HTMLButtonElement;
	readonly Body: HTMLElement;
	private readonly Panel: HTMLElement;
	private readonly Status: HTMLElement;
	private readonly Close: HTMLButtonElement;
	private Events: AbortController | null = null;

	constructor(Toolbar: HTMLElement, Reading: HTMLElement)
	{
		const Id = `codex-context-${crypto.randomUUID()}`;
		this.Trigger = Toolbar.createEl("button", { cls: "codex-context-trigger", attr: { type: "button", "aria-controls": Id, "aria-expanded": "false" } });
		this.Trigger.createSpan({ cls: "codex-context-title", text: "上下文" });
		this.Status = this.Trigger.createSpan({ cls: "codex-context-state" });
		this.Panel = Reading.createEl("section", { cls: "codex-context-popover", attr: { id: Id, "aria-labelledby": `${Id}-heading` } });
		this.Panel.hidden = true;
		const Header = this.Panel.createDiv({ cls: "codex-context-popover-header" });
		Header.createEl("h2", { text: "上下文", attr: { id: `${Id}-heading` } });
		this.Close = Header.createEl("button", { text: "收起", attr: { type: "button" } });
		this.Body = this.Panel.createDiv({ cls: "codex-context-popover-body" });
		this.Trigger.addEventListener("click", EventValue =>
		{
			if(this.Events) { this.hide(); }
			else
			{
				this.show();
				if(EventValue.detail === 0) { this.Close.focus({ preventScroll: true }); }
			}
		});
		this.Close.addEventListener("click", () => this.hide(true));
	}

	describe(Text: string): void
	{
		if(this.Status.textContent !== Text) { this.Status.textContent = Text; }
	}

	show(AtStart = false): void
	{
		if(!this.Events)
		{
			const Events = new AbortController(), Doc = this.Panel.ownerDocument;
			this.Events = Events;
			this.Panel.hidden = false;
			this.Trigger.setAttribute("aria-expanded", "true");
			const Outside = (EventValue: Event) =>
			{
				const Path = EventValue.composedPath();
				if(!Path.includes(this.Panel) && !Path.includes(this.Trigger)) { this.hide(); }
			};
			const Options = { capture: true, signal: Events.signal };
			Doc.addEventListener("pointerdown", Outside, Options);
			Doc.addEventListener("focusin", Outside, Options);
			Doc.addEventListener("keydown", EventValue =>
			{
				if(EventValue.key !== "Escape" || EventValue.isComposing) { return; }
				const Path = EventValue.composedPath();
				this.hide(Path.includes(this.Panel) || Path.includes(this.Trigger));
				EventValue.preventDefault(); EventValue.stopPropagation();
			}, Options);
		}
		if(AtStart) { this.Body.scrollTop = 0; }
	}

	hide(RestoreFocus = false): void
	{
		if(!this.Events) { return; }
		this.Events.abort(); this.Events = null;
		this.Panel.hidden = true;
		this.Trigger.setAttribute("aria-expanded", "false");
		if(RestoreFocus) { this.Trigger.focus({ preventScroll: true }); }
	}
}
