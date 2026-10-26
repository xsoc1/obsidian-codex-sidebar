import { test } from "node:test";
import assert from "node:assert/strict";
import { cli_arguments } from "../src/obsidian-tool";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";

function reader(Text: string, ErrorValue: Error | null = null)
{
	const Module = { exports: {} as any }, Calls: any[] = [];
	const Code = buildSync({ entryPoints: ["src/obsidian-tool.ts"], bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
	runInNewContext(Code, { module: Module, exports: Module.exports, require: (Name: string) => Name === "node:crypto" ? { createHash } : ({ execFile: (...Args: any[]) => { Calls.push(Args.slice(0, 3)); Args[3](ErrorValue, Text, ""); } }) });
	return { run: async (Input: any) => Module.exports.run_obsidian_read("fixture-cli", "fixture-vault", Input), Calls };
}

test("a zero-exit CLI file error is a failed tool result, not successful source content", async () =>
{
	const F = reader('Error: File "missing.md" not found.\n'), Result = await F.run({ command: "read", params: { path: "missing.md" } });
	assert.equal(Result.success, false); assert.match(Result.contentItems[0].text, /not found/);
});

test("whole-vault note reads have bounded resumable pages, including a single long formula line", async () =>
{
	const Original = "# Original\n" + "$x=" + "a".repeat(75000) + "$\n末尾定义", F = reader(Original);
	let Offset = 0, Restored = "", Version: string | undefined;
	do
	{
		const Result = await F.run({ command: "read", params: { path: "another-folder/Original.md", offset: Offset, length: 12000, ...(Version ? { version: Version } : {}) } });
		assert.equal(Result.success, true); const Page = JSON.parse(Result.contentItems[0].text);
		assert.equal(Page.offset, Offset); assert.equal(Page.total_chars, Original.length); assert.ok(Page.text.length <= 12000);
		Restored += Page.text; Offset = Page.next_offset; Version = Page.version;
	} while(Offset !== null);
	assert.equal(Restored, Original); assert.ok(F.Calls.every(Call => Call[1].join("|") === "vault=fixture-vault|read|path=another-folder/Original.md"));
	for(const Params of [{ offset: -1 }, { offset: "1" }, { length: 0 }, { length: 65000 }]) { await assert.rejects(F.run({ command: "read", params: { path: "Original.md", ...Params } })); }
});

test("changed read pages refuse mixed versions, and ordinary note text is not misread as a CLI error", async () =>
{
	const F = reader("Error: this is original note text."); assert.equal((await F.run({ command: "read", params: { path: "Original.md" } })).success, true);
	const Changed = await F.run({ command: "read", params: { path: "Original.md", offset: 2, version: "f".repeat(64) } }); assert.equal(Changed.success, false); assert.match(Changed.contentItems[0].text, /分页读取期间已变化/);
	for(const Path of [".obsidian/plugins/data.json", "folder/.git/config", ".codex/auth.json"]) { await assert.rejects(F.run({ command: "read", params: { path: Path } }), /隐藏配置/); }
});

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
