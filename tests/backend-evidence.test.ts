import { test } from "node:test";
import assert from "node:assert/strict";
import { apply_backend_evidence } from "../src/backend-events";
import { create_send_operation } from "../src/sync/operations";
import { write_late_receipt, apply_late_receipts } from "../src/runtime/receipts";
import { preserve_terminal_messages } from "../src/runtime/terminal-messages";

async function fixture()
{
	const O=await create_send_operation("backend:original","s","q",{Prompt:"Original proof"},"o");
	Object.assign(O,{ThreadId:"t",TurnId:"u",Status:"running",Attempted:true});
	const State:any={Settings:{},ActiveId:"s",Sessions:[{Id:"s",Title:"Original",ThreadId:"t",Messages:[{Id:"q",Role:"user",Text:"Original proof",Prompt:"Original proof",TurnId:"u"}]}],Sync:{SchemaVersion:1,Scope:O.Scope,Revision:0,Versions:{},Operations:[O],Conflicts:[]}};
	const E:any={threadId:"t",turnId:"u",sessionId:"s",itemId:"a",result:{Text:"First $[H,E]=2E$",Status:"partial",Metadata:{Reason:"length",Model:"actual",Usage:[{Kind:"cumulative",OutputTokens:9,Raw:{completion_tokens:9}}]}}};
	return {State,O,E};
}
test("structured evidence preserves partial body and exact usage without final phase, double settlement or fabricated totals",async()=>
{
	const {State,O,E}=await fixture();assert.ok(apply_backend_evidence(State,E));
	const M=State.Sessions[0].Messages[1];assert.equal(M.Text,E.result.Text);assert.equal(M.CompletionStatus,"partial");assert.equal(M.Phase,"commentary");
	assert.equal(M.BackendResult.Metadata.Usage[0].TotalTokens,undefined);assert.equal(O.Status,"failed");
	const Version=O.Revision;assert.equal(apply_backend_evidence(State,E),false);assert.equal(O.Revision,Version);
	assert.equal(apply_backend_evidence(State,{...E,sessionId:"another"}),false);
	assert.equal(apply_backend_evidence(State,{...E,turnId:"another"}),false);
});
test("completed evidence wins over late cancellation; tombstones forbid body resurrection",async()=>
{
	const {State,O,E}=await fixture();E.result.Status="completed";assert.ok(apply_backend_evidence(State,E));
	assert.equal(apply_backend_evidence(State,{...E,result:{Text:"",Status:"unknown",Metadata:{Wait:"stopped"}}}),false);assert.equal(O.Status,"completed");
	const D=await fixture();D.State.DeletedMessages=[{SessionId:"s",MessageId:"q"}];assert.ok(apply_backend_evidence(D.State,D.E));assert.equal(D.State.Sessions[0].Messages.length,1);assert.equal(D.O.MessageDeleted,true);
});
test("archived late backend body restores only its original operation and cannot downgrade completion on restart",async()=>
{
	const {State,O,E}=await fixture();E.result.Status="completed";
	const Files=new Map<string,string>(),Host={exists:async(P:string)=>Files.has(P),read:async(P:string)=>Files.get(P)!,write:async(P:string,T:string)=>{Files.set(P,T);}};
	const Old=structuredClone(State);apply_backend_evidence(State,E);await write_late_receipt(Host,"original-state.json",O);
	assert.ok(await apply_late_receipts(Host,"original-state.json",Old));assert.equal(Old.Sync.Operations[0].Status,"completed");
	assert.equal(Old.Sessions[0].Messages[1].Text,E.result.Text);assert.equal(Old.Sessions[0].Messages[1].ArchivedOnly,true);
	const Late={...structuredClone(O),Status:"submission-unknown",Result:{backend:{itemId:"a",result:{Text:"short",Status:"unknown",Metadata:{Wait:"stopped"}}}}};
	await write_late_receipt(Host,"original-state.json",Late);await apply_late_receipts(Host,"original-state.json",Old);
	assert.equal(Old.Sync.Operations[0].Status,"completed");assert.equal(Old.Sessions[0].Messages[1].Text,E.result.Text);
});
test("a final unload snapshot preserves durable terminal bodies and unrelated messages without rolling back deletions",async()=>
{
	const {State,E}=await fixture(),Old=structuredClone(State);Old.Sessions[0].Messages.push({Id:"a",Role:"assistant",Text:"old delta",TurnId:"u"},{Id:"independent",Role:"user",Text:"Other question"});
	apply_backend_evidence(State,E);preserve_terminal_messages(Old,State);assert.equal(Old.Sessions[0].Messages[1].Text,E.result.Text);assert.equal(Old.Sessions[0].Messages[2].Text,"Other question");
	const Deleted=structuredClone(Old);Deleted.DeletedMessages=[{SessionId:"s",MessageId:"a"}];Deleted.Sessions[0].Messages[1].Text="no resurrection";delete Deleted.Sessions[0].Messages[1].CompletionStatus;preserve_terminal_messages(Deleted,State);assert.equal(Deleted.Sessions[0].Messages[1].Text,"no resurrection");
});

test("cold receipt restore keeps complete body and usage after a shorter unknown observation",async()=>
{
	const {State,O,E}=await fixture(),Cold=structuredClone(State);E.result.Status="completed";
	const Files=new Map<string,string>(),Host={exists:async(P:string)=>Files.has(P),read:async(P:string)=>Files.get(P)!,write:async(P:string,T:string)=>{Files.set(P,T);}};
	apply_backend_evidence(State,E);await write_late_receipt(Host,"original-state.json",O);
	const Late={...structuredClone(O),Status:"submission-unknown",Result:{backend:{itemId:"a",result:{Text:"short",Status:"unknown",Metadata:{Wait:"stopped"}}}}};
	await write_late_receipt(Host,"original-state.json",Late);await apply_late_receipts(Host,"original-state.json",Cold);
	assert.equal(Cold.Sync.Operations[0].Status,"completed");assert.equal(Cold.Sessions[0].Messages[1].CompletionStatus,"completed");assert.equal(Cold.Sessions[0].Messages[1].Text,E.result.Text);
	assert.equal(Cold.Sessions[0].Messages[1].BackendResult.Metadata.Usage[0].OutputTokens,9);assert.equal(Cold.Sync.Conflicts.length,0);
	assert.ok([...Files.values()].some(R=>JSON.parse(R).Observations?.[0].Record.Result.backend.result.Status==="unknown"));
});

test("a previously successful live reply is not retroactively excluded by a later archived stop observation",async()=>
{
	const {State,O,E}=await fixture();E.result.Status="completed";apply_backend_evidence(State,E);
	const Files=new Map<string,string>(),Host={exists:async(P:string)=>Files.has(P),read:async(P:string)=>Files.get(P)!,write:async(P:string,T:string)=>{Files.set(P,T);}};
	await write_late_receipt(Host,"original-state.json",O);
	await write_late_receipt(Host,"original-state.json",{...structuredClone(O),Status:"submission-unknown",Result:{backend:{itemId:"a",result:{Text:"short",Status:"unknown",Metadata:{Wait:"stopped"}}}}});
	await apply_late_receipts(Host,"original-state.json",State);
	assert.equal(State.Sessions[0].Messages[1].CompletionStatus,"completed");assert.equal(State.Sessions[0].Messages[1].ArchivedOnly,undefined);assert.equal(State.Sessions[0].Messages[1].Text,E.result.Text);
});
