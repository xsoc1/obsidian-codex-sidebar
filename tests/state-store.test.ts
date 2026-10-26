import { test } from "node:test";
import assert from "node:assert/strict";
import { load_state_file, write_state_file } from "../src/runtime/state-store";

function fixture()
{
	const State = { Settings: { Original: "choice" }, Sessions: [{ Id: "original", Messages: [{ Id: "m1", Role: "user", Text: "$x=1$", Prompt: "original prompt", Context: { Text: "$x=1$" } }] }], ActiveId: "original", CustomFuture: { keep: true } };
	const Raw = JSON.stringify(State, null, 2), Values = new Map([["legacy.json", Raw]]); let FailAt = "";
	const Host = { exists: async (P: string) => Values.has(P), read: async (P: string) => Values.get(P)!, write: async (P: string, T: string) => { if(P === FailAt) { throw Error("Original storage failure"); } Values.set(P, T); } };
	return { State, Raw, Values, Host, fail: (Path: string) => { FailAt = Path; } };
}
test("local schema migration backs up actual legacy bytes, validates readback and leaves legacy identity untouched", async () =>
{
	const F = fixture(), Result = await load_state_file(F.Host, "v2.json", "legacy.json");
	assert.deepEqual(Result, { ...F.State, SchemaVersion: 2 }); assert.equal(F.Values.get("legacy.json"), F.Raw);
	assert.equal([...F.Values].find(([K]) => K.startsWith("legacy.json.pre-v2-"))?.[1], F.Raw);
	assert.deepEqual(await load_state_file(F.Host, "v2.json", "legacy.json"), Result);
});
test("interrupted migration resumes from validated staged data and refuses concurrent legacy changes", async () =>
{
	const F = fixture(); F.fail("v2.json"); await assert.rejects(load_state_file(F.Host, "v2.json", "legacy.json"), /storage failure/);
	assert.equal(F.Values.get("legacy.json"), F.Raw); F.fail("");
	const New = await load_state_file(F.Host, "v2.json", "legacy.json"); assert.equal(New.SchemaVersion, 2);
	const G = fixture(); G.fail("v2.json"); await assert.rejects(load_state_file(G.Host, "v2.json", "legacy.json")); G.fail("");
	G.Values.set("legacy.json", JSON.stringify({ ...G.State, ActiveId: "user-changed" }));
	await assert.rejects(load_state_file(G.Host, "v2.json", "legacy.json"), /发生变化/); assert.equal(G.Values.has("v2.json"), false);
});

test("partial canonical migration resumes only a pending, hash-validated target", async () =>
{
	const F = fixture(), Write = F.Host.write; let Partial = true;
	F.Host.write = async (Path, Text) => { if(Path === "v2.json" && Partial) { F.Values.set(Path, Text.slice(0, 37)); throw Error("Original partial write"); } return Write(Path, Text); };
	await assert.rejects(load_state_file(F.Host, "v2.json", "legacy.json"), /partial/); Partial = false;
	const Restored = await load_state_file(F.Host, "v2.json", "legacy.json"); assert.equal(Restored.Sessions[0].Messages[0].Id, "m1"); assert.equal(JSON.parse(F.Values.get("v2.json.migration.json")!).Status, "committed");
});

test("normal save recovers a pending partial write and never restores the initial migration over later messages", async () =>
{
	const F = fixture(), State = await load_state_file(F.Host, "v2.json", "legacy.json"), Write = F.Host.write;
	State.Sessions[0].Messages.push({ Id: "m2", Role: "user", Text: "Original later message" }); let Partial = true;
	F.Host.write = async (Path, Text) => { if(Path === "v2.json" && Partial) { F.Values.set(Path, Text.slice(0, 53)); throw Error("Original interrupted save"); } return Write(Path, Text); };
	await assert.rejects(write_state_file(F.Host, "v2.json", State), /interrupted/); Partial = false;
	const Recovered = await load_state_file(F.Host, "v2.json", "legacy.json"); assert.equal(Recovered.Sessions[0].Messages.length, 2);
	assert.equal(JSON.parse(F.Values.get("v2.json.last-committed.json")!).Sessions[0].Messages.length, 2);
	F.Values.set("v2.json", "{corrupted after commit");
	await assert.rejects(load_state_file(F.Host, "v2.json", "legacy.json")); assert.equal(F.Values.get("v2.json"), "{corrupted after commit"); assert.equal(F.Values.get("legacy.json"), F.Raw);
});

test("a valid concurrent file change is retained instead of overwritten by an older window", async () =>
{
	const F = fixture(), State = await load_state_file(F.Host, "v2.json", "legacy.json"), Other = structuredClone(State);
	Other.Sessions[0].Messages.push({ Id: "other-window", Role: "user", Text: "Original concurrent content" }); F.Values.set("v2.json", JSON.stringify(Other));
	await assert.rejects(write_state_file(F.Host, "v2.json", State), /其他窗口/); assert.equal(JSON.parse(F.Values.get("v2.json")!).Sessions[0].Messages.length, 2);
	await assert.rejects(async () => write_state_file(F.Host, "v2.json", { ...State, SchemaVersion: 99 }), /版本/);
});
