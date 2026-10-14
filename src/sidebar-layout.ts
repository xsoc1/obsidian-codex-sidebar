export interface SidebarPanel
{
	Body: HTMLElement;
	Summary: HTMLElement | null;
	Details: HTMLDetailsElement | null;
}

export function sidebar_panel(Parent: HTMLElement, ClassName: string, Label: string, Mobile: boolean): SidebarPanel
{
	if(!Mobile) { return { Body: Parent, Summary: null, Details: null }; }
	const Details = Parent.ownerDocument.createElement("details");
	Details.className = ClassName;
	const Summary = Parent.ownerDocument.createElement("summary");
	Summary.textContent = Label;
	Details.appendChild(Summary);
	const Body = Parent.ownerDocument.createElement("div");
	Body.className = "codex-panel-body";
	Details.appendChild(Body);
	Parent.appendChild(Details);
	return { Body, Summary, Details };
}

export function reveal_sidebar_panel(Panel: SidebarPanel | null): void
{
	if(Panel?.Details) { Panel.Details.open = true; }
}
