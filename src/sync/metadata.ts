import { canonical_json, type ClientSync, type HistoryLoadState } from "./types";
import { merge_operations } from "./operations";
import { merge_conflict_resolutions, pending_conflicts } from "./conflicts";

export function merge_history_loads(Current: Record<string, HistoryLoadState> = {}, Incoming: Record<string, HistoryLoadState> = {}): Record<string, HistoryLoadState>
{
	const Result = structuredClone(Current);
	for(const [Id, Value] of Object.entries(Incoming))
	{
		const Previous = Result[Id];
		if(!Previous || Value.Status === "deleted" || Previous.Status !== "deleted" && (Value.Revision > Previous.Revision || Value.Revision === Previous.Revision && Value.Status === "loaded")) { Result[Id] = structuredClone(Value); }
	}
	return Result;
}

export function merge_sync_metadata(Current: ClientSync | undefined, Incoming: ClientSync): ClientSync
{
	if(Current && Current.Scope !== Incoming.Scope) { throw new Error("同步元数据来自其他作用域, 未覆盖当前状态"); }
	if(!Current) { const Result = structuredClone(Incoming); Result.Conflicts = pending_conflicts(Result.Conflicts, Result.Resolutions); return Result; }
	const Result = structuredClone(Current), Seen = new Set(Result.Conflicts.map(C => canonical_json(C)));
	for(const C of Incoming.Conflicts) { const Key = canonical_json(C); if(!Seen.has(Key)) { Result.Conflicts.push(structuredClone(C)); Seen.add(Key); } }
	for(const [Key, Version] of Object.entries(Incoming.Versions))
	{
		const Previous = Result.Versions[Key];
		if(!Previous || Previous.Origin === Version.Origin && Version.Revision > Previous.Revision) { Result.Versions[Key] = structuredClone(Version); }
		else if(Previous.Origin !== Version.Origin || Previous.Revision === Version.Revision && Previous.Digest !== Version.Digest)
		{
			const C = { Key, Reason: "同一同步对象的版本证据不一致, 保留双方元数据供核对", Local: Previous, Remote: Version };
			if(!Result.Conflicts.some(V => canonical_json(V) === canonical_json(C))) { Result.Conflicts.push(C); }
		}
	}
	Result.Revision = Math.max(Current.Revision, Incoming.Revision);
	Result.Operations = merge_operations(Current.Operations, Incoming.Operations, Result.Conflicts);
	Result.Resolutions = merge_conflict_resolutions(Current.Scope, Current.Resolutions, Incoming.Resolutions);
	Result.Conflicts = pending_conflicts(Result.Conflicts, Result.Resolutions);
	if(Current.History || Incoming.History) { Result.History = merge_history_loads(Current.History, Incoming.History); }
	if(Incoming.SettingsDigest !== undefined && (Current.SettingsDigest === undefined || (Incoming.SettingsRevision ?? -1) > (Current.SettingsRevision ?? -1)))
	{
		Result.SettingsDigest = Incoming.SettingsDigest; Result.SettingsRevision = Incoming.SettingsRevision;
	}
	return Result;
}
