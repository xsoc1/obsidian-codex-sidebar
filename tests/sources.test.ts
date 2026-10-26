import { test } from "node:test";
import assert from "node:assert/strict";
import { source_reference, tool_read_reference, answer_sources, source_path, locate_source, rename_sources, validate_source_reference } from "../src/sources";
import { version_of } from "../src/edit/document";
import type { ContextSnapshot } from "../src/prompt";

const Context: ContextSnapshot = { Path: "A/Original.md", Text: "# Original\n\n原文唯一锚点.\n", SelectedText: "原文唯一锚点.", Heading: "Original", Mode: "编辑", Kind: "选区", Mapping: "源文本", CapturedAt: "original-time", LineStart: 2, LineEnd: 2, Truncated: false, Version: "a".repeat(64) };

test("answer source paths follow the producing turn and quote chain, never current focus or a neighbouring question", () =>
{
	const U = { Id: "u-a", Role: "user", TurnId: "a", Context }, A = { Id: "a-a", Role: "assistant", TurnId: "a" }, B = { Id: "u-b", Role: "user", TurnId: "b", Context: { ...Context, Path: "B/Other.md" } };
	assert.equal(source_path([U, A, B], A), "A/Original.md"); assert.equal(answer_sources([U, A, B], A)[0].CapturedAt, "original-time");
	assert.equal(source_path([U, A, B], { Id: "legacy", Role: "assistant" }), "");
	const Q = { Id: "q", Role: "user", TurnId: "c", Quote: { SessionId: "s", MessageId: "a-a", SelectedText: "x", SourceText: "$x$", SelectedTruncated: false, SourceTruncated: false, SourcePath: Context.Path, SourceReferences: source_reference(Context) } };
	assert.equal(source_path([Q], { Id: "reply", Role: "assistant", TurnId: "c" }), Context.Path);
});

test("only successful actual read pages enter the source index, with exact partial range and Windows host", () =>
{
	const Input = { command: "read", params: { path: "Definitions/Original.md" } }, Page = { text: "原定义", offset: 120, total_chars: 500, truncated: true, next_offset: 123, version: "b".repeat(64) }, Result = { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(Page) }] };
	const Ref = tool_read_reference(Input, Result, "windows-copy", "actual-read-time")!;
	assert.equal(Ref.Host, "windows-copy"); assert.deepEqual(Ref.Range, { From: 120, To: 123, Total: 500 }); assert.equal(Ref.Truncated, true);
	assert.equal(tool_read_reference({ ...Input, command: "search" }, Result), null); assert.equal(tool_read_reference(Input, { ...Result, success: false }), null);
	assert.equal(tool_read_reference(Input, { success: true, contentItems: [{ type: "inputText", text: "model claims to have read the file" }] }), null);
});

test("navigation distinguishes exact snapshots, changed unique anchors, rename observations and missing/same-name paths", async () =>
{
	const Text = "# Original\n\n原文唯一锚点.\n", Ref = source_reference({ ...Context, Version: await version_of(Text) })[0];
	let Current = Text, Path = "A/Original.md";
	const App: any = { vault: { getFileByPath: (P: string) => P === Path ? { path: P } : null, cachedRead: async () => Current }, metadataCache: { getFileCache: () => ({}) } };
	assert.equal((await locate_source(App, Ref)).Status, "exact");
	Current = "前文改变.\n" + Text; const Changed = await locate_source(App, Ref); assert.equal(Changed.Status, "changed"); assert.equal(Changed.Line, 3);
	Path = "B/Original.md"; await assert.rejects(locate_source(App, Ref), /不存在/);
	const Renamed = rename_sources([Ref], "A/Original.md", "B/Original.md")[0]; assert.equal(Renamed.Path, "A/Original.md"); assert.equal((await locate_source(App, Renamed)).Path, Path);
	await assert.rejects(locate_source(App, { ...Ref, PathExact: false }), /同名/);
});

test("selection and explanatory background remain distinct validated sources and malformed optional history is not guessed", () =>
{
	const Refs = source_reference({ ...Context, Selection: { From: 12, To: 19 }, Explanation: { Text: Context.Text, From: 0, To: Context.Text.length, LineStart: 0, LineEnd: 2, Closed: true, Truncated: false, Blocks: [], Missing: [] } });
	assert.deepEqual(Refs.map(Ref => Ref.Purpose), ["selection", "explanation"]); assert.deepEqual(Refs[0].Range, { From: 12, To: 19 });
	assert.deepEqual(Refs[1].Range, { From: 0, To: Context.Text.length }); Refs.forEach(Ref => validate_source_reference(Ref));
	assert.throws(() => validate_source_reference({ ...Refs[0], Path: "../Elsewhere.md" }), /路径/);
	assert.throws(() => validate_source_reference({ ...Refs[0], Purpose: "model-claimed-read" }), /用途/);
	const Original: any = { Id: "old", Role: "assistant", Sources: [{ ...Refs[0], arbitrary: "legacy-unknown" }] };
	assert.deepEqual(answer_sources([], Original), []); assert.equal(Original.Sources[0].arbitrary, "legacy-unknown");
	const Renamed = rename_sources(Refs, "A", "Moved"); assert.equal(Renamed[0].CurrentPath, "Moved/Original.md"); assert.equal(Renamed[0].Path, "A/Original.md");
	assert.equal(rename_sources([{ ...Refs[0], Path: "AB/Original.md" }], "A", "Moved")[0].CurrentPath, undefined);
});

test("observed cross-folder renames only change source navigation and cannot retarget historical relative links", () =>
{
	const Sources = rename_sources(source_reference(Context), "A/Original.md", "B/Original.md");
	const User = { Id: "u", Role: "user", TurnId: "turn", Context, Sources }, Answer = { Id: "a", Role: "assistant", TurnId: "turn", Text: "[同目录材料](./Definitions.md)" };
	assert.equal(source_path([User, Answer], Answer), "A/Original.md"); assert.equal(answer_sources([User, Answer], Answer)[0].CurrentPath, "B/Original.md");
	const Quote = { SessionId: "s", MessageId: "a", SelectedText: "材料", SourceText: Answer.Text, SourcePath: "A/Original.md", SourceReferences: Sources, SelectedTruncated: false, SourceTruncated: false };
	assert.equal(source_path([{ Id: "u2", Role: "user", TurnId: "next", Quote }], { Id: "a2", Role: "assistant", TurnId: "next" }), "A/Original.md");
});

test("source navigation checks unsaved editors and uses actual current anchor lines instead of stale metadata", async () =>
{
	const Text = "# Original\n\n原文唯一锚点.\n", Ref = source_reference({ ...Context, Version: await version_of(Text) })[0];
	let Editors = ["未落盘的新内容.\n" + Text];
	const App: any = { vault: { getFileByPath: () => ({ path: Ref.Path }), cachedRead: async () => Text }, workspace: { getLeavesOfType: () => Editors.map(Content => ({ view: { file: { path: Ref.Path }, getViewData: () => Content } })) }, metadataCache: { getFileCache: () => ({ headings: [{ heading: "Original", position: { start: { line: 0 } } }] }) } };
	const Changed = await locate_source(App, Ref); assert.equal(Changed.Status, "changed"); assert.equal(Changed.Line, 3);
	Editors.push("另一编辑器的不同内容."); const Conflict = await locate_source(App, Ref); assert.equal(Conflict.Status, "unknown"); assert.equal(Conflict.Line, undefined);
	Editors = ["前文.\n\n# Original\n\n改过的正文. ^original-block\n"];
	const Block = await locate_source(App, { ...Ref, Anchor: undefined, BlockId: "original-block" }); assert.equal(Block.Line, 4);
	const Heading = await locate_source(App, { ...Ref, Anchor: undefined }); assert.equal(Heading.Line, 2);
	Editors = [Editors[0] + "\n另一段. ^original-block\n\n# Original\n"];
	const Duplicate = await locate_source(App, { ...Ref, Anchor: undefined, BlockId: "original-block" }); assert.equal(Duplicate.Line, undefined);
});
