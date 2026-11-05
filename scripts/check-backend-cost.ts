// Original loopback fixture: real transport timing, not provider billing or device acceptance.
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import assert from "node:assert/strict";
import { direct_api } from "../src/direct-api";
import { StreamCheckpoints } from "../src/runtime/checkpoints";

async function main(): Promise<void>
{
const Sleep=(Ms:number)=>new Promise(R=>setTimeout(R,Ms)), Parts=["先设 $H$ 是对角矩阵。", "接着计算 $HE=E$。", "再算 $EH=-E$。", "故 $[H,E]=2E$。"];
const Server=createServer(async(Req,Res)=>
{
	let Body="";for await(const C of Req){Body+=C;}const Input=JSON.parse(Body);
	if(Input.stream){Res.writeHead(200,{"Content-Type":"text/event-stream"});}
	for(const Part of Parts)
	{
		await Sleep(40);
		if(Input.stream){Res.write("data: "+JSON.stringify({id:"original-timing",choices:[{index:0,delta:{content:Part},finish_reason:null}]})+"\n\n");}
	}
	await Sleep(30);
	const Value={id:"original-timing",choices:[{index:0,message:{content:Parts.join("")},finish_reason:"stop"}],usage:{completion_tokens:27}};
	if(Input.stream){Res.end("data: "+JSON.stringify({choices:[{index:0,delta:{},finish_reason:"stop"}]})+"\n\ndata: "+JSON.stringify({choices:[],usage:Value.usage})+"\n\ndata: [DONE]\n\n");}
	else{Res.writeHead(200,{"Content-Type":"application/json"});Res.end(JSON.stringify(Value));}
});
await new Promise<void>(R=>Server.listen(0,"127.0.0.1",R));
const Url="http://127.0.0.1:"+(Server.address() as {port:number}).port;
const Fetch:typeof fetch=(_Url,Options)=>fetch(Url,Options);
const Rows:unknown[]=[];
try
{
	for(const Stream of ["buffered","auto"] as const)
	{
		const Start=performance.now();let First:number|undefined,Deltas=0;
		const Driver=direct_api({Kind:"api",Provider:"compatible",Base:"https://original.invalid",Model:"original",Vision:false,HistoryTools:false,Stream},"original-synthetic-key",async Request=>{const R=await Fetch(Request.url,Request);return {status:R.status,json:await R.json()};},undefined,{Fetch});
		const Result=await Driver({Session:"original",Messages:[{Role:"user",Text:"Original matrix computation"}],OnDelta:()=>{First??=performance.now()-Start;Deltas++;}},new AbortController().signal);
		const End=performance.now()-Start;if(First===undefined){First=End;}
		assert.equal(Result.Status,"completed");assert.equal(Result.Text,Parts.join(""));assert.equal(Result.Metadata.Usage?.[0].OutputTokens,27);
		if(Stream==="auto"){assert.ok(Deltas>=4);assert.ok(First<End-70);}
		Rows.push({transport:Stream,firstVisibleMs:Math.round(First),finishedMs:Math.round(End),deltaCallbacks:Deltas,exactBody:true});
	}
}
finally{await new Promise<void>((R,J)=>Server.close(E=>E?J(E):R()));}
const Directory=mkdtempSync(join(tmpdir(),"codex-backend-cost-"));
const Baseline=execFileSync("git",["show","734e497:src/runtime/checkpoints.ts"],{encoding:"utf8"});
const BaselinePath=join(Directory,"baseline.cjs");buildSync({stdin:{contents:Baseline,loader:"ts"},outfile:BaselinePath,platform:"node",format:"cjs"});
const Legacy=createRequire(__filename)(BaselinePath).StreamCheckpoints;
const Checkpoints=[];
for(const [Label,Class] of [["734e497 asynchronous error swallowed",Legacy],["candidate awaited retry",StreamCheckpoints]] as const)
{
	let Attempts=0,Saved=0,Errors=0;const Gate=new Class(5,1);
	Gate.offer("original/s/t/a",1,async()=>
	{
		try{Attempts++;await Sleep(2);if(Attempts===1){throw Error("original synthetic I/O failure");}Saved++;}
		catch(E){Errors++;if(Class===StreamCheckpoints){throw E;}}
	});
	await Sleep(60);await Gate.close();
	Checkpoints.push({case:Label,attempts:Attempts,errors:Errors,saved:Saved,pending:Gate.pending,stats:Gate.Stats});
}
assert.equal(Checkpoints[0].saved,0);assert.equal(Checkpoints[1].saved,1);
const Report={layer:"same Windows/Node process; loopback HTTP and controlled async storage, not real API/iPad",stream:Rows,checkpoints:Checkpoints};
writeFileSync(join(Directory,"report.json"),JSON.stringify(Report,null,2));console.log(JSON.stringify({directory:Directory,...Report}));

}
void main().catch(E=>{console.error(E);process.exitCode=1;});
