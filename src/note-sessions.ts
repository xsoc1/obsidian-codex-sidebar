export interface NoteSessionData
{
	schemaVersion: 1;
	Enabled: boolean;
	Links: { Path: string; SessionId: string }[];
}
interface StorageLike { getItem(Key: string): string | null; setItem(Key: string, Value: string): void; }
interface NoteSessionHost
{
	active(): string;
	exists(Id: string): boolean;
	blocked(): string;
	activate(Id: string, Path: string): Promise<void>;
	changed(): void;
}

export function note_file_path(View: { getViewType?(): string; file?: { path: string } | null } | null | undefined): string | null
{
	return View && ["markdown", "pdf"].includes(View.getViewType?.() ?? "") && valid_path(View.file?.path) ? View.file!.path : null;
}
function valid_path(Path: unknown): Path is string
{
	return typeof Path === "string" && Path.length <= 1024 && !/^[\\/]|[\\:\u0000-\u001f]/.test(Path) && /\.(md|pdf)$/i.test(Path) && Path.split("/").every(Part => Part && ![".", "..", ".obsidian", ".trash"].includes(Part));
}
function validate(Data: NoteSessionData): void
{
	if(!Data || Object.keys(Data).some(Key => !["schemaVersion", "Enabled", "Links"].includes(Key)) || Data.schemaVersion !== 1 || typeof Data.Enabled !== "boolean" || !Array.isArray(Data.Links) || Data.Links.length > 2000) { throw new Error("笔记会话关联版本不支持或损坏, 原数据保留"); }
	const Paths = new Set<string>(), Ids = new Set<string>();
	for(const Link of Data.Links)
	{
		if(!Link || Object.keys(Link).some(Key => !["Path", "SessionId"].includes(Key)) || !valid_path(Link.Path) || typeof Link.SessionId !== "string" || !Link.SessionId || Link.SessionId.length > 128 || Paths.has(Link.Path) || Ids.has(Link.SessionId)) { throw new Error("笔记会话关联无效或重复, 原数据保留"); }
		Paths.add(Link.Path); Ids.add(Link.SessionId);
	}
}

export class NoteSessions
{
	readonly Key: string;
	Data: NoteSessionData;
	Path: string | null = null;
	Pending: string | null = null;
	Reason = "";
	Error = "";
	Switching = false;
	Manual = false;
	private Closed = false;
	private Work: Promise<void> | null = null;
	constructor(private Storage: StorageLike, Vault: string, Scope: string, private Host: NoteSessionHost)
	{
		this.Key = `codex-sidebar-note-sessions:v1:${Vault}:${Scope}`;
		const Raw = Storage.getItem(this.Key);
		this.Data = Raw ? JSON.parse(Raw) : { schemaVersion: 1, Enabled: true, Links: [] }; validate(this.Data);
	}
	private save(Data: NoteSessionData): void
	{
		validate(Data); const Raw = JSON.stringify(Data);
		if(Raw.length > 1000000) { throw new Error("本设备笔记会话关联已满, 不覆盖旧关联"); }
		this.Storage.setItem(this.Key, Raw); this.Data = Data;
	}
	set_enabled(Enabled: boolean): void
	{
		this.save({ ...structuredClone(this.Data), Enabled }); this.Manual = false;
		this.Pending = Enabled ? this.Path : null; this.Reason = ""; this.Error = ""; this.Host.changed();
	}
	observe(Path: string | null): void
	{
		if(this.Closed || !valid_path(Path) || this.Path === Path) { return; }
		this.Path = Path; this.Manual = false; this.Error = ""; this.Reason = "";
		this.Pending = this.Data.Enabled ? Path : null; this.Host.changed();
	}
	manual(): void { this.Manual = true; this.Pending = null; this.Reason = ""; this.Host.changed(); }
	bind_current(): void
	{
		if(!this.Path || !this.Host.exists(this.Host.active())) { throw new Error("请先打开笔记并选择有效会话"); }
		const Id = this.Host.active();
		this.save({ ...this.Data, Links: [...this.Data.Links.filter(Link => Link.Path !== this.Path && Link.SessionId !== Id), { Path: this.Path, SessionId: Id }] });
		this.Manual = false; this.Pending = null; this.Error = ""; this.Host.changed();
	}
	flush(): Promise<void>
	{
		if(this.Switching) { return this.Work ?? Promise.resolve(); }
		if(this.Closed || !this.Data.Enabled || this.Manual || this.Error) { return Promise.resolve(); }
		if(!this.Pending && this.Path && this.Data.Links.some(Link => Link.Path === this.Path && !this.Host.exists(Link.SessionId))) { this.Pending = this.Path; }
		if(!this.Pending) { return Promise.resolve(); }
		const Blocked = this.Host.blocked();
		if(Blocked) { if(this.Reason !== Blocked) { this.Reason = Blocked; this.Host.changed(); } return Promise.resolve(); }
		const Path = this.Pending; this.Pending = null; this.Reason = ""; this.Switching = true;
		this.Work = Promise.resolve().then(() => this.activate(Path)); return this.Work;
	}
	private async activate(Path: string): Promise<void>
	{
		try
		{
			if(this.Closed || !this.Data.Enabled || this.Manual || this.Path !== Path) { return; }
			const Old = this.Data.Links.find(Link => Link.Path === Path), Id = Old && this.Host.exists(Old.SessionId) ? Old.SessionId : crypto.randomUUID();
			if(Id !== Old?.SessionId) { this.save({ ...this.Data, Links: [...this.Data.Links.filter(Link => Link.Path !== Path), { Path, SessionId: Id }] }); }
			if(!this.Closed) { await this.Host.activate(Id, Path); }
		}
		catch(ErrorValue) { this.Error = String(ErrorValue); }
		finally { this.Switching = false; this.Work = null; if(!this.Closed) { this.Host.changed(); } }
	}
	rename(Old: string, Next: string): void
	{
		if(!valid_path(Old) || !valid_path(Next) || Old === Next) { return; }
		if(this.Data.Links.some(Link => Link.Path === Old))
		{
			if(this.Data.Links.some(Link => Link.Path === Next))
			{
				if(this.Path === Old) { this.Path = Next; }
				this.Pending = null; this.Manual = true; this.Error = "新路径已有会话关联, 未合并; 请手动选择并重新绑定"; this.Host.changed(); return;
			}
			this.save({ ...this.Data, Links: this.Data.Links.map(Link => Link.Path === Old ? { ...Link, Path: Next } : Link) });
		}
		if(this.Path === Old) { this.Path = Next; if(this.Data.Enabled && !this.Manual) { this.Pending = Next; } }
		if(this.Pending === Old) { this.Pending = Next; }
		this.Host.changed();
	}
	forget(Path: string): void
	{
		if(this.Data.Links.some(Link => Link.Path === Path)) { this.save({ ...this.Data, Links: this.Data.Links.filter(Link => Link.Path !== Path) }); }
		if(this.Path === Path) { this.Path = null; this.Pending = null; }
		this.Host.changed();
	}
	forget_session(Id: string, ReplacementId?: string, Path = this.Path): void
	{
		if(this.Closed) { throw new Error("笔记关联已关闭"); }
		const Current = this.Data.Links.find(Link => Link.Path === Path && Link.SessionId === Id);
		const Links = this.Data.Links.filter(Link => Link.SessionId !== Id);
		if(Current && ReplacementId && this.Data.Enabled)
		{
			if(!this.Host.exists(ReplacementId)) { throw new Error("替代会话不存在"); }
			Links.push({ Path: Current.Path, SessionId: ReplacementId });
		}
		if(Links.length !== this.Data.Links.length || Current && ReplacementId) { this.save({ ...this.Data, Links }); }
		if(Current && ReplacementId && this.Data.Enabled && Current.Path === this.Path) { this.Pending = null; this.Manual = false; }
		this.Reason = ""; this.Error = ""; this.Host.changed();
	}
	dispose(): void { this.Closed = true; this.Pending = null; }
}
