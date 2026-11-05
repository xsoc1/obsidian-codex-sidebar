import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectionProfiles, ConnectionCredentials } from "../src/connection-profiles";
import { backend_identity, backend_profile } from "../src/backend-profile";
import { verify_quoted_body } from "../src/quote-input";
import { plan_history_input } from "../src/history-budget";
import { text_identity } from "../src/markdown-blocks";

test("connection profiles never persist credentials and keep legacy history identity across model or protocol switches", () =>
{
	const Data=new Map<string,string>(),Storage={getItem:(K:string)=>Data.get(K)??null,setItem:(K:string,V:string)=>{Data.set(K,V);}};
	const Store=new ConnectionProfiles(Storage,"original-fixture"),Keys=new ConnectionCredentials();
	const A=backend_profile({Kind:"api",Provider:"compatible",Base:"https://first.invalid/v1",Model:"one",Vision:false,Protocol:"responses"});
	const B=backend_profile({...A,Model:"two",Protocol:"chat"});
	const C=backend_profile({...A,Base:"https://second.invalid/v1"});
	const D=backend_profile({...A,Identity:"second-account"});
	assert.equal(backend_identity(A),backend_identity(B));assert.notEqual(backend_identity(A),backend_identity(C));assert.notEqual(backend_identity(A),backend_identity(D));
	Keys.set(A,"fixture-secret-never-stored");
	assert.equal(Keys.get(B),"fixture-secret-never-stored");assert.equal(Keys.get(C),"");assert.equal(Keys.get(D),"");
	Store.save(A,"服务一");Store.save(B,"服务一另一模型");Store.save(C,"服务二");
	const Reload=new ConnectionProfiles(Storage,"original-fixture");
	assert.equal(Reload.list().length,3);assert.equal(Reload.list()[0].Profile.Kind,"api");
	assert.ok(![...Data.values()].join("").includes("fixture-secret"));
	assert.equal(new ConnectionCredentials().get(A),"");
	Keys.clear();assert.equal(Keys.get(B),"");
});

test("a long tail quote is prefetched for a no-tool backend and never requires a nonexistent remote bridge", () =>
{
	const Text="首个条件：设 X 是矩阵。\n"+"证明步骤 a=b.\n".repeat(2920)+"\n最后公式 $[X,X]=0$.";
	const Messages:any[]=[{Id:"q",Role:"user",Text:"证明交换子的性质",Prompt:"证明交换子的性质"},{Id:"a",Role:"assistant",Text,CompletionStatus:"completed"}];
	const Quote:any={SessionId:"original",MessageId:"a",SelectedText:"$[X,X]=0$",SourceText:Text.slice(-12000),SourceTruncated:true,SelectedTruncated:false,SourceVersion:text_identity(Text)};
	assert.equal(verify_quoted_body(Quote,"original",Messages),Messages[1]);
	const Current:any={Id:"next",Role:"user",Text:"为什么？",Quote};
	const Plan=plan_history_input(Messages,{SessionId:"original",CurrentMessage:Current,RequiredMessageIds:["a"],HistoryReadAvailable:false,HistoryReadBodyVersionsAvailable:false,MaxUtf8Bytes:192000});
	assert.ok(Plan.Messages.some(M=>M.Id==="a"&&M.Text===Text));assert.ok(!Plan.Navigation.includes("升级桥"));
	assert.throws(()=>verify_quoted_body({...Quote,SessionId:"elsewhere"},"original",Messages),/会话/);
	assert.throws(()=>verify_quoted_body(Quote,"original",[{...Messages[1],Text:Text+"changed"}]),/版本/);
	assert.equal(Messages[1].Text,Text);
});
