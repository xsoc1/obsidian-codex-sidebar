import { backend_identity, backend_name, backend_profile, select_api_model, type BackendProfile, type ApiCatalogModel } from "./backend-profile";

interface StorageLike { getItem(Key: string): string | null; setItem(Key: string, Text: string): void; }
export interface ConnectionProfile { Id: string; Name: string; Profile: BackendProfile; Catalog?: ApiCatalogModel[]; }
export class ConnectionProfiles
{
	readonly Key: string;
	private Data: ConnectionProfile[];
	constructor(private Storage: StorageLike, Vault: string)
	{
		this.Key = "codex-sidebar-connections:v1:" + Vault;
		const Raw = Storage.getItem(this.Key);
		const Saved = Raw ? JSON.parse(Raw) : { schemaVersion: 1, Profiles: [] };
		if(Saved.schemaVersion !== 1 || !Array.isArray(Saved.Profiles) || Saved.Profiles.length > 64) { throw new Error("连接配置版本未知或损坏，原配置保留"); }
		const Seen = new Set<string>();
		this.Data = Saved.Profiles.map((P: ConnectionProfile) =>
		{
			if(!P || Object.keys(P).some(K => !["Id","Name","Profile","Catalog"].includes(K)) || typeof P.Id !== "string" || !P.Id || Seen.has(P.Id) || typeof P.Name !== "string" || P.Name.length > 120) { throw new Error("连接配置身份无效"); }
			const Catalog = P.Catalog ? clean_catalog(P.Catalog) : undefined;
			const Profile = backend_profile(P.Profile);
			Seen.add(P.Id); return { Id: P.Id, Name: P.Name, Profile: Profile.Kind === "api" && (Profile.Selection || typeof Catalog?.find(M => M.Id === Profile.Model)?.Vision === "boolean") ? select_api_model(Profile, Profile.Model, Catalog).Profile : Profile, ...(Catalog ? { Catalog } : {}) };
		});
	}
	list(): ConnectionProfile[] { return structuredClone(this.Data); }
	save(Input: unknown, Name = "", Catalog?: ApiCatalogModel[]): ConnectionProfile
	{
		let Profile = backend_profile(Input);
		const CleanCatalog = Catalog ? clean_catalog(Catalog) : undefined;
		if(Profile.Kind === "api" && (Profile.Selection || typeof CleanCatalog?.find(M => M.Id === Profile.Model)?.Vision === "boolean")) { Profile = select_api_model(Profile, Profile.Model, CleanCatalog).Profile; }
		const Identity = backend_identity(Profile);
		const Existing = this.Data.find(P => backend_identity(P.Profile) === Identity && (Name.trim() ? P.Name===Name.trim() : JSON.stringify(P.Profile)===JSON.stringify(Profile)));
		const Next: ConnectionProfile = { Id: Existing?.Id ?? crypto.randomUUID(), Name: Name.trim().slice(0, 120) || Existing?.Name || backend_name(Profile) + " · " + (Profile.Model || "当前模型"), Profile, ...(CleanCatalog ? { Catalog: CleanCatalog } : Existing?.Catalog ? { Catalog: Existing.Catalog } : {}) };
		const Data = [...this.Data.filter(P => P.Id !== Next.Id), Next];
		if(Data.length > 64) { throw new Error("最多保存 64 份连接配置，请先移除不用的配置"); }
		this.write(Data); return structuredClone(Next);
	}
	remove(Id: string): void { this.write(this.Data.filter(P => P.Id !== Id)); }
	private write(Data: ConnectionProfile[]): void
	{
		const Text = JSON.stringify({ schemaVersion: 1, Profiles: Data });
		if(new TextEncoder().encode(Text).byteLength > 512000) { throw new Error("连接模型目录超过本机配置预算"); }
		this.Storage.setItem(this.Key, Text);
		if(this.Storage.getItem(this.Key) !== Text) { throw new Error("连接配置回读失败"); }
		this.Data = Data;
	}
}
function clean_catalog(Input: ApiCatalogModel[]): ApiCatalogModel[]
{
	if(!Array.isArray(Input) || Input.length > 500) { throw new Error("连接模型目录超过数量预算"); }
	return Input.map(M =>
	{
		if(typeof M.Id !== "string" || !/^[a-z0-9][a-z0-9._/:+@-]{0,159}$/i.test(M.Id)) { throw new Error("连接模型标识无效"); }
		return { Id: M.Id, ...(M.Protocol && ["chat","responses"].includes(M.Protocol) ? { Protocol: M.Protocol } : {}), ...(M.Reasoning && ["chat","responses","gemini-level"].includes(M.Reasoning.Format) && Array.isArray(M.Reasoning.Efforts) && M.Reasoning.Efforts.every(E=>typeof E==="string" && /^[a-z]{1,20}$/.test(E)) ? { Reasoning: { Format:M.Reasoning.Format, Efforts:[...M.Reasoning.Efforts] } } : {}), ...(typeof M.Vision==="boolean" ? {Vision:M.Vision}:{}), ...(Number.isFinite(M.ContextWindow) && M.ContextWindow! > 0 ? {ContextWindow:M.ContextWindow}: {}) };
	});
}

// Keys are indexed by endpoint and an explicit identity label, never persisted or hashed.
export class ConnectionCredentials
{
	private Keys = new Map<string, string>();
	get(Profile: BackendProfile): string { return this.Keys.get(backend_identity(Profile)) ?? ""; }
	set(Profile: BackendProfile, Key: string): void { if(Key) { this.Keys.set(backend_identity(Profile), Key); } }
	clear(): void { this.Keys.clear(); }
}
