import { test } from "node:test";
import assert from "node:assert/strict";
import { discover_app_codex, resolve_codex_executable } from "../src/launch";

test("a stale app cache resolves only to a complete sibling runtime, without changing an explicit complete CLI", () =>
{
	const Root = "C:/Original/AppData/Local/OpenAI/Codex/bin", Old = Root + "/1111111111111111/codex.exe", New = Root + "/2222222222222222/codex.exe";
	const Host = { exists: (Path: string) => Path.replace(/\\/g, "/").includes("2222222222222222"), folders: () => ["1111111111111111", "2222222222222222", "../outside", "authentication"], modified: () => 1 };
	assert.equal(resolve_codex_executable(Old, Host).replace(/\\/g, "/"), New); assert.equal(resolve_codex_executable(New, Host), New);
	assert.throws(() => resolve_codex_executable(Old, { ...Host, exists: () => false }), /运行包不完整/);
	const Forbidden = { exists: () => { throw Error("Must not inspect unrelated paths"); }, folders: () => [], modified: () => 0 };
	for(const Cli of ["codex.exe", "C:/Original/portable/codex.exe", "/usr/bin/codex"]) { assert.equal(resolve_codex_executable(Cli, Forbidden), Cli); }
});

test("one-click discovery can use the newest complete application cache without PATH", () =>
{
	const Local = "C:/Windows-user/AppData/Local";
	const Root = Local + "/OpenAI/Codex/bin";
	const Host = {
		folders: (Path: string) => { assert.equal(Path.replace(/\\/g, "/"), Root); return ["1111111111111111", "2222222222222222", "3333333333333333", "../other"]; },
		exists: (Path: string) => !Path.includes("3333333333333333") || Path.endsWith("/codex.exe") || Path.endsWith("\\codex.exe"),
		modified: (Path: string) => Path.includes("2222222222222222") ? 2 : 1
	};
	assert.equal(discover_app_codex(Local, Host)?.replace(/\\/g, "/"), Root + "/2222222222222222/codex.exe");
	assert.equal(discover_app_codex(undefined, Host), undefined);
	assert.equal(discover_app_codex(Local, { ...Host, exists: () => false }), undefined);
});
