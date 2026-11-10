import { SecretComponent, Setting, requestUrl, type App, type ButtonComponent, type DropdownComponent, type TextComponent, type ToggleComponent } from "obsidian";
import { ApiProviders, api_base, api_image_status, backend_identity, backend_profile, select_api_model, type ApiCatalogModel, type ApiCredentialScope, type ApiProvider, type BackendProfile, type ApiProfile, type ApiSelectionOverrides } from "./backend-profile";
import { list_api_models } from "./api-models";
import { error_text } from "./ui-helpers";
import type { ApiSecretBindings } from "./api-secret-bindings";

export function api_settings(Root: HTMLElement, Current: BackendProfile | null, Activate: (Profile: unknown, Key: string, Catalog?: ApiCatalogModel[], SecretLink?: string) => Promise<void | string>, Save?: (Profile: unknown, Name: string, Catalog?: ApiCatalogModel[]) => void, Secrets?: { App: App; Bindings: ApiSecretBindings }): () => void
{
	const Active = Current?.Kind === "api" ? Current : null;
	let Provider: ApiProvider = Active?.Provider ?? "openai";
	let Model = Active?.Model ?? "", Base = Active?.Provider === "compatible" ? Active.Base : "";
	let Identity = Active?.Identity ?? "", Stream = Active?.Stream ?? "auto", Name = "";
	let Selected: ApiProfile | undefined = Active ?? undefined, CatalogKnown = false;
	let VisionToggle: ToggleComponent | undefined, ProtocolPicker: DropdownComponent | undefined, VisionSetting: Setting | undefined;
	let ToolsToggle: ToggleComponent | undefined;
	let HistoryTools = Active?.HistoryTools ?? (Provider !== "compatible");
	let ApiInput: HTMLInputElement, Picker: DropdownComponent, Manual: TextComponent, Load: ButtonComponent;
	let Models: ApiCatalogModel[] = [], ReasoningCatalog: ApiCatalogModel[] | undefined, Revision = 0, Closed = false;
	let SecretPicker: SecretComponent | undefined, ForgetSecret: ButtonComponent | undefined, SecretAlias = "", LastScope = "";
	const Scope = (): ApiCredentialScope | undefined =>
	{
		const Label = Identity.trim();
		try { return { Kind: "api", Provider, Base: api_base(Provider, Base), Identity: Label === "default" ? "" : Label }; }
		catch { return; }
	};
	const ResetCredential = () =>
	{
		const Next = Scope(), Id = Next ? backend_identity(Next) : "";
		if(Id === LastScope) { return; }
		LastScope = Id;
		ApiInput.value = "";
		SecretAlias = Next && Secrets ? Secrets.Bindings.alias(Next) : "";
		SecretPicker?.setValue(SecretAlias);
		ForgetSecret?.setDisabled(!SecretAlias);
	};
	const UpdateSelection = (Overrides: ApiSelectionOverrides = {}): ApiProfile =>
	{
		const Previous = Selected;
		const Draft = backend_profile({ Kind: "api", Provider, Model, Base, Vision: false, ...(Selected?.Selection ? { Selection: Selected.Selection } : {}),
			...(Identity.trim() ? { Identity: Identity.trim() } : {}), Stream, HistoryTools }) as ApiProfile;
		const SameModel = Previous?.Provider === Draft.Provider && Previous.Base === Draft.Base && Previous.Model === Draft.Model;
		if(SameModel && !Previous.Selection && Previous.Protocol) { Draft.Protocol = Previous.Protocol; }
		const Catalog = CatalogKnown ? Models : undefined;
		const Atomic = select_api_model(Draft, Model, Catalog, "", Overrides).Profile;
		// Preserve only this legacy tuple's enablement; it is not catalog or manual evidence.
		if(SameModel && !Previous.Selection && typeof Catalog?.find(M => M.Id === Draft.Model)?.Vision !== "boolean" && typeof Overrides.Vision !== "boolean")
		{
			Selected = { ...Atomic, Vision: Previous.Vision };
			delete Selected.Selection;
			if(Atomic.Selection?.Protocol.Source === "provider") { delete Selected.Protocol; }
		}
		else { Selected = Atomic; }
		VisionToggle?.setValue(Selected.Vision);
		VisionSetting?.setDesc(api_image_status(Selected));
		ProtocolPicker?.setValue(!Selected.Selection || Selected.Selection.Protocol.Source === "manual" || Selected.Selection.Protocol.Source === "legacy" ? Selected.Protocol ?? "" : "");
		return Selected;
	};
	const PreviewSelection = (Overrides: ApiSelectionOverrides = {}) =>
	{
		try { UpdateSelection(Overrides); }
		catch { Selected = undefined; VisionToggle?.setValue(false); VisionSetting?.setDesc("先填写有效的模型与端点，再确认图片能力。"); ProtocolPicker?.setValue(""); }
	};
	const Initial = "读取服务商目录后选择. 可用权限以实际请求为准.";
	const Select = () => { Picker.setValue(Models.some(Item => Item.Id === Model) ? Model : ""); };
	const Options = (Items: ApiCatalogModel[]) =>
	{
		Models = Items;
		Picker.selectEl.replaceChildren();
		Picker.addOption("", Items.length ? "选择模型" : "暂无模型列表");
		for(const { Id } of Items) { Picker.addOption(Id, Id); }
		Picker.setDisabled(!Items.length);
		Select();
	};
	const Invalidate = () =>
	{
		Revision++;
		CatalogKnown = false;
		ReasoningCatalog = undefined;
		Options([]);
		PreviewSelection();
		Catalog.setDesc(Initial);
		Load.setDisabled(false).setButtonText("加载模型");
	};
	new Setting(Root).setName("API 直连").setDesc("设备可单独连接服务商；发送时附带的笔记内容交给所选服务商。")
		.addDropdown(Dropdown =>
		{
			for(const [Id, Entry] of Object.entries(ApiProviders)) { Dropdown.addOption(Id, Entry.Label); }
			Dropdown.setValue(Provider).onChange(Value => { Provider = Value as ApiProvider; HistoryTools=Provider!=="compatible"; ToolsToggle?.setValue(HistoryTools); ResetCredential(); Invalidate(); });
		});
	new Setting(Root).setName("自定义 HTTPS 基础地址").setDesc("仅自定义 OpenAI 兼容模式使用, 如 https://example.com/v1.")
		.addText(Text => Text.setValue(Base).onChange(Value => { Base = Value; if(Provider === "compatible") { ResetCredential(); Invalidate(); } }));
	new Setting(Root).setName("直连 API Key").setDesc("临时使用；重开 Obsidian 后需重填。")
		.addText(Text =>
		{
			ApiInput = Text.inputEl;
			ApiInput.type = "password"; ApiInput.autocomplete = "off"; ApiInput.spellcheck = false;
			ApiInput.addEventListener("input", () =>
			{
				if(ApiInput.value && SecretAlias) { SecretAlias = ""; SecretPicker?.setValue(""); }
				if(Provider !== "opencode") { Invalidate(); }
			});
		});
	if(Secrets && typeof SecretComponent === "function")
	{
		const Remember = new Setting(Root).setName("记住 API Key（可选）").setDesc("选择或新建 Obsidian 密钥，再点启用。关联只用于本设备的当前服务商、端点和身份。");
		Remember.addComponent(El =>
		{
			SecretPicker = new SecretComponent(Secrets.App, El);
			return SecretPicker.onChange(Value => { SecretAlias = Value ?? ""; if(SecretAlias) { ApiInput.value = ""; } if(Provider !== "opencode") { Invalidate(); } });
		});
		Remember.addButton(B =>
		{
			ForgetSecret = B;
			B.setButtonText("取消关联").setDisabled(true).onClick(() =>
			{
				const CurrentScope = Scope();
				if(!CurrentScope) { return; }
				try
				{
					Secrets.Bindings.set(CurrentScope, null);
					SecretAlias = ""; SecretPicker?.setValue(""); B.setDisabled(true); Invalidate();
					Remember.setDesc("已取消关联；共享密钥未删除。当前连接仍可用，重开后不再使用该关联。");
				}
				catch { Remember.setDesc("未能取消关联，请检查本机设置存储。"); }
			});
		});
	}
	ResetCredential();
	const Catalog = new Setting(Root).setClass("codex-api-catalog").setName("上游模型").setDesc(Initial);
	Catalog.nameEl.id = `codex-api-catalog-${crypto.randomUUID()}`;
	Catalog.descEl.setAttribute("aria-live", "polite");
	Catalog.addDropdown(Dropdown =>
	{
		Picker = Dropdown;
		Picker.selectEl.setAttribute("aria-labelledby", Catalog.nameEl.id);
		Picker.onChange(Value =>
		{
			const Entry = Models.find(Item => Item.Id === Value);
			if(Entry) { Model = Value; Manual.setValue(Value); PreviewSelection(); }
		});
		Options([]);
	}).addButton(Button =>
	{
		Load = Button;
		Button.setButtonText("加载模型").onClick(async () =>
		{
			const Request = ++Revision;
			Button.setDisabled(true).setButtonText("加载中…");
			Catalog.setDesc("正在读取模型列表…");
			try
			{
				const Key = Provider === "opencode" ? "" : ApiInput.value || (SecretAlias ? Secrets!.Bindings.read(SecretAlias) : "");
				const Items = await list_api_models(Provider, Base, Key, Value => requestUrl({ ...Value, throw: false }));
				if(Request !== Revision) { return; }
				if(Provider === "opencode" || Provider === "deepseek") { ReasoningCatalog = Items; }
				CatalogKnown = true;
				Options(Items);
				PreviewSelection();
				Catalog.setDesc(Items.length ? `已读取 ${Items.length} 个模型. ${Provider === "opencode" ? "公开目录不代表 Go 工作区权限." : "可用权限以实际请求为准."}`
					: "服务商没有返回可选模型. 可以手动填写模型 ID.");
			}
			catch(ErrorValue)
			{
				if(Request === Revision) { Catalog.setDesc(`${error_text(ErrorValue)}. 可以手动填写模型 ID.`); }
			}
			finally
			{
				if(Request === Revision) { Button.setDisabled(false).setButtonText("加载模型"); }
			}
		});
	});
	const ManualSetting = new Setting(Root).setName("API 模型 ID").setDesc("从上游列表选择, 或手动填写.");
	ManualSetting.nameEl.id = `codex-api-model-${crypto.randomUUID()}`;
	ManualSetting.addText(Text =>
	{
		Manual = Text;
		Text.inputEl.setAttribute("aria-labelledby", ManualSetting.nameEl.id);
		Text.setValue(Model).onChange(Value => { Model = Value; Select(); PreviewSelection(); });
	});
	VisionSetting = new Setting(Root).setName("模型支持图片").setDesc("人工确认只绑定当前服务商、端点和模型；目录明确不支持时不能覆盖。")
		.addToggle(Toggle => { VisionToggle = Toggle; Toggle.setValue(Selected?.Selection?.Vision.Manual === true).onChange(Value => PreviewSelection({ Vision: Value })); })
		.addButton(Button => Button.setButtonText("清除人工确认").onClick(() => PreviewSelection({ Vision: "unknown" })));
	new Setting(Root).setName("请求协议").setDesc("与思考档次独立；默认根据服务商或模型目录选择，不会因错误自动换协议重发。")
		.addDropdown(D => { ProtocolPicker = D; D.addOption("", "服务商或模型目录").addOption("chat", "Chat Completions").addOption("responses", "Responses").setValue("").onChange(V => PreviewSelection({ Protocol: V === "chat" || V === "responses" ? V : "auto" })); });
	new Setting(Root).setName("响应传输").setDesc(`更改后须点「启用 API 直连」。${Active ? `打开设置时：${Active.Stream === "buffered" ? "原生整段" : "自动流式"}。` : ""}iPad 直连 OpenCode Go 建议选原生整段。`)
		.addDropdown(D=>D.addOption("auto","自动流式").addOption("buffered","原生整段").setValue(Stream).onChange(V=>{Stream=V as typeof Stream;}));
	new Setting(Root).setName("身份标签").setDesc("同一端点使用不同账号时填写不同标签。")
		.addText(T=>T.setValue(Identity).onChange(V=>{Identity=V;ResetCredential();Invalidate();}));
	new Setting(Root).setName("允许受限历史读取工具").setDesc("只允许读取当前会话的版本化原文。不支持工具的模型请关闭，改用宿主预算预取。").addToggle(T=>{ToolsToggle=T;T.setValue(HistoryTools).onChange(V=>{HistoryTools=V;});});
	const Profile = () => UpdateSelection();
	const SelectedCatalog = () => CatalogKnown ? ReasoningCatalog ?? Models : undefined;
	PreviewSelection();
	if(Save)
	{
		new Setting(Root).setName("配置名称").addText(T=>T.onChange(V=>{Name=V;})).addButton(B=>B.setButtonText("保存配置，不连接").onClick(()=>
		{
			try { const Secret=ApiInput.value.trim();if(Secret.length>=8&&JSON.stringify({Profile:Profile(),Name,Catalog:SelectedCatalog()}).includes(Secret)){throw new Error("请只在密钥栏输入 API Key，不将其保存到配置名称或地址");} Save(Profile(), Name, SelectedCatalog()); Setup.setDesc("配置已保存，不含密钥。"); }
			catch(E) { Setup.setDesc(error_text(E)); }
		}));
	}
	const Setup = new Setting(Root);
	Setup.descEl.setAttribute("aria-live", "polite");
	Setup.addButton(Button => Button.setButtonText("启用 API 直连").onClick(async () =>
	{
		const Key = ApiInput.value;
		Button.setDisabled(true);
		Setup.setDesc("正在启用直连…");
		try
		{
			const Candidate = Profile();
			const Alias = SecretAlias || undefined;
			if(SecretPicker && !Alias && !Key.trim() && Secrets?.Bindings.alias(Candidate)) { throw new Error("请重新选择已关联的密钥，或填写临时 API Key"); }
			const Status = await Activate(Candidate, Key, SelectedCatalog(), Alias);
			if(Closed) { return; }
			if(Provider === Candidate.Provider && Selected?.Base === Candidate.Base && Selected.Model === Candidate.Model && ApiInput.value === Key) { ApiInput.value = ""; }
			const CurrentScope = Scope();
			if(CurrentScope && backend_identity(CurrentScope) === backend_identity(Candidate)) { ForgetSecret?.setDisabled(!Secrets?.Bindings.alias(Candidate)); }
			Setup.setDesc(`已启用 ${Status || `${ApiProviders[Candidate.Provider].Label} · ${Candidate.Model.trim()}`} · ${Candidate.Stream === "buffered" ? "原生整段" : "自动流式"}。回侧栏发一条短问题验证权限。`);
		}
		catch(ErrorValue)
		{
			if(Closed) { return; }
			const Message = error_text(ErrorValue), Secret = Key.trim();
			Setup.setDesc(`启用失败: ${Secret.length >= 8 ? Message.replaceAll(Secret, "[redacted]") : Message}`);
		}
		finally { Button.setDisabled(false); }
	}));
	return () => { Closed = true; Revision++; ApiInput.value = ""; };
}
