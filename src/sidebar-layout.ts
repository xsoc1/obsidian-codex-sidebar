export interface SidebarPanel
{
	Body: HTMLElement;
	Summary: HTMLElement | null;
	Details: HTMLDetailsElement | null;
}

export function sidebar_panel(Parent: HTMLElement, ClassName: string, Label: string, Mobile: boolean, Saved?: { Storage: Pick<Storage, "getItem" | "setItem">; Key: string }): SidebarPanel
{
	const Details = Parent.ownerDocument.createElement("details");
	Details.className = ClassName;
	let Open = !Mobile && ClassName === "codex-send-tools";
	try { const Value = Saved?.Storage.getItem(Saved.Key); if(Value === "open" || Value === "closed") { Open = Value === "open"; } } catch { }
	Details.open = Open;
	if(Saved) { Details.addEventListener("toggle", () => { try { Saved.Storage.setItem(Saved.Key, Details.open ? "open" : "closed"); } catch { } }); }
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
