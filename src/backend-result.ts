export type BackendStatus = "completed" | "partial" | "refused" | "unknown" | "failed" | "cancelled";
export interface BackendReceipt
{
	RequestId?: string;
	ResponseId?: string;
}
export interface BackendUsage
{
	// Each entry replaces the cumulative usage of one request, never an increment.
	Kind: "cumulative";
	Receipt?: BackendReceipt;
	InputTokens?: number;
	OutputTokens?: number;
	TotalTokens?: number;
	CachedInputTokens?: number;
	ReasoningOutputTokens?: number;
	Raw: Record<string, unknown>;
}
export interface BackendMetadata
{
	Reason?: string;
	Model?: string;
	Receipts?: BackendReceipt[];
	Usage?: BackendUsage[];
	Submission?: "not-submitted" | "submitted" | "unknown" | "rejected" | "cancelled";
	Wait?: "finished" | "stopped";
	Transport?: "streaming" | "buffered";
	FirstEventMs?: number;
	FirstTextMs?: number;
	ElapsedMs?: number;
}
export interface BackendResult
{
	Text: string;
	Status: BackendStatus;
	Metadata: BackendMetadata;
}
export interface BackendHistoryResult
{
	success: boolean;
	contentItems: { type: string; text: string }[];
}
export type BackendHistoryRead = (Args: unknown, SessionId: string) => Promise<BackendHistoryResult>;

export function normalize_backend_result(Value: BackendResult | string): BackendResult
{
	if(typeof Value === "string")
	{
		if(!Value.trim() || Value.length > 2_000_000) { throw new Error("后端返回的正文为空或超过长度限制"); }
		return { Text: Value, Status: "completed", Metadata: {} };
	}
	if(!Value || typeof Value.Text !== "string" || Value.Text.length > 2_000_000 || !["completed", "partial", "refused", "unknown", "failed", "cancelled"].includes(Value.Status) || !Value.Metadata)
	{
		throw new Error("后端结果格式无效");
	}
	if(Value.Status === "completed" && !Value.Text.trim()) { return { ...Value, Status: "failed", Metadata: { ...Value.Metadata, Reason: "empty-body" } }; }
	return Value;
}
