import { backend_identity, type ApiCredentialScope } from "./backend-profile";

type LocalReferences = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Secrets = { getSecret(Id: string): string | null };

// Store only the chosen Obsidian secret name, outside profiles, history and exports.
export class ApiSecretBindings
{
	constructor(private Local: LocalReferences, private Prefix: string, private Secrets: Secrets) {}
	private key(Scope: ApiCredentialScope): string { return this.Prefix + backend_identity(Scope); }
	alias(Scope: ApiCredentialScope): string { return this.Local.getItem(this.key(Scope)) ?? ""; }
	read(Alias: string): string
	{
		if(!/^[a-z0-9-]+$/.test(Alias)) { throw new Error("请选择有效的 Obsidian 密钥"); }
		let Key: string | null;
		try { Key = this.Secrets.getSecret(Alias); }
		catch { throw new Error("无法读取 Obsidian 密钥，请在设置中重新选择"); }
		if(!Key?.trim()) { throw new Error("已关联的 Obsidian 密钥不可用，请重新选择或填写临时 API Key"); }
		return Key;
	}
	set(Scope: ApiCredentialScope, Alias: string | null): void
	{
		if(Alias !== null && !/^[a-z0-9-]+$/.test(Alias)) { throw new Error("请选择有效的 Obsidian 密钥"); }
		if(Alias === null) { this.Local.removeItem(this.key(Scope)); }
		else { this.Local.setItem(this.key(Scope), Alias); }
	}
}
