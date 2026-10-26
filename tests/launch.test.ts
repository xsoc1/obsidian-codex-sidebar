import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve_codex_executable } from "../src/launch";

test("a stale app cache resolves only to a complete sibling runtime, without changing an explicit complete CLI", () =>
{
	const Root = "C:/Original/AppData/Local/OpenAI/Codex/bin", Old = Root + "/1111111111111111/codex.exe", New = Root + "/2222222222222222/codex.exe";
	const Host = { exists: (Path: string) => Path.replace(/\\/g, "/").includes("2222222222222222"), folders: () => ["1111111111111111", "2222222222222222", "../outside", "authentication"], modified: () => 1 };
	assert.equal(resolve_codex_executable(Old, Host).replace(/\\/g, "/"), New); assert.equal(resolve_codex_executable(New, Host), New);
	assert.throws(() => resolve_codex_executable(Old, { ...Host, exists: () => false }), /运行包不完整/);
	const Forbidden = { exists: () => { throw Error("Must not inspect unrelated paths"); }, folders: () => [], modified: () => 0 };
	for(const Cli of ["codex.exe", "C:/Original/portable/codex.exe", "/usr/bin/codex"]) { assert.equal(resolve_codex_executable(Cli, Forbidden), Cli); }
});
