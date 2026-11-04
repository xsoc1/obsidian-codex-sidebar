import { Setting, requestUrl, type ButtonComponent, type DropdownComponent, type TextComponent } from "obsidian";
import { ApiProviders, type ApiCatalogModel, type ApiProvider, type BackendProfile } from "./backend-profile";
import { list_api_models } from "./api-models";
import { error_text } from "./ui-helpers";

export function api_settings(Root: HTMLElement, Current: BackendProfile | null, Activate: (Profile: unknown, Key: string, Catalog?: ApiCatalogModel[]) => Promise<void>): () => void
{
	const Active = Current?.Kind === "api" ? Current : null;
	let Provider: ApiProvider = Active?.Provider ?? "openai";
	let Model = Active?.Model ?? "", Base = Active?.Provider === "compatible" ? Active.Base : "", Vision = Active?.Vision ?? false;
	let ApiInput: HTMLInputElement, Picker: DropdownComponent, Manual: TextComponent, Load: ButtonComponent;
	let Models: ApiCatalogModel[] = [], GoCatalog: ApiCatalogModel[] | undefined, Revision = 0, Closed = false;
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
		GoCatalog = undefined;
		Options([]);
		Catalog.setDesc(Initial);
		Load.setDisabled(false).setButtonText("加载模型");
	};
	new Setting(Root).setName("API 直连").setDesc("Windows、iPad 等端可单独连接服务商. 每次插件重载后重新输入 Key, 发送时所附笔记内容交给所选服务商.")
		.addDropdown(Dropdown =>
		{
			for(const [Id, Entry] of Object.entries(ApiProviders)) { Dropdown.addOption(Id, Entry.Label); }
			Dropdown.setValue(Provider).onChange(Value => { Provider = Value as ApiProvider; ApiInput.value = ""; Invalidate(); });
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
			if(Models.some(Item => Item.Id === Value)) { Model = Value; Manual.setValue(Value); }
		});
		Options([]);
	}).addButton(Button =>
	{
		Load = Button;
		Button.setButtonText("加载模型").onClick(async () =>
		{
			const Request = ++Revision, Key = ApiInput.value;
			GoCatalog = undefined;
			Options([]);
			Button.setDisabled(true).setButtonText("加载中…");
			Catalog.setDesc("正在读取模型列表…");
			try
			{
				const Items = await list_api_models(Provider, Base, Key, Value => requestUrl({ ...Value, throw: false }));
				if(Request !== Revision) { return; }
				if(Provider === "opencode") { GoCatalog = Items; }
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
	const Setup = new Setting(Root);
	Setup.descEl.setAttribute("aria-live", "polite");
	Setup.addButton(Button => Button.setButtonText("启用 API 直连").onClick(async () =>
	{
		const Key = ApiInput.value, Profile = { Kind: "api", Provider, Model, Base, Vision };
		Button.setDisabled(true);
		Setup.setDesc("正在启用直连…");
		try
		{
			await Activate(Profile, Key, GoCatalog);
			if(Closed) { return; }
			if(Provider === Profile.Provider && Base === Profile.Base && ApiInput.value === Key) { ApiInput.value = ""; }
			Setup.setDesc(`已启用 ${ApiProviders[Profile.Provider].Label} · ${Profile.Model.trim()}. 回侧栏发一条短问题验证权限.`);
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
