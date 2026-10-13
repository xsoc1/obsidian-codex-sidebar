import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto, randomUUID } from "node:crypto";

async function mobile_fixture(Http?: (Params: any) => Promise<any>)
{
	const Required: string[] = []; const Files = new Map<string, string>(); const Local = new Map<string, string>();
	class Component { }
	class Plugin
	{
		manifest = { id: "codex-sidebar", dir: ".obsidian/plugins/codex-sidebar" };
		app = {
			vault: {
				getName: () => "test", adapter: {
					exists: async (Path: string) => Files.has(Path), read: async (Path: string) => Files.get(Path), write: async (Path: string, Text: string) =>
					{
						Files.set(Path, Text);
					}
				}
			},
			workspace: {
				on: () =>
				{
				}, onLayoutReady: () =>
				{
				}, getLeavesOfType: () => [], getActiveFile: () => null
			}
		};
		addStatusBarItem()
		{
			return {
				setText()
				{
				}
			};
		}
		registerEditorExtension()
		{
		} registerView()
		{
		} addCommand()
		{
		} addSettingTab()
		{
		} registerMarkdownPostProcessor()
		{
		} registerEvent()
		{
		}
		addRibbonIcon()
		{
			return {
				addClass()
				{
				}, toggleClass()
				{
				}
			};
		}
		loadData()
		{
			throw new Error("desktop data must stay isolated");
		}
	}
	const Export = { exports: {} as any };
	const Define = () => ({});
	runInNewContext(readFileSync(process.env.CODEX_SIDEBAR_TEST_BUNDLE ?? "main.js", "utf8"), {
		module: Export, exports: Export.exports, crypto: { subtle: webcrypto.subtle, randomUUID }, URL, Error, AbortController, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
		fetch: async (Url: string, Params: any) =>
		{
			const Response = await Http?.({ ...Params, url: Url });
			return { status: Response.status, json: async () => Response.json };
		},
		localStorage: { getItem: (Key: string) => Local.get(Key), setItem: (Key: string, Value: string) => Local.set(Key, Value) },
		require(Name: string)
		{
			Required.push(Name);
			if(Name === "obsidian")
			{
				return { Plugin, ItemView: Component, PluginSettingTab: Component, Modal: Component, MarkdownView: Component, Notice: Component, Platform: { isMobileApp: true }, requestUrl: Http };
			}
			if(Name === "@codemirror/state")
			{
				return { StateEffect: { define: Define }, StateField: { define: Define }, Prec: { highest: Define } };
			}
			if(Name === "@codemirror/view")
			{
				return { WidgetType: Component, keymap: { of: Define }, ViewPlugin: { fromClass: Define } };
			}
			throw new Error("mobile loaded forbidden module: " + Name);
		}
	});
	const Instance = new Export.exports.default(); await Instance.onload();
	return { Instance, Files, Required };
}

function bootstrap_http(Before?: (Params: any) => Promise<void>)
{
	return async (Params: any) =>
	{
		await Before?.(Params);
		const Path = new URL(Params.url).pathname;
		const Body = Params.body ? JSON.parse(Params.body) : null;
		let Value: any = {};
		if(Path === "/info")
		{
			Value = { server: "test", vault: "test", cwd: "/vault", cli: "mock" };
		}
		else if(Path === "/state")
		{
			Value = { state: null, cursor: 0 };
		}
		else if(Path === "/events")
		{
			Value = { events: [], cursor: 0 };
		}
		else if(Body?.method === "account/read")
		{
			Value = { account: { type: "chatgpt" } };
		}
		else if(Body?.method === "model/list")
		{
			Value = { data: [{ model: "test-model", displayName: "Test", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }], nextCursor: null };
		}
		else if(Body?.method === "skills/list")
		{
			Value = { data: [{ cwd: "/vault", skills: [{ name: "math-writing", path: "/skills/SKILL.md", enabled: true }] }] };
		}
		else if(Body?.method === "thread/start")
		{
			Value = { model: "test-model", reasoningEffort: "low", thread: { id: "fixture-thread", ephemeral: true, path: null, turns: [] } };
		}
		else if(Body?.method === "turn/start")
		{
			Value = { turn: { id: "fixture-turn" } };
		}
		return { status: 200, json: Value };
	};
}

test("built mobile entry loads and initializes without Node, Electron or desktop adapter calls", async () =>
{
	const { Instance, Files, Required } = await mobile_fixture();
	assert.equal(Instance.Remote.Enabled, true);
	assert.equal(Instance.State.Sessions.length, 1);
	assert.ok(Required.every(Name => ["obsidian", "@codemirror/state", "@codemirror/view"].includes(Name)));
	await Instance.persist(); assert.equal(Files.size, 1);
});

test("mobile bootstrap displays received models while the following state save is pending", async () =>
{
	let Release: () => void = () => {};
	let Reached: () => void = () => {};
	const Pending = new Promise<void>(Resolve => { Release = Resolve; });
	const Saving = new Promise<void>(Resolve => { Reached = Resolve; });
	const { Instance } = await mobile_fixture(bootstrap_http());
	const Write = Instance.app.vault.adapter.write;
	Instance.app.vault.adapter.write = async (Path: string, Text: string) =>
	{
		if(JSON.parse(Text).Settings.Model === "test-model")
		{
			Reached(); await Pending;
		}
		await Write(Path, Text);
	};
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	let RenderedModels = 0;
	Instance.refresh = () => { RenderedModels = Instance.Models.length; };
	const Work = Instance.ensure_connection();
	try
	{
		await Saving;
		assert.equal(Instance.Models.length, 1);
		assert.equal(RenderedModels, 1);
	}
	finally
	{
		Release(); await Work; Instance.Connection?.close();
	}
});

test("changing remote connection does not wait for an unresponsive old state sync", async () =>
{
	let Block = false;
	let Release: () => void = () => {};
	let Reached: () => void = () => {};
	const Pending = new Promise<void>(Resolve => { Release = Resolve; });
	const Saving = new Promise<void>(Resolve => { Reached = Resolve; });
	const { Instance, Files } = await mobile_fixture(bootstrap_http(async Params =>
	{
		if(Block && new URL(Params.url).pathname === "/state" && Params.method === "POST")
		{
			Reached(); await Pending;
		}
	}));
	Instance.Remote.Url = "https://old.test"; Instance.Remote.Token = "fixture";
	await Instance.ensure_connection();
	Instance.ensure_thread = async () => {};
	const OldPath = [...Files.keys()][0];
	Block = true;
	const Syncing = Instance.persist(); await Saving;
	let Reconfigured = false;
	const Configuring = Instance.configure_remote("https://new.test", "fixture").then(() => { Reconfigured = true; });
	try
	{
		await new Promise<void>(Resolve => setImmediate(Resolve));
		assert.equal(Reconfigured, true);
		assert.equal(Instance.Remote.Url, "https://new.test");
		assert.ok(Files.has(OldPath));
		assert.equal(Files.size, 2);
	}
	finally
	{
		Release(); await Syncing; await Configuring; Instance.Connection?.close();
	}
});

test("mobile network errors identify the failed operation without including credentials or body", async () =>
{
	const { Instance } = await mobile_fixture(async () => { throw new Error("请求超时"); });
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "private-fixture-token";
	await assert.rejects(Instance.remote_http("/rpc", "POST", { method: "model/list", params: { private: "private-fixture-body" } }), ErrorValue =>
	{
		const Message = (ErrorValue as Error).message;
		assert.match(Message, /远程 POST model\/list: 请求超时/);
		assert.ok(!Message.includes(Instance.Remote.Token));
		assert.ok(!Message.includes("private-fixture-body"));
		return true;
	});
});

test("a pending session state upload reports its preparation stage before any turn is submitted", async () =>
{
	let Release: () => void = () => {};
	let Reached: () => void = () => {};
	const Pending = new Promise<void>(Resolve => { Release = Resolve; });
	const Saving = new Promise<void>(Resolve => { Reached = Resolve; });
	const Operations: string[] = [];
	const { Instance } = await mobile_fixture(bootstrap_http(async Params =>
	{
		if(Params.body?.includes('"method"')) Operations.push(JSON.parse(Params.body).method);
		if(new URL(Params.url).pathname === "/state" && Params.method === "POST")
		{
			Reached(); await Pending;
		}
	}));
	Instance.Remote.Url = "https://example.test"; Instance.Remote.Token = "fixture";
	await Instance.ensure_connection();
	const Sending = Instance.send_message("fixture question", null);
	try
	{
		await Saving;
		assert.equal(Instance.Activity, "保存会话");
		assert.ok(!Operations.includes("turn/start"));
	}
	finally
	{
		Release(); await Sending; Instance.Connection?.close();
	}
});
