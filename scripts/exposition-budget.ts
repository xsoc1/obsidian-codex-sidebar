import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Shared by direct and bridge probes; an unknown outcome never frees a claim.
export function reserve_request(Directory: string, Key: string, Limit = 28): number
{
	const Path = join(Directory, "request-budget.json"), Lock = Path + ".lock";
	const Handle = openSync(Lock, "wx");
	try
	{
		let Claims: string[];
		if(existsSync(Path))
		{
			const Value = JSON.parse(readFileSync(Path, "utf8"));
			if(Value.schemaVersion !== 1 || !Array.isArray(Value.claims) || Value.claims.some((Item: unknown) => typeof Item !== "string")) { throw new Error("Invalid request budget; preserve it for inspection"); }
			Claims = Value.claims;
		}
		else
		{
			const Ledger = join(Directory, "request-ledger.json");
			Claims = existsSync(Ledger) ? JSON.parse(readFileSync(Ledger, "utf8")).map((Value: any) => `${Value.run ?? "initial"}/${Value.variant}/${Value.id}`) : [];
			if(existsSync(join(Directory, "remote-request.json"))) { Claims.push("remote/D03"); }
		}
		if(Claims.includes(Key)) { throw new Error("Request already reserved; inspect its outcome rather than resending"); }
		if(Claims.length >= Limit) { throw new Error("Combined direct/bridge request budget exhausted"); }
		Claims.push(Key);
		writeFileSync(Path + ".tmp", JSON.stringify({ schemaVersion: 1, claims: Claims }, null, 2), { flag: "wx" });
		renameSync(Path + ".tmp", Path);
		return Claims.length;
	}
	finally { closeSync(Handle); unlinkSync(Lock); }
}
