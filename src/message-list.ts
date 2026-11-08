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
interface CachedContext
{
	Entries: Map<string, Entry>;
	Follow: boolean;
	Anchor: { Element: HTMLElement; Offset: number } | null;
	ScrollTop: number;
}

export class MessageList
{
	private Entries = new Map<string, Entry>();
	private Cache = new Map<string, CachedContext>();
	private Context = "";
	private Generation = 0;
	private Closed = false;
	private Follow = true;
	private LastWritten: number | null = null;
	private Anchor: { Element: HTMLElement; Offset: number } | null = null;
	private Observer: ResizeObserver | null = null;
	private Frame: number | null = null;
	private Window: (Window & typeof globalThis) | null;
	private Pinned: { Context: string; MessageId: string; Resolve: (Card: HTMLElement) => HTMLElement | null; Offset: number } | null = null;
	constructor(private Root: HTMLElement, private UserInteraction?: () => void)
	{
		this.Window = Root.ownerDocument.defaultView;
		Root.addEventListener("scroll", this.on_scroll, { passive: true });
		for(const Name of ["wheel", "touchstart", "pointerdown"]) { Root.addEventListener(Name, this.on_user_input, { passive: true }); }
		Root.addEventListener("keydown", this.on_key);
		const Resize = this.Window?.ResizeObserver;
		if(Resize) { this.Observer = new Resize(() => this.schedule_scroll()); this.Observer.observe(Root); }
	}
	private on_user_input = (): void => { this.Pinned = null; this.UserInteraction?.(); };
	private on_key = (Event: KeyboardEvent): void =>
	{
		if(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(Event.key)) { this.on_user_input(); }
	};
	private on_scroll = (): void =>
	{
		if(this.LastWritten !== null && Math.abs(this.Root.scrollTop - this.LastWritten) < 1) { return; }
		this.LastWritten = null;
		this.on_user_input();
		this.Follow = this.Root.scrollHeight - this.Root.scrollTop - this.Root.clientHeight < 2;
		this.remember_anchor();
	};
	private remember_anchor(): void
	{
		const Top = this.Root.getBoundingClientRect().top;
		const Element = [...this.Root.children].find(Child => (Child as HTMLElement).dataset?.historyControls !== "true" && Child.getBoundingClientRect().bottom > Top) as HTMLElement | undefined;
		this.Anchor = Element ? { Element, Offset: Element.getBoundingClientRect().top - Top } : null;
	}
	private apply_scroll(): void
	{
		if(this.Closed) { return; }
		if(this.Pinned?.Context === this.Context)
		{
			const Card = this.Entries.get(this.Pinned.MessageId)?.Element, Node = Card && this.Pinned.Resolve(Card);
			if(Node) { this.Anchor = { Element: Node, Offset: this.Pinned.Offset }; }
			else { this.Pinned = null; }
		}
		if(this.Follow) { this.Root.scrollTop = this.Root.scrollHeight; this.LastWritten = this.Root.scrollTop; }
		else if(this.Anchor && (this.Anchor.Element.parentElement === this.Root || this.Root.contains?.(this.Anchor.Element)))
		{
			const Delta = this.Anchor.Element.getBoundingClientRect().top - this.Root.getBoundingClientRect().top - this.Anchor.Offset;
			if(Math.abs(Delta) > 0.5) { this.Root.scrollTop += Delta; this.LastWritten = this.Root.scrollTop; }
		}
		if(!this.Pinned) { this.remember_anchor(); }
	}
	/** Offset is local viewport geometry, never a Markdown character offset. */
	reveal(MessageId: string, Resolve: (Card: HTMLElement) => HTMLElement | null, Offset: number): boolean
	{
		const Card = this.Entries.get(MessageId)?.Element, Element = Card && Resolve(Card);
		if(!Element || !Number.isFinite(Offset)) { return false; }
		this.Follow = false; this.Pinned = { Context: this.Context, MessageId, Resolve, Offset };
		this.Anchor = { Element, Offset }; this.apply_scroll(); return true;
	}
	reanchor(): void { if(this.Pinned) { this.apply_scroll(); this.schedule_scroll(); } }
	private schedule_scroll(): void
	{
		if(this.Closed || this.Frame !== null) { return; }
		if(!this.Window?.requestAnimationFrame) { this.apply_scroll(); return; }
		this.Frame = this.Window.requestAnimationFrame(() => { this.Frame = null; this.apply_scroll(); });
	}
	private trim_cache(): void
	{
		let Count = [...this.Cache.values()].reduce((Sum, Value) => Sum + Value.Entries.size, 0);
		for(const [Key, Value] of this.Cache)
		{
			if(this.Cache.size <= 2 && Count <= 300) { break; }
			this.Cache.delete(Key); Count -= Value.Entries.size;
			for(const Entry of Value.Entries.values()) { Entry.Dispose(); }
		}
	}
	has_context(Context: string): boolean { return this.Context === Context || this.Cache.has(Context); }
	async update(Context: string, Items: readonly MessageRender[], Current: () => boolean): Promise<boolean>
	{
		if(this.Closed) { return false; }
		if(new Set(Items.map(Item => Item.Id)).size !== Items.length) { throw new Error("重复的消息标识"); }
		const Generation = ++this.Generation, Built: Entry[] = [], Next = new Map<string, Entry>();
		const Cached = this.Context === Context ? null : this.Cache.get(Context);
		const Previous = this.Context === Context ? this.Entries : Cached?.Entries;
		let Committed = false;
		try
		{
			for(const Item of Items)
			{
				const Old = Previous?.get(Item.Id);
				const Entry = Old?.Key === Item.Key ? Old : { Id: Item.Id, Key: Item.Key, ...await Item.Render() };
				if(Entry !== Old) { Built.push(Entry); }
				Next.set(Item.Id, Entry);
				if(this.Closed || Generation !== this.Generation || !Current()) { return false; }
			}
			if(this.Closed || Generation !== this.Generation || !Current()) { return false; }
			this.remember_anchor();
			if(this.Context !== Context)
			{
				if(this.Context)
				{
					this.Cache.delete(this.Context);
					this.Cache.set(this.Context, { Entries: this.Entries, Follow: this.Follow, Anchor: this.Anchor, ScrollTop: this.Root.scrollTop });
					for(const Entry of this.Entries.values()) { this.Observer?.unobserve(Entry.Element); }
				}
				this.Cache.delete(Context);
				this.Pinned = null;
				this.Follow = Cached?.Follow ?? true; this.Anchor = Cached?.Anchor ?? null;
			}
			let Index = 0;
			for(const Entry of Next.values())
			{
				const At = this.Root.children[Index++] ?? null;
				if(At !== Entry.Element) { this.Root.insertBefore(Entry.Element, At); }
			}
			const Keep = new Set([...Next.values()].map(Entry => Entry.Element));
			for(const Child of [...this.Root.children]) { if(!Keep.has(Child as HTMLElement)) { Child.remove(); } }
			for(const Old of Previous?.values() ?? [])
			{
				if(Next.get(Old.Id) !== Old) { this.Observer?.unobserve(Old.Element); Old.Dispose(); }
			}
			for(const Entry of Next.values()) { this.Observer?.observe(Entry.Element); }
			this.Entries = Next; this.Context = Context; Committed = true;
			if(Cached && !this.Follow) { this.Root.scrollTop = Cached.ScrollTop; this.LastWritten = this.Root.scrollTop; }
			this.trim_cache();
			this.apply_scroll(); return true;
		}
		finally { if(!Committed) { for(const Entry of Built) { Entry.Dispose(); } } }
	}
	forget(Context: string): void
	{
		this.Generation++;
		if(this.Pinned?.Context === Context) { this.Pinned = null; }
		if(this.Context === Context)
		{
			for(const Entry of this.Entries.values()) { this.Observer?.unobserve(Entry.Element); Entry.Element.remove(); Entry.Dispose(); }
			this.Entries.clear(); this.Context = ""; this.Follow = true; this.Anchor = null; this.LastWritten = null;
		}
		const Cached = this.Cache.get(Context);
		if(Cached) { this.Cache.delete(Context); for(const Entry of Cached.Entries.values()) { Entry.Dispose(); } }
	}
	dispose(): void
	{
		this.Closed = true; this.Generation++;
		this.Root.removeEventListener("scroll", this.on_scroll); this.Observer?.disconnect();
		for(const Name of ["wheel", "touchstart", "pointerdown"]) { this.Root.removeEventListener(Name, this.on_user_input); }
		this.Root.removeEventListener("keydown", this.on_key); this.Pinned = null;
		if(this.Frame !== null) { this.Window?.cancelAnimationFrame(this.Frame); this.Frame = null; }
		for(const Entry of this.Entries.values()) { Entry.Dispose(); }
		for(const Value of this.Cache.values()) { for(const Entry of Value.Entries.values()) { Entry.Dispose(); } }
		this.Entries.clear();
		this.Cache.clear();
	}
}
