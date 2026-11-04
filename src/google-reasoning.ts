import type { ApiReasoning } from "./backend-profile";

// The Google model catalog does not enumerate levels. Match documented chat IDs exactly.
const Levels = ["low", "medium", "high"];
const WithMinimal = ["minimal", ...Levels];
const GoogleLevels = new Map<string, string[]>([
	["gemini-4-argon", Levels],
	["gemini-3.8-flash", Levels],
	["gemini-3.6-flash", WithMinimal],
	["gemini-3.5-flash-lite", WithMinimal],
	["gemini-3.1-flash-lite", WithMinimal],
	["gemini-3.1-pro-preview", Levels],
	["gemini-3-flash-preview", WithMinimal],
	["gemini-3-pro-preview", ["low", "high"]]
]);

export function google_reasoning(Model: string): ApiReasoning | undefined
{
	const Id = Model.replace(/^models\//, "");
	const Efforts = GoogleLevels.get(Id);
	if(Efforts) { return { Format: "gemini-level", Efforts: [...Efforts] }; }
	if(Id === "gemini-2.5-pro") { return { Format: "chat", Efforts: [...Levels] }; }
	if(Id === "gemini-2.5-flash" || Id === "gemini-2.5-flash-lite") { return { Format: "chat", Efforts: ["none", ...Levels] }; }
}
