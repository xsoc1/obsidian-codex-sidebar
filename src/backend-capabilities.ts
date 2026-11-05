import { ApiProviders, type BackendProfile, type ApiReasoning } from "./backend-profile";

export type Capability = true | false | "unknown";
export interface BackendCapabilities
{
	Images: Capability;
	Streaming: Capability;
	HistoryRead: Capability;
	SourceRead: Capability;
	Usage: Capability;
	ServerCancel: Capability;
	ResultQuery: Capability;
	Transport?: "fetch-sse-attempt" | "native-buffered" | "agent-buffered";
}
export function api_protocol(Profile: Extract<BackendProfile, { Kind: "api" }>, Reasoning?: ApiReasoning): "chat" | "responses"
{
	const Protocol = Profile.Protocol;
	return Protocol ?? (Reasoning?.Format === "responses" ? "responses" : ApiProviders[Profile.Provider].Format);
}
export function backend_capabilities(Profile: BackendProfile, Options: { Streaming?: boolean; HistoryRead?: boolean } = {}): BackendCapabilities
{
	const Api = Profile.Kind === "api";
	return {
		Images: Api ? Profile.Vision ? true : "unknown" : false,
		Streaming: Api ? Profile.Stream === "buffered" ? false : Options.Streaming ?? "unknown" : false,
		HistoryRead: Api ? !Options.HistoryRead || Profile.HistoryTools === false ? false : Profile.Provider === "compatible" && Profile.HistoryTools !== true ? "unknown" : true : false,
		SourceRead: false,
		Usage: Api && Profile.Provider !== "compatible" ? true : "unknown",
		ServerCancel: false,
		ResultQuery: false,
		Transport: Api ? Profile.Stream === "buffered" ? "native-buffered" : "fetch-sse-attempt" : "agent-buffered"
	};
}
