import type { FileView } from "obsidian";

interface Entry { Button: HTMLButtonElement; Observer: MutationObserver; }

export class PdfBoxToolbar
{
	private Entries = new Map<FileView, Entry>();
	private Active: FileView | null = null;

	constructor(private Toggle: (View: FileView) => void) {}

	sync(Views: readonly FileView[]): void
	{
		const Current = new Set(Views.filter(View => View.containerEl.isConnected));
		for(const View of this.Entries.keys())
		{
			if(!Current.has(View)) { this.remove(View); }
		}
		for(const View of Current)
		{
			if(this.Entries.has(View)) { continue; }
			const Root = View.containerEl;
			const WindowValue = Root.ownerDocument.defaultView;
			if(!WindowValue) { continue; }
			const Button = Root.ownerDocument.createElement("button");
			Button.type = "button"; Button.className = "codex-pdf-toolbar-action"; Button.textContent = "Codex 框选";
			Button.setAttribute("aria-pressed", String(View === this.Active));
			Button.addEventListener("click", () => this.Toggle(View));
			const Mount = () =>
			{
				if(Root.contains(Button)) { return; }
				Root.querySelector(".pdf-toolbar:not(.pdf-findbar) > .pdf-toolbar-right")?.appendChild(Button);
			};
			const Observer = new WindowValue.MutationObserver(Mount);
			Observer.observe(Root, { childList: true, subtree: true });
			this.Entries.set(View, { Button, Observer }); Mount();
		}
	}

	set_active(View: FileView | null): void
	{
		if(this.Active === View) { return; }
		if(this.Active) { this.Entries.get(this.Active)?.Button.setAttribute("aria-pressed", "false"); }
		this.Active = View;
		if(View) { this.Entries.get(View)?.Button.setAttribute("aria-pressed", "true"); }
	}

	private remove(View: FileView): void
	{
		const EntryValue = this.Entries.get(View);
		EntryValue?.Observer.disconnect(); EntryValue?.Button.remove(); this.Entries.delete(View);
	}

	dispose(): void
	{
		for(const View of this.Entries.keys()) { this.remove(View); }
		this.Active = null;
	}
}
