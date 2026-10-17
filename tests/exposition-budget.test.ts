import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reserve_request } from "../scripts/exposition-budget";

test("evaluation shares a hard budget across old direct and remote receipts, locks claims and refuses implicit retries", () =>
{
	const Directory = mkdtempSync(join(tmpdir(), "codex-exposition-budget-"));
	try
	{
		writeFileSync(join(Directory, "request-ledger.json"), JSON.stringify([{ variant: "baseline", id: "D02" }, { run: "final", variant: "candidate", id: "H01" }]));
		writeFileSync(join(Directory, "remote-request.json"), '{"status":"completed"}');
		assert.equal(reserve_request(Directory, "new/candidate/D04", 4), 4);
		const Before = readFileSync(join(Directory, "request-budget.json"), "utf8");
		assert.throws(() => reserve_request(Directory, "new/candidate/D04", 4), /already reserved/);
		assert.throws(() => reserve_request(Directory, "another", 4), /exhausted/);
		assert.equal(readFileSync(join(Directory, "request-budget.json"), "utf8"), Before);
		writeFileSync(join(Directory, "request-budget.json.lock"), "active lock");
		assert.throws(() => reserve_request(Directory, "other"), /EEXIST/);
		assert.ok(existsSync(join(Directory, "request-budget.json.lock")));
	}
	finally
	{
		for(const Name of readdirSync(Directory)) { unlinkSync(join(Directory, Name)); }
		rmdirSync(Directory);
	}
});
