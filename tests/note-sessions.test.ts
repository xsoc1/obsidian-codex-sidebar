import { test } from "node:test";
import assert from "node:assert/strict";
import { NoteSessions, note_file_path } from "../src/note-sessions";

function fixture(Local = new Map<string, string>(), Scope = "desktop")
{
	const Sessions = new Set(["old-general"]), Activated: string[] = []; let Active = "old-general", Blocked = "";
	const Router = new NoteSessions({ getItem: Key => Local.get(Key) ?? null, setItem: (Key, Value) => Local.set(Key, Value) }, "test", Scope, { active: () => Active, exists: Id => Sessions.has(Id), blocked: () => Blocked, activate: async (Id, Path) => { Sessions.add(Id); Active = Id; Activated.push(Path); }, changed: () => {} });
	return { Router, Local, Sessions, Activated, active: () => Active, block: (Reason: string) => Blocked = Reason };
}

test("note detection ignores sidebar/settings focus and unsafe paths while accepting reading/editing Markdown and PDF", () =>
{
	assert.equal(note_file_path({ getViewType: () => "markdown", file: { path: "course/A.md" } }), "course/A.md");
	assert.equal(note_file_path({ getViewType: () => "pdf", file: { path: "course/book.pdf" } }), "course/book.pdf");
	for(const Type of ["codex-sidebar-view", "empty", "canvas"]) { assert.equal(note_file_path({ getViewType: () => Type, file: { path: "A.md" } }), null); }
	for(const Path of ["../A.md", "/A.md", "C:/A.md", ".obsidian/config.md"]) { assert.equal(note_file_path({ getViewType: () => "markdown", file: { path: Path } }), null); }
});

test("default on preserves old chats, gives one stable session per note and ignores duplicate or sidebar observations", async () =>
{
	const F = fixture(), R = F.Router; assert.equal(R.Data.Enabled, true); assert.equal(F.Local.size, 0);
	R.observe("A.md"); await R.flush(); const A = F.active(); assert.notEqual(A, "old-general"); R.observe("A.md"); R.observe(null); await R.flush(); assert.equal(F.Activated.length, 1);
	R.observe("B.md"); await R.flush(); const B = F.active(); assert.notEqual(A, B);
	R.observe("A.md"); await R.flush(); assert.equal(F.active(), A); assert.equal(F.Sessions.size, 3); assert.ok(F.Sessions.has("old-general"));
	const Restart = fixture(F.Local); for(const Id of F.Sessions) { Restart.Sessions.add(Id); } Restart.Router.observe("B.md"); await Restart.Router.flush(); assert.equal(Restart.active(), B);
});

test("an explicit disabled choice survives restart and re-enabling reuses the existing associations", async () =>
{
	const F = fixture(), R = F.Router; R.observe("A.md"); await R.flush(); const A = F.active();
	R.set_enabled(false); const Restart = fixture(F.Local); for(const Id of F.Sessions) { Restart.Sessions.add(Id); }
	assert.equal(Restart.Router.Data.Enabled, false); Restart.Router.observe("A.md"); await Restart.Router.flush(); assert.equal(Restart.active(), "old-general");
	Restart.Router.observe("B.md"); await Restart.Router.flush(); assert.equal(Restart.Sessions.size, 2); assert.equal(Restart.Router.Data.Links.length, 1);
	Restart.Router.observe("A.md"); Restart.Router.set_enabled(true); await Restart.Router.flush(); assert.equal(Restart.active(), A); assert.equal(Restart.Sessions.size, 2);
});

test("busy turns and drafts defer to the latest note; disabling or manual history selection cancels pending automatic switching", async () =>
{
	const F = fixture(), R = F.Router; R.set_enabled(true); F.block("正在回复"); R.observe("A.md"); await R.flush(); R.observe("B.md"); await R.flush();
	assert.equal(F.Activated.length, 0); assert.equal(R.Pending, "B.md"); F.block(""); await R.flush(); assert.deepEqual(F.Activated, ["B.md"]);
	F.block("有草稿"); R.observe("C.md"); await R.flush(); assert.equal(R.Reason, "有草稿"); R.set_enabled(false); F.block(""); await R.flush(); assert.equal(F.Activated.length, 1);
	R.set_enabled(true); R.manual(); await R.flush(); assert.equal(F.Activated.length, 1); R.observe("A.md"); await R.flush(); assert.equal(F.Activated.at(-1), "A.md");
});

test("renames move only associations, deletions preserve chats, and local/remote device scopes never share mappings", async () =>
{
	const F = fixture(), R = F.Router; R.set_enabled(true); R.observe("A.md"); await R.flush(); const Id = F.active(); R.rename("A.md", "Moved.md"); R.observe("Moved.md"); await R.flush();
	assert.equal(F.active(), Id); assert.equal(F.Sessions.size, 2); assert.equal(R.Data.Links[0].Path, "Moved.md");
	const Remote = fixture(F.Local, "remote:device-fixture"); assert.equal(Remote.Router.Data.Enabled, true); assert.equal(Remote.Router.Data.Links.length, 0);
	R.forget("Moved.md"); assert.equal(R.Data.Links.length, 0); assert.ok(F.Sessions.has(Id));
});

test("unknown metadata/storage failures preserve raw data and do not activate or delete chats", () =>
{
	const Raw = JSON.stringify({ schemaVersion: 9, Enabled: true, Links: [] }), Local = new Map([["codex-sidebar-note-sessions:v1:test:desktop", Raw]]);
	assert.throws(() => fixture(Local), /版本/); assert.equal(Local.values().next().value, Raw);
	const R = new NoteSessions({ getItem: () => null, setItem: () => { throw Error("storage full"); } }, "test", "desktop", { active: () => "old", exists: () => true, blocked: () => "", activate: async () => { throw Error("must not activate"); }, changed: () => {} });
	assert.throws(() => R.set_enabled(false), /storage full/); assert.equal(R.Data.Enabled, true);
});

test("queued rapid navigation or disabling cannot activate an obsolete note, and explicit rebinding never shares one chat between notes", async () =>
{
	const F = fixture(), R = F.Router; R.set_enabled(true); R.observe("A.md"); const First = R.flush(); R.observe("B.md"); await First; await R.flush();
	assert.deepEqual(F.Activated, ["B.md"]); const B = F.active(); R.observe("C.md"); const Pending = R.flush(); R.set_enabled(false); await Pending;
	assert.deepEqual(F.Activated, ["B.md"]); R.bind_current(); assert.equal(R.Data.Links.length, 1); assert.deepEqual(R.Data.Links[0], { Path: "C.md", SessionId: B });
});

test("rename association conflicts remain visible and never silently select the destination's unrelated history", async () =>
{
	const F = fixture(), R = F.Router; R.set_enabled(true); R.observe("A.md"); await R.flush(); const A = F.active(); R.observe("B.md"); await R.flush(); R.observe("A.md"); await R.flush();
	R.rename("A.md", "B.md"); R.observe("B.md"); await R.flush(); assert.equal(F.active(), A); assert.match(R.Error, /已有会话/); assert.equal(R.Manual, true);
	R.bind_current(); assert.equal(R.Error, ""); assert.equal(R.Data.Links.length, 1); assert.equal(R.Data.Links[0].SessionId, A);
});

test("renaming before queued activation follows the new path without creating an orphan conversation", async () =>
{
	const F = fixture(), R = F.Router; R.set_enabled(true); R.observe("A.md"); const First = R.flush(); R.rename("A.md", "Renamed.md"); await First; await R.flush();
	assert.deepEqual(F.Activated, ["Renamed.md"]); assert.equal(F.Sessions.size, 2); assert.equal(R.Data.Links[0].Path, "Renamed.md");
});

test("deleting a bound conversation removes its links and binds only a valid fresh replacement to the current note", async () =>
{
	const F = fixture(), R = F.Router; R.observe("A.md"); await R.flush(); const Old = F.active();
	F.Sessions.add("replacement"); R.forget_session(Old, "replacement");
	assert.deepEqual(R.Data.Links, [{ Path: "A.md", SessionId: "replacement" }]);
	R.observe("B.md"); await R.flush(); R.observe("A.md"); await R.flush(); assert.equal(F.active(), "replacement");
	R.forget_session("replacement"); assert.ok(!R.Data.Links.some(Link => Link.SessionId === "replacement"));
	R.observe("B.md"); await R.flush(); R.observe("A.md"); await R.flush(); assert.notEqual(F.active(), Old); assert.notEqual(F.active(), "replacement");
});

test("a note change during deletion cannot bind the replacement to the wrong note", async () =>
{
	const F = fixture(), R = F.Router; R.observe("A.md"); await R.flush(); const Old = F.active();
	F.Sessions.add("replacement"); R.observe("B.md"); R.forget_session(Old, "replacement", "A.md");
	assert.deepEqual(R.Data.Links, [{ Path: "A.md", SessionId: "replacement" }]); assert.equal(R.Pending, "B.md");
	await R.flush(); assert.notEqual(F.active(), "replacement");
	R.observe("A.md"); await R.flush(); assert.equal(F.active(), "replacement");
});
