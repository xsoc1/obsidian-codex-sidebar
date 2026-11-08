import { test } from "node:test";
import assert from "node:assert/strict";
import { render_input_ledger } from "../src/input-ledger-view";
import { plan_history_input } from "../src/history-budget";
import type { ChatMessage } from "../src/history";
import { capture_history_ledger, record_history_read, HistoryLedgerLimits } from "../src/history-ledger";
import { read_history_page } from "../src/history-reader";
class Element
{
	children: Element[] = [];
	textContent = "";
	open = false;
	dataset: Record<string, string> = {};
	Action?: () => void;
	constructor(readonly Tag = "div") {}
	createEl(Tag: string, Options: any = {}): any { const E = new Element(Tag); E.textContent = Options.text ?? ""; this.children.push(E); return E; }
	createDiv(Options?: any): any { return this.createEl("div", Options); }
	addEventListener(_Name: string, Action: () => void) { this.Action = Action; }
	all_text(): string { return this.textContent + this.children.map(E => E.all_text()).join("\n"); }
	find_buttons(): Element[] { return [...(this.Tag === "button" ? [this] : []), ...this.children.flatMap(E => E.find_buttons())]; }
}
test("R07 readable material names are distinct from IDs and deferred bodies are not called provided", () =>
{
	const Messages: ChatMessage[] = [{ Id: "q-alpha", Role: "user", Text: "证明引理 A 的一致有界性", TurnId: "t1" }, { Id: "a-alpha", Role: "assistant", Text: "# 引理 A 的证明\n\n" + "完整长证明 ".repeat(10000), TurnId: "t1", CompletionStatus: "partial" }];
	const Plan = plan_history_input(Messages, { MaxUtf8Bytes: 24000, RequiredMessageIds: ["a-alpha"], HistoryReadAvailable: true, HistoryReadBodyVersionsAvailable: true });
	const Root = new Element();
	(render_input_ledger as any)(Root, Plan.Ledger, { Messages, Identity: { Scope: "fixture", SessionId: "s", OperationId: "op" } });
	assert.match(Root.all_text(), /证明引理 A 的一致有界性/);
	assert.match(Root.all_text(), /引理 A 的证明/);
	assert.match(Root.all_text(), /只提供补读定位/);
	assert.match(Root.all_text(), /原回答.*部分/);
	assert.match(Root.all_text(), /实际补读.*未知/);
});

test("R07 successful host body pages alone create bounded, restartable evidence for this operation and exact version", async () =>
{
	const Identity = { Scope: "scope", SessionId: "s", OperationId: "op" }, Messages: ChatMessage[] = [{ Id: "q", Role: "user", Text: "说明有界性" }, { Id: "a", Role: "assistant", Text: "# 引理的长证明\n\n" + "原创论证 ".repeat(8000), CompletionStatus: "completed" }];
	let Ledger = capture_history_ledger(plan_history_input(Messages, { MaxUtf8Bytes: 24000, HistoryReadAvailable: true, HistoryReadBodyVersionsAvailable: true }).Ledger, Messages, Identity);
	const SourceVersion = Ledger.DeferredMaterials!.find(D => D.MessageId === "a")!.SourceVersion;
	const List = { command: "list" }, Failed = { command: "read", message_id: "a", source_version: "wrong" };
	assert.equal(record_history_read(Ledger, Identity, List, await read_history_page("s", Messages, List, "scope")), Ledger);
	assert.equal(record_history_read(Ledger, Identity, Failed, await read_history_page("s", Messages, Failed, "scope")), Ledger);
	const First = { command: "read", message_id: "a", source_version: SourceVersion, length: 8000 }, R1 = await read_history_page("s", Messages, First, "scope"), Body = JSON.parse(R1.contentItems[0].text);
	Ledger = record_history_read(Ledger, Identity, First, R1);
	assert.equal(Ledger.ReadRecords!.length, 1); assert.equal(Ledger.ReadRecords![0].To, 8000); assert.ok(!("Text" in Ledger.ReadRecords![0]));
	assert.equal(record_history_read(Ledger, Identity, First, R1), Ledger, "duplicate pages add no new evidence");
	assert.equal(record_history_read(Ledger, { ...Identity, OperationId: "other" }, First, R1), Ledger);
	assert.equal(record_history_read(Ledger, { ...Identity, Scope: "other" }, First, R1), Ledger);
	const Continued = { ...First, offset: 8000, version: Body.version }, R2 = await read_history_page("s", Messages, Continued, "scope");
	Ledger = JSON.parse(JSON.stringify(record_history_read(Ledger, Identity, Continued, R2)));
	const Root = new Element(); render_input_ledger(Root as any, Ledger, { Identity, Messages });
	assert.match(Root.all_text(), /只提供补读定位/); assert.match(Root.all_text(), /实际补读成功.*0–8000/); assert.match(Root.all_text(), /8000–16000/);
	assert.ok(!Root.all_text().includes("原创论证 原创论证"), "display evidence must not copy original bodies");
	const Other = new Element(); render_input_ledger(Other as any, Ledger, { Identity: { ...Identity, OperationId: "other" } }); assert.ok(!Other.all_text().includes("实际补读成功"));
	const Preview = new Element(); render_input_ledger(Preview as any, Ledger, { Identity, Preview: true }); assert.ok(!Preview.all_text().includes("实际补读成功")); assert.match(Preview.all_text(), /尚未发送/);
});

test("R07 similar material titles navigate by scope/session/message, never the label or loaded state", () =>
{
	const Identity = { Scope: "scope", SessionId: "s", OperationId: "op" }, Messages: ChatMessage[] = [{ Id: "q1", Role: "user", Text: "证明引理 A" }, { Id: "a1", Role: "assistant", Text: "# 同名引理\n\n第一份完整证明" }, { Id: "q2", Role: "user", Text: "证明引理 A" }, { Id: "a2", Role: "assistant", Text: "# 同名引理\n\n第二份完整证明" }];
	const Ledger = capture_history_ledger(plan_history_input(Messages).Ledger, Messages, Identity), Root = new Element(), Targets: unknown[] = [];
	render_input_ledger(Root as any, Ledger, { Identity, NavigationScope: "ui-scope", Messages, Reveal: T => Targets.push(T) });
	Root.find_buttons().forEach(B => B.Action?.());
	assert.deepEqual(Targets, Messages.map(M => ({ Scope: "ui-scope", SessionId: "s", MessageId: M.Id })));
	assert.ok(!Root.all_text().includes("实际补读成功")); assert.match(Root.all_text(), /第 1 轮/); assert.match(Root.all_text(), /第 2 轮/);
});

test("R07 prepared inputs and unknown delivery do not claim the model already received historical bodies", () =>
{
	const Messages: ChatMessage[] = [{ Id: "q", Role: "user", Text: "核对原假设" }, { Id: "a", Role: "assistant", Text: "原论证" }], Ledger = plan_history_input(Messages).Ledger;
	const Prepared = new Element(); render_input_ledger(Prepared as any, Ledger, { Messages, Delivery: "prepared" });
	assert.match(Prepared.all_text(), /尚未发送/); assert.match(Prepared.all_text(), /预计提供正文/); assert.ok(!Prepared.all_text().includes("本轮已提供正文"));
	const Unknown = new Element(); render_input_ledger(Unknown as any, Ledger, { Messages, Delivery: "unknown" });
	assert.match(Unknown.all_text(), /提交待核对/); assert.match(Unknown.all_text(), /原请求包含正文/); assert.ok(!Unknown.all_text().includes("本轮已提供正文"));
});

test("R07 summary and read evidence are bounded without filling absent legacy metadata", async () =>
{
	const Messages: ChatMessage[] = Array.from({ length: 300 }, (_, I) => ({ Id: "m" + I, Role: "assistant", Text: "# " + "长标题".repeat(200) + I })), Identity = { Scope: "scope", SessionId: "s", OperationId: "op" };
	const Base = plan_history_input(Messages.slice(-2)).Ledger;
	let Ledger = capture_history_ledger({ ...Base, IncludedMessageIds: Messages.map(M => M.Id) }, Messages, Identity);
	assert.equal(Ledger.MaterialLabels!.length, HistoryLedgerLimits.Labels); assert.ok(Ledger.MaterialLabels!.every(L => L.Label.length <= HistoryLedgerLimits.LabelChars + 1));
	const ReadMessage: ChatMessage[] = [{ Id: "long", Role: "assistant", Text: "x".repeat(120) }];
	const First = await read_history_page("s", ReadMessage, { command: "read", message_id: "long", length: 1 }, "scope"), Version = JSON.parse(First.contentItems[0].text).version;
	for(let Offset = 0; Offset < 65; Offset++)
	{
		const Args = { command: "read", message_id: "long", offset: Offset, length: 1, version: Version };
		Ledger = record_history_read(Ledger, Identity, Args, await read_history_page("s", ReadMessage, Args, "scope"));
	}
	assert.equal(Ledger.ReadRecords!.length, HistoryLedgerLimits.Reads); assert.equal(Ledger.ReadRecordsTruncated, true);
	const Root = new Element(); render_input_ledger(Root as any, { ...Base, IncludedMessageIds: ["not-loaded"], IncludedMessageVersions: [] });
	assert.match(Root.all_text(), /摘要未知/); assert.match(Root.all_text(), /原回答完成状态: 未知/); assert.match(Root.all_text(), /实际补读: 尚未知/);
});
