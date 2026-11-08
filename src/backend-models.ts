import { backend_model, select_api_model, type BackendProfile, type ApiCatalogModel } from "./backend-profile";
import type { ModelInfo } from "./controls";

// The picker, active connection and frozen request consume the same per-model selection.
export function backend_model_choices(Profile: BackendProfile, Catalog: readonly ApiCatalogModel[] = []): ModelInfo[]
{
	if(Profile.Kind === "agent")
	{
		return [{ model: backend_model(Profile), displayName: Profile.Model || "Agent 当前模型", supportedReasoningEfforts: [], defaultReasoningEffort: "", isDefault: true, inputModalities: ["text"] }];
	}
	const Entries = Catalog.some(M => M.Id === Profile.Model) ? Catalog : [{ Id: Profile.Model }, ...Catalog];
	return Entries.map(Entry =>
	{
		const Selected = select_api_model(Profile, Entry.Id, Catalog.length ? Catalog : undefined);
		const Images = Entry.Id === Profile.Model && !Profile.Selection && typeof Entry.Vision !== "boolean" ? Profile.Vision : Selected.Images === true;
		return { model: Entry.Id, displayName: Entry.Id, isDefault: Entry.Id === Profile.Model, defaultReasoningEffort: "",
			supportedReasoningEfforts: (Selected.Reasoning?.Efforts ?? []).map(reasoningEffort => ({ reasoningEffort, description: "" })),
			inputModalities: Images ? ["text", "image"] : ["text"] };
	});
}
