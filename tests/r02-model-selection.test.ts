import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as Profiles from "../src/backend-profile";
import { backend_capabilities } from "../src/backend-capabilities";
import { list_api_models } from "../src/api-models";
import { ConnectionCredentials, ConnectionProfiles } from "../src/connection-profiles";
import { backend_model_choices } from "../src/backend-models";
import { direct_api } from "../src/direct-api";
import { BackendConnection } from "../src/backend";

test("R02 unannotated legacy booleans are enablement, not verified image capabilities", async () =>
{
	for(const Vision of [true, false])
	{
		const Profile = Profiles.backend_profile({ Kind: "api", Provider: "compatible", Base: "https://original.invalid/v1", Model: "original-legacy", Vision });
		assert.equal(backend_capabilities(Profile).Images, "unknown");
		const Connection = new BackendConnection(Profile, async () => "original", () => {});
		try
		{
			assert.equal((await Connection.request("initialize", {})).backendCapabilities.Images, "unknown");
			assert.deepEqual((await Connection.request("model/list", {})).data[0].inputModalities, Vision ? ["text", "image"] : ["text"]);
		}
		finally { Connection.close(); }
	}
});

const BaseProfile = () => Profiles.backend_profile({ Kind: "api", Provider: "opencode", Model: "original-image", Vision: true, Stream: "buffered" }) as Profiles.ApiProfile;
const Catalog: Profiles.ApiCatalogModel[] = [
	{ Id: "original-image", Vision: true, Protocol: "responses", Reasoning: { Format: "responses", Efforts: ["low", "high"] } },
	{ Id: "original-text", Vision: false, Protocol: "chat", Reasoning: { Format: "chat", Efforts: ["low"] } },
	{ Id: "original-unknown" }
];

test("R02 one selection atomically binds model, protocol, images and permitted effort for picker and driver", async () =>
{
	const Image = Profiles.select_api_model(BaseProfile(), "original-image", Catalog, "high");
	const Text = Profiles.select_api_model(Image.Profile, "original-text", Catalog, "high");
	assert.equal(Text.Profile.Protocol, "chat"); assert.equal(Text.Images, false); assert.equal(Text.Effort, "");
	const Back = Profiles.select_api_model(Text.Profile, "original-image", Catalog, "high");
	assert.equal(Back.Images, true); assert.equal(Back.Effort, "high");
	assert.equal(Back.Profile.Selection?.Model, Back.Profile.Model);
	const Picker = backend_model_choices(Text.Profile, Catalog);
	assert.deepEqual(Picker.find(M => M.model === "original-image")?.inputModalities, ["text", "image"]);
	assert.deepEqual(Picker.find(M => M.model === "original-text")?.inputModalities, ["text"]);
	const Requests: any[] = [];
	const Send = async (Request: any) => { Requests.push(Request); return { status: 200, json: { id: "original-result", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "$x=x$" }] }] } }; };
	const Input = { Session: "original", Messages: [{ Role: "user" as const, Text: "解释此公式", Images: ["data:image/jpeg;base64,AA=="] }] };
	await assert.rejects(direct_api(Text.Profile, "original-fixture-secret", Send, Text.Reasoning)(Input, new AbortController().signal), /图像/);
	assert.equal(Requests.length, 0);
	assert.equal((await direct_api(Back.Profile, "original-fixture-secret", Send, Back.Reasoning)({ ...Input, Effort: Back.Effort }, new AbortController().signal)).Status, "completed");
	const Wire = JSON.parse(Requests[0].body);
	assert.equal(Wire.model, Back.Profile.Model); assert.equal(Wire.reasoning.effort, "high");
	assert.equal(Wire.input[0].content[1].image_url, Input.Messages[0].Images[0]);
	assert.match(Requests[0].url, /\/responses$/);
	assert.equal(Input.Messages[0].Images.length, 1);
});

test("R02 unknown capabilities and legacy booleans do not invent catalog or manual evidence", () =>
{
	const Legacy = BaseProfile();
	assert.equal(Legacy.Vision, true); assert.equal(Legacy.Selection, undefined);
	const Unknown = Profiles.select_api_model(Legacy, "original-unknown", Catalog, "high");
	assert.equal(Unknown.Images, "unknown"); assert.equal(Unknown.Profile.Vision, false); assert.equal(Unknown.Effort, "");
	assert.deepEqual(Unknown.Profile.Selection?.Vision, {});
	assert.equal(Unknown.Profile.Protocol, "chat");
	assert.match(Profiles.api_image_status(Unknown.Profile), /确认当前模型/);
	assert.equal(backend_capabilities(Unknown.Profile).Images, "unknown");
});

test("R02 manual confirmation is model/provider/endpoint bound; negative catalog and manual disable are explicit", () =>
{
	const Unknown = Profiles.select_api_model(BaseProfile(), "original-unknown", Catalog);
	const Confirmed = Profiles.select_api_model(Unknown.Profile, Unknown.Profile.Model, Catalog, "", { Vision: true, Protocol: "responses" });
	assert.equal(Confirmed.Images, true); assert.equal(Confirmed.Profile.Protocol, "responses");
	const OtherModel = Profiles.select_api_model(Confirmed.Profile, "other", []);
	assert.equal(OtherModel.Images, "unknown"); assert.equal(OtherModel.Profile.Protocol, "chat");
	for(const Change of [{ Provider: "compatible", Base: "https://other.invalid/v1" }, { Base: "https://other.invalid/v1", Provider: "compatible" }])
	{
		const Other = Profiles.backend_profile({ ...Confirmed.Profile, ...Change }) as Profiles.ApiProfile;
		assert.equal(Other.Vision, false); assert.equal(Other.Selection, undefined);
	}
	const Denied = Profiles.select_api_model(Confirmed.Profile, Confirmed.Profile.Model, [{ Id: Confirmed.Profile.Model, Vision: false }]);
	assert.equal(Denied.Images, false); assert.equal(Denied.Profile.Selection?.Vision.Manual, true);
	assert.match(Profiles.api_image_status(Denied.Profile), /不能覆盖/);
	const Disabled = Profiles.select_api_model(BaseProfile(), "original-image", Catalog, "", { Vision: false });
	assert.equal(Disabled.Images, false); assert.match(Profiles.api_image_status(Disabled.Profile), /禁用/);
	const Auto = Profiles.select_api_model(Confirmed.Profile, Confirmed.Profile.Model, undefined, "", { Protocol: "auto", Vision: "unknown" });
	assert.equal(Auto.Profile.Protocol, "chat"); assert.equal(Auto.Images, "unknown");
});

test("R02 catalog refresh and saved reconnection retain exactly bound evidence and endpoint credential isolation", () =>
{
	const Values = new Map<string, string>(), Storage = { getItem: (K: string) => Values.get(K) ?? null, setItem: (K: string, V: string) => { Values.set(K, V); } };
	const Store = new ConnectionProfiles(Storage, "r02-original"), Keys = new ConnectionCredentials();
	const Selected = Profiles.select_api_model(BaseProfile(), "original-image", Catalog, "high");
	Keys.set(Selected.Profile, "original-memory-only-key"); Store.save(Selected.Profile, "原创模型", Catalog);
	const Reload = new ConnectionProfiles(Storage, "r02-original").list()[0];
	assert.deepEqual(Reload.Profile, Selected.Profile);
	const NoDirectory = Profiles.select_api_model(Selected.Profile, Selected.Profile.Model);
	assert.equal(NoDirectory.Images, true);
	const Changed = Profiles.select_api_model(Selected.Profile, Selected.Profile.Model, [{ Id: Selected.Profile.Model, Vision: false, Protocol: "chat" }], "high");
	assert.equal(Changed.Images, false); assert.equal(Changed.Profile.Protocol, "chat"); assert.equal(Changed.Effort, "");
	const Removed = Profiles.select_api_model(Selected.Profile, Selected.Profile.Model, []);
	assert.equal(Removed.Images, "unknown"); assert.equal(Removed.Reasoning, undefined);
	assert.equal(Keys.get(Changed.Profile), "original-memory-only-key");
	const Endpoint = Profiles.backend_profile({ ...Changed.Profile, Provider: "compatible", Base: "https://new.invalid/v1" });
	assert.equal(Keys.get(Endpoint), ""); assert.equal(new ConnectionCredentials().get(Changed.Profile), "");
	assert.ok(![...Values.values()].join("").includes("original-memory-only-key"));
	assert.equal(Profiles.backend_identity(Selected.Profile), Profiles.backend_identity(Changed.Profile));
});

test("R02 legacy explicit routing and saved usage remain intact without fabricating image confirmation", () =>
{
	const Legacy = Profiles.backend_profile({ Kind: "api", Provider: "compatible", Base: "https://original.invalid/v1", Model: "original-legacy", Protocol: "responses", Vision: true }) as Profiles.ApiProfile;
	const Same = Profiles.select_api_model(Legacy, Legacy.Model);
	assert.equal(Same.Profile.Protocol, "responses"); assert.equal(Same.Profile.Selection?.Protocol.Source, "legacy");
	assert.equal(Same.Images, "unknown"); assert.deepEqual(Same.Profile.Selection?.Vision, {});
	const Other = Profiles.select_api_model(Legacy, "other", [{ Id: "other" }]);
	assert.equal(Other.Profile.Protocol, "chat"); assert.equal(Other.Images, "unknown");
	const Values = new Map<string, string>(), Storage = { getItem: (K: string) => Values.get(K) ?? null, setItem: (K: string, V: string) => { Values.set(K, V); } };
	new ConnectionProfiles(Storage, "r02-legacy").save(Legacy, "旧配置", [{ Id: Legacy.Model }]);
	const Saved = new ConnectionProfiles(Storage, "r02-legacy").list()[0].Profile as Profiles.ApiProfile;
	assert.equal(Saved.Vision, true); assert.equal(Saved.Protocol, "responses"); assert.equal(Saved.Selection, undefined);
	assert.deepEqual(backend_model_choices(Saved, [{ Id: Saved.Model }])[0].inputModalities, ["text", "image"]);
	const ByReasoning = Profiles.select_api_model(BaseProfile(), "original-inferred-route", [{ Id: "original-inferred-route", Reasoning: { Format: "responses", Efforts: ["high"] } }], "high");
	assert.equal(ByReasoning.Profile.Protocol, "responses"); assert.equal(ByReasoning.Effort, "high");
});

test("R02 Go catalog preserves explicit input modalities, including a text-only declaration", async () =>
{
	const Models = await list_api_models("opencode", "", "", async () => ({ status: 200, json: { data: [
		{ id: "original-image", modalities: { input: ["text", "image/jpeg"] }, limit: { context: 32768 } },
		{ id: "original-text", modalities: { input: ["text"] } },
		{ id: "original-unknown" }, { id: "original-invalid", modalities: { input: [] } }
	] } }));
	assert.equal(Models.find(M => M.Id === "original-image")?.Vision, true);
	assert.equal(Models.find(M => M.Id === "original-image")?.ContextWindow, 32768);
	assert.equal(Models.find(M => M.Id === "original-text")?.Vision, false);
	assert.equal(Models.find(M => M.Id === "original-unknown")?.Vision, undefined);
	assert.equal(Models.find(M => M.Id === "original-invalid")?.Vision, undefined);
});

// Exercise the original host method, not a rewritten copy of its selection logic.
function host_selection()
{
	const Source = readFileSync("src/main.ts", "utf8");
	const Start = Source.indexOf("\tasync update_run_settings("), End = Source.indexOf("\n\tprivate show_error", Start);
	assert.ok(Start >= 0 && End > Start);
	const Code = ts.transpile("class Host {" + Source.slice(Start, End) + "}\nHost;", { target: ts.ScriptTarget.ES2022 });
	return new Function(...Object.keys(Profiles), "return eval(" + JSON.stringify(Code) + ")")(...Object.values(Profiles)).prototype.update_run_settings;
}

for(const [Before, After] of [[true, false], [false, true]])
{
	test(`R02 original host switches image capability ${Before} -> ${After} without dropping draft materials`, async () =>
	{
		const Draft = { Text: "证明 $x=x$", Quote: { Text: "$x$" }, Images: ["original-jpeg"] };
		const Host: any = {
			Runtime: { BlocksInput: false }, State: { Settings: { Model: "one", Effort: "high" } },
			Backend: Profiles.backend_profile({ Kind: "api", Provider: "compatible", Base: "https://original.invalid/v1", Model: "one", Vision: Before, Protocol: "responses" }),
			BackendCatalog: [{ Id: "one", Vision: Before, Protocol: "responses" }, { Id: "two", Vision: After, Protocol: "chat" }],
			Models: [{ model: "two", supportedReasoningEfforts: [] }], Draft,
			async start_backend(Profile: unknown) { this.Backend = Profiles.backend_profile(Profile); this.State.Settings.Model = this.Backend.Model; },
			refresh() {}, async persist() {}
		};
		await host_selection().call(Host, "two", "high", false);
		assert.equal(Host.Backend.Model, "two");
		assert.equal(Host.Backend.Vision, After);
		assert.equal(Host.Backend.Protocol, "chat");
		assert.equal(Host.State.Settings.Effort, "");
		assert.equal(Host.Draft, Draft);
		assert.deepEqual(Draft.Images, ["original-jpeg"]);
	});
}

test("R02 explicit negative catalog evidence remains false rather than unknown", () =>
{
	const Profile = Profiles.backend_profile({ Kind: "api", Provider: "compatible", Base: "https://original.invalid/v1", Model: "text-only", Vision: false });
	const Selected = (Profiles as any).select_api_model?.(Profile, "text-only", [{ Id: "text-only", Vision: false }])?.Profile ?? Profile;
	assert.equal(backend_capabilities(Selected).Images, false);
});
