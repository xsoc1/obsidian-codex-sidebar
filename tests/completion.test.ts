import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { SuggestionField, SetSuggestion, accept_suggestion } from "../src/inline";
import { completion_prompt, parse_completion } from "../src/completion";
import { DefaultInstructions, environment_instructions } from "../src/prompt";

test("suggestions cannot survive document edits or cursor moves and do not change source until acceptance", () =>
{
	const State = EditorState.create({ doc: "Let x", selection: { anchor: 5 }, extensions: [SuggestionField] });
	const Suggested = State.update({ effects: SetSuggestion.of({ Position: 5, Text: " be positive." }) }).state;
	assert.equal(Suggested.doc.toString(), "Let x");
	assert.equal(Suggested.field(SuggestionField)?.Text, " be positive.");
	assert.equal(Suggested.update({ selection: { anchor: 2 } }).state.field(SuggestionField), null);
	assert.equal(Suggested.update({ changes: { from: 5, insert: "=" } }).state.field(SuggestionField), null);
	assert.equal(State.update({ effects: SetSuggestion.of({ Position: 4, Text: "wrong position" }) }).state.field(SuggestionField), null);
});

test("sidebar confirmation inserts once without editor focus and refuses IME acceptance", () =>
{
	let State = EditorState.create({ doc: "abc", selection: { anchor: 3 }, extensions: [SuggestionField] });
	const View: any = { get state() { return State; }, hasFocus: false, composing: false, compositionStarted: false, dispatch: (Spec: any) => { State = State.update(Spec).state; } };
	assert.equal(accept_suggestion(View), false);
	State = State.update({ effects: SetSuggestion.of({ Position: 3, Text: "def\nghi" }) }).state;
	View.composing = true;
	assert.equal(accept_suggestion(View), false);
	View.composing = false;
	assert.equal(accept_suggestion(View), true);
	assert.equal(State.doc.toString(), "abcdef\nghi");
	assert.equal(accept_suggestion(View), false);
});

test("completion bounds source context and validates structured raw insertion text", () =>
{
	const Prompt = JSON.parse(completion_prompt({ Path: "note.md", Before: "a".repeat(10000), After: "b".repeat(4000) }));
	assert.equal(Prompt.before.length, 6000);
	assert.equal(Prompt.after.length, 2000);
	assert.equal(parse_completion('{"completion":"$x$\\r\\n"}'), "$x$\n");
	assert.throws(() => parse_completion("explanation"));
	assert.throws(() => parse_completion(JSON.stringify({ completion: "x".repeat(801) })));
});

test("work prompt describes the actual vault and supported CLI targeting", () =>
{
	const Prompt = environment_instructions(DefaultInstructions, { Vault: "test's vault", Root: "C:/vault", Cli: "C:/Obsidian.com" });
	assert.ok(Prompt.includes("'vault=test''s vault' help"));
	assert.ok(Prompt.includes('"working_directory":"C:/vault"'));
	assert.ok(Prompt.includes("AGENTS.override.md"));
	assert.ok(Prompt.includes("dev:errors"));
});
