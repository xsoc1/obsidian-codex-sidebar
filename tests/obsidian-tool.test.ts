import { test } from "node:test";
import assert from "node:assert/strict";
import { cli_arguments } from "../src/obsidian-tool";

test("CLI bridge fixes the vault and passes metacharacters as literal arguments", () =>
{
	assert.deepEqual(cli_arguments("my vault", { command: "search", params: { query: "$(whoami); `test`", limit: 3, case: true } }), ["vault=my vault", "search", "query=$(whoami); `test`", "limit=3", "case"]);
	assert.deepEqual(cli_arguments("math", { command: "help", help_command: "read" }), ["vault=math", "help", "read"]);
});

test("CLI bridge rejects write commands, eval, vault overrides, outside paths and injected flags", () =>
{
	for(const Input of [{ command: "create" }, { command: "eval" }, { command: "read", params: { vault: "other" } }, { command: "read", params: { path: "../private.md" } }, { command: "read", params: { path: "C:/private.md" } }, { command: "help", help_command: "read --copy" }, { command: "search", params: { query: "x\ncreate" } }, { command: "version", extra: true }])
	{
		assert.throws(() => cli_arguments("math", Input));
	}
});
