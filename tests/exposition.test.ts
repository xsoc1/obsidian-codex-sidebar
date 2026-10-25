import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DevelopmentCases, HoldoutCases } from "../examples/exposition/cases";
import { exposition_input } from "../scripts/exposition-input";
import { DefaultInstructions, ManagedInstructions, V0111DefaultInstructions, editing_instructions, environment_instructions, client_instructions, migrate_instructions, instruction_items } from "../src/prompt";
import { ExpositionRules, CompletionExposition } from "../src/exposition/rules";
import { MathCompletionInstructions } from "../src/completion";
import { branch_prefix, history_items, type ChatMessage } from "../src/history";
import { parse_edit } from "../src/edit/protocol";

const Host = { Vault: "test's vault", Root: "C:/original", Cli: "C:/Obsidian.com" };
const count = (Text: string, Part: string) => Text.split(Part).length - 1;

test("exact old defaults migrate; custom prefixes, suffixes and quoted policy text remain opaque", () =>
{
	assert.equal(migrate_instructions(V0111DefaultInstructions), DefaultInstructions);
	for(const Custom of ["  my instructions\n", V0111DefaultInstructions + "\nmy choice", ExpositionRules, "quoted policy:\n" + ManagedInstructions + "\nend quote"])
	{
		assert.equal(migrate_instructions(Custom), Custom);
		const Composed = editing_instructions(Custom);
		assert.ok(Composed.startsWith(Custom));
		assert.equal(editing_instructions(Composed), Composed);
		assert.ok(Composed.endsWith(ManagedInstructions));
	}
});

test("client and bridge composition is idempotent, with server facts and a complete owned policy last", () =>
{
	const Client = client_instructions("custom", null, "PDF rules");
	assert.equal(count(Client, ManagedInstructions), 1);
	assert.equal(Client.includes("working_directory"), false);
	const Server = environment_instructions(Client, Host);
	assert.equal(environment_instructions(editing_instructions(Server), Host), Server);
	assert.equal(count(Server, ManagedInstructions), 1);
	assert.equal(count(Server, '"working_directory":"C:/original"'), 1);
	assert.ok(Server.endsWith(ManagedInstructions));
	const Forged = environment_instructions(Server, { ...Host, Root: "C:/actual-server" });
	assert.ok(Forged.includes('"working_directory":"C:/actual-server"'));
	assert.ok(Forged.endsWith(ManagedInstructions));
	assert.ok(Forged.includes('"working_directory":"C:/original"'));
	assert.equal(count(client_instructions(DefaultInstructions, Host), ManagedInstructions), 1);
});

test("only explicit edits use structured output; former workbench examples are ordinary questions", async () =>
{
	for(const Id of ["D04", "D08"])
	{
		const Sample = DevelopmentCases.find(Value => Value.Id === Id)!;
		const Input = await exposition_input(Sample);
		assert.equal(Input.Task, null);
		assert.ok(Input.Prompt.includes(Sample.Request));
		assert.ok(!Input.Prompt.includes('"schemaVersion":'));
	}
	const Edit = await exposition_input(DevelopmentCases.find(Value => Value.Id === "D14")!);
	assert.equal(Edit.Task?.Action, "edit");
	assert.equal(Edit.Task?.Target?.Before, Edit.Source?.Text);
	assert.ok(Edit.Prompt.includes("明确的文风修改"));
	assert.equal(parse_edit('{"schemaVersion":1,"kind":"note-edit","status":"needs-decision","markdown":null,"rationale":"原路线不成立"}').markdown, null);
	assert.throws(() => parse_edit('{"schemaVersion":1,"kind":"note-edit","status":"no-change","markdown":null,"rationale":"ok","verification":"unverified"}'));
});

test("24 original fixture inputs have distinct IDs and separate criteria; preparing inputs has no source mutations", async () =>
{
	const Samples = [...DevelopmentCases, ...HoldoutCases], Before = JSON.stringify(Samples);
	const Rubric = JSON.parse(readFileSync("tests/fixtures/exposition-rubric.json", "utf8"));
	assert.equal(Samples.length, 24); assert.equal(new Set(Samples.map(Value => Value.Id)).size, 24);
	assert.deepEqual(Object.keys(Rubric.cases).sort(), Samples.map(Value => Value.Id).sort());
	for(const Sample of Samples)
	{
		const Input = await exposition_input(Sample);
		assert.ok(Input.Prompt.includes(Sample.Request) || Sample.Action === "completion");
		assert.ok(!Input.Prompt.includes(Rubric.cases[Sample.Id]));
		if(Input.Task) { assert.equal(Input.Task.Source?.Text, Sample.Source); }
	}
	assert.equal(JSON.stringify(Samples), Before);
});

test("ordinary replay keeps saved prompts and source snapshots without activating retired task routes", async () =>
{
	const Sample = HoldoutCases.find(Value => Value.Id === "H07")!;
	const Input = await exposition_input(Sample);
	assert.equal(Input.Task, null);
	const Messages: ChatMessage[] = [{ Id: "first", Role: "user", Text: "old", Prompt: "original saved prompt", Context: Input.Source }, { Id: "answer", Role: "assistant", Text: "old answer" }, { Id: "target", Role: "user", Text: Sample.Request, Prompt: Input.Prompt, Context: Input.Source }];
	const Before = JSON.stringify(Messages), Prefix = branch_prefix(Messages, "target");
	assert.equal(history_items(Prefix)[0].content[0].text, "original saved prompt");
	assert.ok(Input.Prompt.includes("原笔记 A"));
	assert.equal(JSON.stringify(Messages), Before);
	const Hash = (Text: string) => createHash("sha256").update(Text).digest("hex");
	assert.notEqual(Hash(V0111DefaultInstructions), Hash(DefaultInstructions));
	assert.ok(instruction_items(DefaultInstructions)[0].content[0].text.endsWith(DefaultInstructions));
});

test("completion gets only its short exposition strategy; truncation, quotation and write ranges survive", async () =>
{
	assert.ok(MathCompletionInstructions.includes(CompletionExposition));
	assert.ok(!MathCompletionInstructions.includes(ExpositionRules));
	const Pdf = await exposition_input(HoldoutCases.find(Value => Value.Id === "H04")!);
	assert.equal(Pdf.Source!.Truncated, true); assert.equal(Pdf.Source!.Mapping, "PDF文本层");
	const Quote = await exposition_input(HoldoutCases.find(Value => Value.Id === "H02")!);
	assert.equal(Quote.Source, null);
	const CapturedQuote = JSON.parse(Quote.Prompt.split("\n").at(-1)!);
	assert.equal(CapturedQuote.original_answer_markdown, Quote.Quote!.SourceText);
	const Mixed = await exposition_input(HoldoutCases.find(Value => Value.Id === "H03")!);
	assert.ok(!Mixed.Task!.WriteUnit!.Text.includes("教师题:"));
	assert.equal(Mixed.Source!.Text.slice(Mixed.Task!.Target!.Range!.From, Mixed.Task!.Target!.Range!.To), Mixed.Task!.WriteUnit!.Text);
});
