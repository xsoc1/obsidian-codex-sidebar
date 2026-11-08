import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import { backend_profile, select_api_model, type ApiProfile } from "../src/backend-profile";
import { backend_capabilities } from "../src/backend-capabilities";
import { backend_model_choices } from "../src/backend-models";
import { ConnectionProfiles } from "../src/connection-profiles";
import { direct_api } from "../src/direct-api";

const Code = buildSync({ entryPoints: ["src/api-settings.ts"], bundle: true, platform: "browser", format: "cjs", external: ["obsidian"], write: false }).outputFiles[0].text;
function settings_fixture(Http: (Request: any) => Promise<any>, Current: ApiProfile | null = null)
{
	const Settings: any[] = [], Attempts: any[] = [], Saved: any[] = [];
	let FailActivation = false;
	class Setting
	{
		Name = ""; Desc = ""; Controls: any[] = [];
		nameEl = { id: "" }; descEl = { setAttribute() {} };
		constructor(_Root: unknown) { Settings.push(this); }
		setName(Value: string) { this.Name = Value; return this; }
		setDesc(Value: string) { this.Desc = Value; return this; }
		setClass() { return this; }
		control(Type: string, Build: (Control: any) => void)
		{
			const Control: any = {
				Type, Options: {}, inputEl: { value: "", setAttribute() {}, addEventListener(Name: string, Handler: any) { (this as any)[Name] = Handler; } },
				selectEl: { setAttribute() {}, replaceChildren() { Control.Options = {}; } },
				setValue(Value: any) { this.Value = Value; this.inputEl.value = Value; return this; },
				setDisabled(Value: boolean) { this.Disabled = Value; return this; }, setButtonText(Value: string) { this.Text = Value; return this; },
				addOption(Id: string, Label: string) { this.Options[Id] = Label; return this; },
				onChange(Handler: any) { this.Change = (Value: any) => { this.setValue(Value); return Handler(Value); }; return this; },
				onClick(Handler: any) { this.Click = Handler; return this; }
			};
			this.Controls.push(Control); Build(Control); return this;
		}
		addDropdown(Build: any) { return this.control("dropdown", Build); }
		addText(Build: any) { return this.control("text", Build); }
		addToggle(Build: any) { return this.control("toggle", Build); }
		addButton(Build: any) { return this.control("button", Build); }
	}
	const Export = { exports: {} as any };
	runInNewContext(Code, { module: Export, exports: Export.exports, require: (Name: string) => { assert.equal(Name, "obsidian"); return { Setting, requestUrl: Http }; },
		crypto: { randomUUID }, URL, AbortController, TextEncoder, TextDecoder, DOMException, setTimeout, clearTimeout, structuredClone });
	const Close = Export.exports.api_settings({}, Current, async (Profile: any, Key: string, Catalog?: any[]) =>
	{
		Attempts.push({ Profile, Key, Catalog });
		if(FailActivation) { throw Error("original activation failure"); }
	}, (Profile: any, Name: string, Catalog?: any[]) => Saved.push({ Profile, Name, Catalog }));
	const Row = (Name: string) => { const Found = Settings.find(S => S.Name === Name); assert.ok(Found, Name); return Found; };
	const Control = (Name: string, Type: string) => { const Found = Row(Name).Controls.find((C: any) => C.Type === Type); assert.ok(Found, Name + Type); return Found; };
	return { Row, Control, Attempts, Saved, Close, fail_activation: (Value: boolean) => { FailActivation = Value; } };
}
const GoCatalog = [
	{ id: "original-image", modalities: { input: ["text", "image/jpeg"] }, api: { responses: {} } },
	{ id: "original-text", modalities: { input: ["text"] }, api: { "chat-completions": {} } }, { id: "original-unknown" }
];

test("R02 settings picker updates images and protocol both ways; failed activation keeps the selected draft, catalog and masked key", async () =>
{
	const F = settings_fixture(async () => ({ status: 200, json: { data: GoCatalog } }));
	try
	{
		F.Control("API 直连", "dropdown").Change("opencode");
		const Key = F.Control("直连 API Key", "text").inputEl; Key.value = "original-ui-key";
		await F.Control("上游模型", "button").Click();
		const Picker = F.Control("上游模型", "dropdown"), Vision = F.Control("模型支持图片", "toggle");
		Picker.Change("original-image"); assert.equal(Vision.Value, true); assert.match(F.Row("模型支持图片").Desc, /目录明确支持/);
		Picker.Change("original-text"); assert.equal(Vision.Value, false); assert.match(F.Row("模型支持图片").Desc, /目录明确不支持/);
		Picker.Change("original-image"); assert.equal(Vision.Value, true);
		Picker.Change("original-unknown"); assert.equal(Vision.Value, false);
		Vision.Change(true); assert.match(F.Row("模型支持图片").Desc, /人工确认/);
		Picker.Change("original-text"); Vision.Change(true); assert.equal(Vision.Value, false); assert.match(F.Row("模型支持图片").Desc, /不能覆盖/);
		F.fail_activation(true); await F.Control("", "button").Click();
		assert.equal(F.Attempts.length, 1); assert.equal(F.Attempts[0].Profile.Model, "original-text");
		assert.equal(F.Attempts[0].Profile.Vision, false); assert.equal(F.Attempts[0].Profile.Protocol, "chat");
		assert.equal(Key.value, "original-ui-key"); assert.equal(Picker.Value, "original-text");
		assert.equal(Object.keys(Picker.Options).length, 4); assert.match(F.Row("").Desc, /启用失败/);
		Picker.Change("original-image"); F.fail_activation(false); await F.Control("", "button").Click();
		assert.equal(F.Attempts[1].Profile.Vision, true); assert.equal(F.Attempts[1].Profile.Protocol, "responses");
		assert.equal(Key.value, "");
	}
	finally { F.Close(); }
});

test("R02 obsolete asynchronous catalogs cannot update another provider or a closed settings form", async () =>
{
	let Resolve!: (Value: any) => void;
	const F = settings_fixture(() => new Promise(R => { Resolve = R; }));
	F.Control("API 直连", "dropdown").Change("opencode");
	const Loading = F.Control("上游模型", "button").Click();
	F.Control("API 直连", "dropdown").Change("deepseek");
	Resolve({ status: 200, json: { data: GoCatalog } }); await Loading;
	assert.equal(Object.keys(F.Control("上游模型", "dropdown").Options).length, 1);
	assert.match(F.Row("上游模型").Desc, /读取服务商目录后选择/);
	F.Control("API 直连", "dropdown").Change("opencode");
	const Closed = F.Control("上游模型", "button").Click(); F.Close();
	Resolve({ status: 200, json: { data: GoCatalog } }); await Closed;
	assert.equal(Object.keys(F.Control("上游模型", "dropdown").Options).length, 1);
	assert.equal(F.Attempts.length, 0);
});

test("R02 failed catalog refresh retains a usable draft; an authoritative empty refresh removes only directory evidence", async () =>
{
	let Mode = "success";
	const F = settings_fixture(async () => { if(Mode === "fail") { throw Error("original offline fixture"); } return { status: 200, json: { data: Mode === "empty" ? [] : GoCatalog } }; });
	try
	{
		F.Control("API 直连", "dropdown").Change("opencode");
		await F.Control("上游模型", "button").Click(); F.Control("上游模型", "dropdown").Change("original-image");
		Mode = "fail"; await F.Control("上游模型", "button").Click();
		assert.equal(F.Control("模型支持图片", "toggle").Value, true); assert.equal(Object.keys(F.Control("上游模型", "dropdown").Options).length, 4);
		F.Control("配置名称", "text").Change("原创配置"); F.Control("配置名称", "button").Click();
		assert.equal(F.Saved[0].Profile.Vision, true); assert.equal(F.Saved[0].Catalog.length, 3);
		Mode = "empty"; await F.Control("上游模型", "button").Click();
		assert.equal(F.Control("模型支持图片", "toggle").Value, false); assert.equal(F.Control("API 模型 ID", "text").Value, "original-image");
		F.Control("配置名称", "button").Click(); assert.equal(F.Saved[1].Profile.Selection.Vision.Catalog, undefined);
	}
	finally { F.Close(); }
});

test("R02 reopening settings preserves bound manual and directory evidence without claiming an empty catalog refresh", () =>
{
	const Profile = backend_profile({ Kind: "api", Provider: "compatible", Base: "https://original.invalid/v1", Model: "original" }) as ApiProfile;
	const Selected = select_api_model(Profile, Profile.Model, [{ Id: Profile.Model, Vision: true }], "", { Vision: true, Protocol: "responses" });
	const F = settings_fixture(async () => assert.fail("reopening must not fetch"), Selected.Profile);
	try
	{
		assert.equal(F.Control("模型支持图片", "toggle").Value, true); assert.equal(F.Control("请求协议", "dropdown").Value, "responses");
		F.Control("配置名称", "button").Click();
		assert.equal(F.Saved[0].Catalog, undefined); assert.equal(F.Saved[0].Profile.Vision, true);
		assert.equal(F.Saved[0].Profile.Selection.Vision.Manual, true); assert.equal(F.Saved[0].Profile.Selection.Vision.Catalog, true);
		F.Control("请求协议", "dropdown").Change("");
		F.Control("配置名称", "button").Click(); assert.equal(F.Saved[1].Profile.Protocol, "chat");
	}
	finally { F.Close(); }
});

function legacy_profile(): ApiProfile
{
	return backend_profile({ Kind: "api", Provider: "compatible", Base: "https://original.invalid/v1", Model: "original-legacy", Vision: true, Protocol: "responses", Stream: "buffered" }) as ApiProfile;
}

test("R02 legacy settings preserve image enablement through reopen, unrelated edits, save and activate without invented evidence", async () =>
{
	const Original = legacy_profile(), F = settings_fixture(async () => assert.fail("opening settings must not fetch"), Original);
	const Values = new Map<string, string>(), Storage = { getItem: (K: string) => Values.get(K) ?? null, setItem: (K: string, V: string) => { Values.set(K, V); } };
	let Saved: ApiProfile;
	try
	{
		assert.equal(F.Control("模型支持图片", "toggle").Value, true);
		assert.match(F.Row("模型支持图片").Desc, /旧.*开启/);
		F.Control("请求协议", "dropdown").Change("chat");
		F.Control("自定义 HTTPS 基础地址", "text").Change(" https://ORIGINAL.invalid:443/v1/ ");
		F.Control("配置名称", "text").Change("旧配置仍可用");
		const Key = F.Control("直连 API Key", "text").inputEl; Key.value = "original-legacy-ui-key"; Key.input();
		F.Control("配置名称", "button").Click();
		assert.equal(F.Saved[0].Profile.Vision, true); assert.equal(F.Saved[0].Profile.Selection, undefined);
		assert.equal(F.Saved[0].Profile.Protocol, "chat");
		new ConnectionProfiles(Storage, "r02-legacy-ui").save(F.Saved[0].Profile, "旧配置仍可用", F.Saved[0].Catalog);
		Saved = new ConnectionProfiles(Storage, "r02-legacy-ui").list()[0].Profile as ApiProfile;
	}
	finally { F.Close(); }
	const R = settings_fixture(async () => assert.fail("reopening must not fetch"), Saved!);
	try
	{
		assert.equal(R.Control("模型支持图片", "toggle").Value, true);
		R.Control("直连 API Key", "text").inputEl.value = "original-legacy-ui-key";
		await R.Control("", "button").Click();
		const Active = R.Attempts[0].Profile as ApiProfile;
		assert.equal(Active.Vision, true); assert.equal(Active.Selection, undefined);
		assert.equal(backend_capabilities(Active).Images, "unknown");
		assert.deepEqual(backend_model_choices(Active)[0].inputModalities, ["text", "image"]);
		const Requests: any[] = [], Images = ["data:image/jpeg;base64,AA=="];
		const Result = await direct_api(Active, "original-legacy-ui-key", async Request =>
		{
			Requests.push(JSON.parse(Request.body!)); return { status: 200, json: { choices: [{ finish_reason: "stop", message: { content: "$x=x$" } }] } };
		})({ Session: "original-legacy", Messages: [{ Role: "user", Text: "原图片请求", Images }] }, new AbortController().signal);
		assert.equal(Result.Status, "completed"); assert.equal(Requests[0].messages[0].content[1].image_url.url, Images[0]);
		assert.equal(Images.length, 1); assert.equal(Original.Vision, true); assert.equal(Original.Selection, undefined);
	}
	finally { R.Close(); }
});

test("R02 legacy unknown or empty catalogs keep enablement; explicit catalog declarations select atomically", async () =>
{
	let Mode: "unknown" | "empty" | "fail" | "deny" | "allow" = "unknown";
	const Original = backend_profile({ Kind: "api", Provider: "opencode", Model: "original-legacy", Vision: true }) as ApiProfile;
	const F = settings_fixture(async () =>
	{
		if(Mode === "fail") { throw Error("original catalog failure"); }
		return { status: 200, json: { data: Mode === "empty" ? [] : [{ id: "original-legacy", api: { "chat-completions": {} }, ...(Mode === "deny" || Mode === "allow" ? { modalities: { input: Mode === "deny" ? ["text"] : ["text", "image/jpeg"] } } : {}) }] } };
	}, Original);
	try
	{
		for(const Next of ["unknown", "empty", "fail"] as const)
		{
			Mode = Next; await F.Control("上游模型", "button").Click(); F.Control("配置名称", "button").Click();
			assert.equal(F.Saved.at(-1).Profile.Vision, true); assert.equal(F.Saved.at(-1).Profile.Selection, undefined);
		}
		Mode = "deny"; await F.Control("上游模型", "button").Click(); F.Control("配置名称", "button").Click();
		assert.equal(F.Saved.at(-1).Profile.Vision, false); assert.equal(F.Saved.at(-1).Profile.Selection.Vision.Catalog, false);
		assert.equal(F.Saved.at(-1).Profile.Selection.Vision.Manual, undefined);
		Mode = "allow"; await F.Control("上游模型", "button").Click(); F.Control("配置名称", "button").Click();
		assert.equal(F.Saved.at(-1).Profile.Vision, true); assert.equal(F.Saved.at(-1).Profile.Selection.Vision.Catalog, true);
	}
	finally { F.Close(); }
});

test("R02 legacy image enablement does not cross a model, endpoint or provider change, and explicit switches establish new evidence", () =>
{
	for(const [Name, Type, Value] of [["API 模型 ID", "text", "other-model"], ["自定义 HTTPS 基础地址", "text", "https://other.invalid/v1"], ["API 直连", "dropdown", "opencode"]])
	{
		const F = settings_fixture(async () => assert.fail("must not fetch"), legacy_profile());
		try
		{
			F.Control(Name, Type).Change(Value); F.Control("配置名称", "button").Click();
			assert.equal(F.Saved[0].Profile.Vision, false); assert.equal(F.Saved[0].Profile.Selection.Vision.Manual, undefined);
		}
		finally { F.Close(); }
	}
	const F = settings_fixture(async () => assert.fail("must not fetch"), legacy_profile());
	try
	{
		F.Control("模型支持图片", "button").Click(); F.Control("配置名称", "button").Click();
		assert.equal(F.Saved.at(-1).Profile.Vision, true); assert.equal(F.Saved.at(-1).Profile.Selection, undefined);
		F.Control("模型支持图片", "toggle").Change(false); F.Control("配置名称", "button").Click();
		assert.equal(F.Saved.at(-1).Profile.Vision, false); assert.equal(F.Saved.at(-1).Profile.Selection.Vision.Manual, false);
		F.Control("模型支持图片", "toggle").Change(true); F.Control("配置名称", "button").Click();
		assert.equal(F.Saved.at(-1).Profile.Vision, true); assert.equal(F.Saved.at(-1).Profile.Selection.Vision.Manual, true);
		F.Control("模型支持图片", "button").Click(); F.Control("配置名称", "button").Click();
		assert.equal(F.Saved.at(-1).Profile.Vision, false); assert.equal(F.Saved.at(-1).Profile.Selection.Vision.Manual, undefined);
	}
	finally { F.Close(); }
});
