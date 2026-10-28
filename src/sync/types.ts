export type OperationStatus = "local" | "received" | "submission-unknown" | "running" | "completed" | "cancelled" | "failed";
export interface DeletedMessage { SessionId: string; MessageId: string; }
export interface SendOperation
{
	Id: string;
	Scope: string;
	SessionId: string;
	MessageId: string;
	Digest: string;
	Input: unknown;
	Status: OperationStatus;
	TurnId?: string;
	ThreadId?: string;
	Result?: any;
	Error?: string;
	SessionDeleted?: boolean;
	MessageDeleted?: boolean;
	Request?: unknown;
	RequestDigest?: string;
	Attempted?: boolean;
	HostRequestDigest?: string;
	Conflicts?: SyncConflict[];
	Revision?: number;
	Origin?: string;
	Evidence?: { State: "metadata"; InputBlob: string; RequestBlob?: string; ResultBlob?: string; ConflictsBlob?: string };
}
export interface EntityVersion { Revision: number; Digest: string; Origin: string; }
export interface SyncConflict { Key: string; Reason: string; Local: unknown; Remote: unknown; }
export interface ConflictResolution
{
	SchemaVersion: 1;
	Id: string;
	Scope: string;
	ConflictId: string;
	Conflict: SyncConflict;
	Choice: "local" | "remote";
}
export interface HistoryLoadState { Status: "unloaded" | "loaded" | "deleted"; Revision: number; Digest?: string; }
export interface ClientSync
{
	SchemaVersion: 1;
	Scope: string;
	Revision: number;
	Versions: Record<string, EntityVersion>;
	Operations: SendOperation[];
	Conflicts: SyncConflict[];
	SettingsDigest?: string;
	SettingsRevision?: number;
	Resolutions?: ConflictResolution[];
	History?: Record<string, HistoryLoadState>;
}
export interface DeltaMutation
{
	Key: string;
	Kind: "root" | "settings" | "session" | "message" | "session-delete" | "message-delete";
	SessionId?: string;
	MessageId?: string;
	Expected: number;
	Blob?: string;
}
export const SyncProtocol = 2;
export const SyncBudgets = { requestBytes: 4 * 1024 * 1024, pageBytes: 128 * 1024, blobChunkBytes: 64 * 1024, maxBlobBytes: 64 * 1024 * 1024, deltaMutations: 64, historyPage: 64 };
export const SyncCapabilities = { incrementalSync: 1, operationStatus: 1, readPaging: 1, pdfImages: 1, pdfRegions: 1, snapshotPaging: 1, catalogInline: 1 };

export function canonical_json(Value: unknown): string
{
	return JSON.stringify(Value, (_K, V) => V && typeof V === "object" && !Array.isArray(V) ? Object.fromEntries(Object.entries(V).sort(([A], [B]) => A < B ? -1 : A > B ? 1 : 0)) : V);
}
export async function content_digest(Value: unknown): Promise<string>
{
	const Bytes = new TextEncoder().encode(canonical_json(Value));
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Bytes)), B => B.toString(16).padStart(2, "0")).join("");
}
export function entity_key(Kind: string, SessionId = "", MessageId = ""): string { return JSON.stringify([Kind, SessionId, MessageId]); }
export function client_sync(Scope: string): ClientSync { return { SchemaVersion: 1, Scope, Revision: 0, Versions: {}, Operations: [], Conflicts: [] }; }
