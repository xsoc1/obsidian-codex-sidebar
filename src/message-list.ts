export interface MessageNode
{
	Element: HTMLElement;
	Dispose: () => void;
}
export interface MessageRender
{
	Id: string;
	Key: string;
	Render: () => Promise<MessageNode>;
}
interface Entry extends MessageNode { Id: string; Key: string; }

export class MessageList
{
	private Entries = new Map<string, Entry>();
	private Context = "";
	private Generation = 0;
	private Closed = false;
	private Follow = true;
	private LastWritten: number | null = null;
	private Anchor: { Element: HTMLElement; Offset: number } | null = null;
	private Observer: ResizeObserver | null = null;
	private Frame: number | null = null;
	private Window: (Window & typeof globalThis) | null;
	constructor(private Root: HTMLElement)
	{
		this.Window = Root.ownerDocument.defaultView;
		Root.addEventListener("scroll", this.on_scroll, { passive: true });
		const Resize = this.Window?.ResizeObserver;
		if(Resize) { this.Observer = new Resize(() => this.schedule_scroll()); this.Observer.observe(Root); }
	}
	private on_scroll = (): void =>
	{
		if(this.LastWritten !== null && Math.abs(this.Root.scrollTop - this.LastWritten) < 1) { return; }
		this.LastWritten = null;
		this.Follow = this.Root.scrollHeight - this.Root.scrollTop - this.Root.clientHeight < 2;
		this.remember_anchor();
	};
	private remember_anchor(): void
	{
		const Top = this.Root.getBoundingClientRect().top;
		const Element = [...this.Root.children].find(Child => Child.getBoundingClientRect().bottom > Top) as HTMLElement | undefined;
		this.Anchor = Element ? { Element, Offset: Element.getBoundingClientRect().top - Top } : null;
	}
	private apply_scroll(): void
	{
		if(this.Closed) { return; }
		if(this.Follow) { this.Root.scrollTop = this.Root.scrollHeight; this.LastWritten = this.Root.scrollTop; }
		else if(this.Anchor?.Element.parentElement === this.Root)
		{
			const Delta = this.Anchor.Element.getBoundingClientRect().top - this.Root.getBoundingClientRect().top - this.Anchor.Offset;
			if(Math.abs(Delta) > 0.5) { this.Root.scrollTop += Delta; this.LastWritten = this.Root.scrollTop; }
		}
		this.remember_anchor();
	}
	private schedule_scroll(): void
	{
		if(this.Closed || this.Frame !== null) { return; }
		if(!this.Window?.requestAnimationFrame) { this.apply_scroll(); return; }
		this.Frame = this.Window.requestAnimationFrame(() => { this.Frame = null; this.apply_scroll(); });
	}
	async update(Context: string, Items: readonly MessageRender[], Current: () => boolean): Promise<boolean>
	{
		if(this.Closed) { return false; }
		if(new Set(Items.map(Item => Item.Id)).size !== Items.length) { throw new Error("重复的消息标识"); }
		const Generation = ++this.Generation, Built: Entry[] = [], Next = new Map<string, Entry>();
		let Committed = false;
		try
		{
			for(const Item of Items)
			{
				const Old = this.Context === Context ? this.Entries.get(Item.Id) : undefined;
				const Entry = Old?.Key === Item.Key ? Old : { Id: Item.Id, Key: Item.Key, ...await Item.Render() };
				if(Entry !== Old) { Built.push(Entry); }
				Next.set(Item.Id, Entry);
				if(this.Closed || Generation !== this.Generation || !Current()) { return false; }
			}
			if(this.Closed || Generation !== this.Generation || !Current()) { return false; }
			if(this.Context !== Context) { this.Follow = true; this.Anchor = null; }
			else { this.remember_anchor(); }
			let Index = 0;
			for(const Entry of Next.values())
			{
				const At = this.Root.children[Index++] ?? null;
				if(At !== Entry.Element) { this.Root.insertBefore(Entry.Element, At); }
			}
			const Keep = new Set([...Next.values()].map(Entry => Entry.Element));
			for(const Child of [...this.Root.children]) { if(!Keep.has(Child as HTMLElement)) { Child.remove(); } }
			for(const Old of this.Entries.values())
			{
				if(Next.get(Old.Id) !== Old) { this.Observer?.unobserve(Old.Element); Old.Dispose(); }
			}
			for(const Entry of Built) { this.Observer?.observe(Entry.Element); }
			this.Entries = Next; this.Context = Context; Committed = true;
			this.apply_scroll(); return true;
		}
		finally { if(!Committed) { for(const Entry of Built) { Entry.Dispose(); } } }
	}
	dispose(): void
	{
		this.Closed = true; this.Generation++;
		this.Root.removeEventListener("scroll", this.on_scroll); this.Observer?.disconnect();
		if(this.Frame !== null) { this.Window?.cancelAnimationFrame(this.Frame); this.Frame = null; }
		for(const Entry of this.Entries.values()) { Entry.Dispose(); }
		this.Entries.clear();
	}
}
