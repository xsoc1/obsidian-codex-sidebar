import { Setting, requestUrl, type ButtonComponent, type DropdownComponent, type TextComponent, type ToggleComponent } from "obsidian";
import { ApiProviders, type ApiCatalogModel, type ApiProvider, type BackendProfile } from "./backend-profile";
import { list_api_models } from "./api-models";
import { error_text } from "./ui-helpers";

export function api_settings(Root: HTMLElement, Current: BackendProfile | null, Activate: (Profile: unknown, Key: string, Catalog?: ApiCatalogModel[]) => Promise<void>, Save?: (Profile: unknown, Name: string, Catalog?: ApiCatalogModel[]) => void): () => void
{
	const Active = Current?.Kind === "api" ? Current : null;
	let Provider: ApiProvider = Active?.Provider ?? "openai";
	let Model = Active?.Model ?? "", Base = Active?.Provider === "compatible" ? Active.Base : "", Vision = Active?.Vision ?? false;
	let Protocol = Active?.Protocol ?? "", Identity = Active?.Identity ?? "", Stream = Active?.Stream ?? "auto", Name = "";
	let ToolsToggle: ToggleComponent | undefined;
	let HistoryTools = Active?.HistoryTools ?? (Provider !== "compatible");
	let ApiInput: HTMLInputElement, Picker: DropdownComponent, Manual: TextComponent, Load: ButtonComponent;
	let Models: ApiCatalogModel[] = [], ReasoningCatalog: ApiCatalogModel[] | undefined, Revision = 0, Closed = false;
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
		ReasoningCatalog = undefined;
		Options([]);
		Catalog.setDesc(Initial);
		Load.setDisabled(false).setButtonText("加载模型");
	};
	new Setting(Root).setName("API 直连").setDesc("Windows、iPad 等端可单独连接服务商. 每次插件重载后重新输入 Key, 发送时所附笔记内容交给所选服务商.")
		.addDropdown(Dropdown =>
		{
			for(const [Id, Entry] of Object.entries(ApiProviders)) { Dropdown.addOption(Id, Entry.Label); }
			Dropdown.setValue(Provider).onChange(Value => { Provider = Value as ApiProvider; HistoryTools=Provider!=="compatible"; ToolsToggle?.setValue(HistoryTools); ApiInput.value = ""; Invalidate(); });
		});
	new Setting(Root).setName("自定义 HTTPS 基础地址").setDesc("仅自定义 OpenAI 兼容模式使用, 如 https://example.com/v1.")
		.addText(Text => Text.setValue(Base).onChange(Value => { Base = Value; if(Provider === "compatible") { Invalidate(); } }));
	new Setting(Root).setName("直连 API Key")
		.addText(Text =>
		{
			ApiInput = Text.inputEl;
			ApiInput.type = "password"; ApiInput.autocomplete = "off"; ApiInput.spellcheck = false;
			ApiInput.addEventListener("input", () => { if(Provider !== "opencode") { Invalidate(); } });
		});
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
			if(Entry) { Model = Value; Manual.setValue(Value); }
		});
		Options([]);
	}).addButton(Button =>
	{
		Load = Button;
		Button.setButtonText("加载模型").onClick(async () =>
		{
			const Request = ++Revision, Key = ApiInput.value;
			ReasoningCatalog = undefined;
			Options([]);
			Button.setDisabled(true).setButtonText("加载中…");
			Catalog.setDesc("正在读取模型列表…");
			try
			{
				const Items = await list_api_models(Provider, Base, Key, Value => requestUrl({ ...Value, throw: false }));
				if(Request !== Revision) { return; }
				if(Provider === "opencode" || Provider === "deepseek") { ReasoningCatalog = Items; }
				Options(Items);
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
		Text.setValue(Model).onChange(Value => { Model = Value; Select(); });
	});
	new Setting(Root).setName("模型支持图片").setDesc("确认该模型支持图像后启用, 才可发送 PDF 页图.")
		.addToggle(Toggle => Toggle.setValue(Vision).onChange(Value => { Vision = Value; }));
	new Setting(Root).setName("请求协议").setDesc("与思考档次独立；默认根据服务商或模型目录选择，不会因错误自动换协议重发。")
		.addDropdown(D => D.addOption("", "服务商或模型目录").addOption("chat", "Chat Completions").addOption("responses", "Responses").setValue(Protocol).onChange(V=>{Protocol=V;}));
	new Setting(Root).setName("响应传输").setDesc("自动使用真实流式请求；若设备或端点阻止 Fetch，可明确选择原生整段响应。")
		.addDropdown(D=>D.addOption("auto","自动流式").addOption("buffered","原生整段").setValue(Stream).onChange(V=>{Stream=V as typeof Stream;}));
	new Setting(Root).setName("身份标签").setDesc("同一端点使用不同账号时填写不同标签。只保存标签，密钥不落盘。")
		.addText(T=>T.setValue(Identity).onChange(V=>{Identity=V;}));
	new Setting(Root).setName("允许受限历史读取工具").setDesc("只允许读取当前会话的版本化原文。不支持工具的模型请关闭，改用宿主预算预取。").addToggle(T=>{ToolsToggle=T;T.setValue(HistoryTools).onChange(V=>{HistoryTools=V;});});
	const Profile = () => ({ Kind:"api", Provider, Model, Base, Vision, ...(Protocol ? {Protocol} : Models.find(M=>M.Id===Model)?.Protocol ? {Protocol:Models.find(M=>M.Id===Model)!.Protocol} : {}), ...(Identity.trim()?{Identity:Identity.trim()}:{}), Stream, HistoryTools });
	if(Save)
	{
		new Setting(Root).setName("配置名称").addText(T=>T.onChange(V=>{Name=V;})).addButton(B=>B.setButtonText("保存配置，不连接").onClick(()=>
		{
			try { const Secret=ApiInput.value.trim();if(Secret.length>=8&&JSON.stringify({Profile:Profile(),Name,Catalog:ReasoningCatalog??Models}).includes(Secret)){throw new Error("请只在密钥栏输入 API Key，不将其保存到配置名称或地址");} Save(Profile(), Name, ReasoningCatalog ?? Models); Setup.setDesc("配置已保存，不含密钥。"); }
			catch(E) { Setup.setDesc(error_text(E)); }
		}));
	}
	const Setup = new Setting(Root);
	Setup.descEl.setAttribute("aria-live", "polite");
	Setup.addButton(Button => Button.setButtonText("启用 API 直连").onClick(async () =>
	{
		const Key = ApiInput.value, Candidate = Profile();
		Button.setDisabled(true);
		Setup.setDesc("正在启用直连…");
		try
		{
			await Activate(Candidate, Key, ReasoningCatalog ?? Models);
			if(Closed) { return; }
			if(Provider === Candidate.Provider && Base === Candidate.Base && ApiInput.value === Key) { ApiInput.value = ""; }
			Setup.setDesc(`已启用 ${ApiProviders[Candidate.Provider].Label} · ${Candidate.Model.trim()}. 回侧栏发一条短问题验证权限.`);
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
