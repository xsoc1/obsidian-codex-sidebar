import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read_history_page, plan_history_input } from '../src/history-budget';
import { answer_quote, bind_answer_blocks, quote_blocks } from '../src/quote';
import { markdown_blocks, text_identity } from '../src/markdown-blocks';
import { build_prompt, derived_message_prompt } from '../src/prompt';
import type { ChatMessage } from '../src/history';
const body = (R: Awaited<ReturnType<typeof read_history_page>>) => { assert.equal(R.success, true, R.contentItems[0].text); return JSON.parse(R.contentItems[0].text); };

test('old proof body continuation survives unrelated streaming, metadata and appended messages', async () =>
{
	const Messages: ChatMessage[] = [{ Id:'old', Role:'assistant', Text:'原始证明'.repeat(6000) }, { Id:'live', Role:'reasoning', Text:'分析' }];
	const First = body(await read_history_page('session', Messages, {command:'read',message_id:'old',length:12000}, 'device-a'));
	Messages[1].Text += '更新'; Messages[0].CompletionStatus='completed'; Messages.push({Id:'new',Role:'user',Text:'下一问'});
	const Next = body(await read_history_page('session',Messages,{command:'read',message_id:'old',offset:12000,version:First.version},'device-a'));
	assert.equal(Next.version,First.version); assert.equal(First.text+Next.text,Messages[0].Text);
	for(const [Session,Scope] of [['other','device-a'],['session','device-b']]) {assert.equal((await read_history_page(Session,Messages,{command:'read',message_id:'old',version:First.version},Scope)).success,false);}
	Messages[0].Text+='changed'; assert.equal((await read_history_page('session',Messages,{command:'read',message_id:'old',offset:12000,version:First.version},'device-a')).success,false);
	assert.equal((await read_history_page('session',[],{command:'read',message_id:'old',version:First.version},'device-a')).success,false);
});

test('directory snapshots remain fixed while body and unrelated messages change; field tokens cannot cross fields',async()=>
{
	const Messages:ChatMessage[]=[{Id:'u',Role:'user',Text:'same',Prompt:'same'},{Id:'a',Role:'assistant',Text:'old'}];
	const First=body(await read_history_page('directory',Messages,{command:'list',limit:1}));
	Messages[1].Text='new';Messages[1].CompletionStatus='completed';Messages.unshift({Id:'inserted',Role:'user',Text:'new question'});
	const Next=body(await read_history_page('directory',Messages,{command:'list',limit:1,offset:1,version:First.version}));
	assert.equal(Next.total,2);assert.equal(Next.messages[0].id,'a');assert.equal(Next.messages[0].status,'unknown');
	assert.equal((await read_history_page('directory',Messages,{command:'read',message_id:'u',version:First.version})).success,false);
	const Read=body(await read_history_page('directory',Messages,{command:'read',message_id:'u'}));
	assert.equal((await read_history_page('directory',Messages,{command:'read',message_id:'u',field:'prompt',version:Read.version})).success,false);
	assert.equal((await read_history_page('directory',Messages,{command:'read',message_id:'u',offset:1})).success,false);
	assert.equal((await read_history_page('directory',Messages,{command:'read',message_id:'u',source_version:'wrong'})).success,false);
	for(let I=0;I<9;I++){body(await read_history_page('eviction-'+I,Messages,{command:'list'}));}
	assert.equal((await read_history_page('directory',Messages,{command:'list',offset:1,version:First.version})).success,false);
});

function rendered(Source:string, Extra=false)
{
	const Blocks=markdown_blocks(Source),Nodes:any[]=Blocks.map(B=>({tagName:B.Kind==='separator'?'HR':B.Kind==='math'?'DIV':B.Kind==='heading'?'H2':'P',textContent:B.Kind==='heading'?B.Text.replace(/^#+ /,''):B.Text,dataset:{},classList:{contains:()=>false},matches:()=>false,querySelector:()=>B.Kind==='math'?{}:null}));
	if(Extra){Nodes.splice(3,0,{tagName:'SECTION',textContent:'unsupported widget',dataset:{},classList:{contains:()=>false},matches:()=>false,querySelector:()=>null});}
	const Root:any={children:Nodes,dataset:{},contains:()=>true,querySelectorAll:()=>Nodes.filter(N=>N.dataset.codexAnswerBlock)};
	return {Root,Nodes,Blocks};
}
test('49k answer tail formulas survive HR and unknown nodes without all-or-nothing mapping',()=>
{
	const Prefix=Array.from({length:90},(_,I)=>I+' '+'完整论证说明'.repeat(90)).join('\n\n'),Formula='$$\n\\int_0^1 x^2\\,dx=\\frac13\n$$';
	for(const Hr of [false,true])
	{
		const Source=Prefix+'\n\n'+(Hr?'---\n\n':'')+Formula, {Root,Nodes}=rendered(Source,true);
		assert.equal(bind_answer_blocks(Root,Source),true);
		const Range:any={commonAncestorContainer:Root,intersectsNode:(N:any)=>N===Nodes.at(-1)},Location=quote_blocks(Root,Range,Source),Quote=answer_quote('s','a','rendered integral',Source,'completed',Location);
		assert.equal(Location.Mapping,'source-blocks');assert.match(Quote.SourceText,/\\int_0\^1/);assert.ok(Quote.SourceRange!.From>24000);assert.equal(Quote.SourceTruncated,true);
		assert.deepEqual(quote_blocks(Root,Range,Source+'changed'),{Mapping:'unknown'});
		assert.deepEqual(quote_blocks(Root,{...Range,intersectsNode:(N:any)=>N===Nodes[3]} as any,Source),{Mapping:'unknown'});
	}
});
test('duplicate formulas stay unknown without renderer source positions, and no arbitrary prefix is captured',()=>
{
	const Source='段落\n\n$$x=1$$\n\n另一段\n\n$$x=1$$', {Root,Nodes}=rendered(Source);
	bind_answer_blocks(Root,Source); const Range:any={commonAncestorContainer:Root,intersectsNode:(N:any)=>N===Nodes.at(-1)};
	assert.deepEqual(quote_blocks(Root,Range,Source),{Mapping:'unknown'});
	const Long='无关前文'.repeat(10000)+'\n\n$$y=2$$',Quote=answer_quote('s','a','rendered unknown',Long,'completed',{Mapping:'unknown'});
	assert.equal(Quote.SourceText,'');assert.equal(Quote.Mapping,'unknown');assert.equal(Quote.SourceRange!.To,0);
	const Ref=JSON.parse(build_prompt('解释',null,Quote).split('\n').at(-1)!);assert.equal(Ref.original_message_read.source_version,text_identity(Long));
});
test('known/unknown windows deduplicate quote body before mandatory history selection and never rewrite originals',()=>
{
	const Source='中文说明'.repeat(5600),Q=answer_quote('s','a','说明',Source,'completed'),Current:ChatMessage={Id:'new',Role:'user',Text:'解释',Quote:Q};
	// Legacy saved prompt includes the same block body twice. Derivation must preserve its contract.
	const P=build_prompt(Current.Text,null,Q),At=P.lastIndexOf('\n'),Value=JSON.parse(P.slice(At+1));Value.source_blocks=Q.SourceBlocks;Current.Prompt=P.slice(0,At+1)+JSON.stringify(Value);
	const Messages:ChatMessage[]=[{Id:'u',Role:'user',Text:'原题: 在实数域讨论, 沿原证明路线'},{Id:'a',Role:'assistant',Text:Source}],Before=JSON.stringify([Messages,Current]);
	assert.ok(new TextEncoder().encode(Current.Prompt).length>136000);assert.ok(new TextEncoder().encode(derived_message_prompt(Current)).length<71000);
	for(const Window of [undefined,400000])
	{
		const Plan=plan_history_input(Messages,{ModelContextWindow:Window,CurrentMessage:Current,SessionId:'s',ReservedUtf8Bytes:2000,RequiredMessageIds:['a'],HistoryReadAvailable:true,HistoryReadBodyVersionsAvailable:true});
		assert.equal(Plan.Ledger.Deduplicated.length,1);assert.equal(Plan.Ledger.Deduplicated[0].ProvidedIn,'current:new');assert.ok(Plan.Messages[0].Prompt!.includes('在实数域'));assert.ok(Plan.Ledger.ActualUtf8Bytes<2000);
	}
	assert.equal(JSON.stringify([Messages,Current]),Before);
});
test('oversized required original uses version-bound read locator only with available capability',async()=>
{
	const Messages:ChatMessage[]=[{Id:'u',Role:'user',Text:'原问题: a>0',Prompt:'原问题: a>0\n'+'原条件'.repeat(15000)},{Id:'a',Role:'assistant',Text:'证明'.repeat(20000)}],Before=JSON.stringify(Messages);
	assert.throws(()=>plan_history_input(Messages,{MaxUtf8Bytes:24000,HistoryReadAvailable:false}),/完整回合/);
	const Plan=plan_history_input(Messages,{MaxUtf8Bytes:24000,HistoryReadAvailable:true,HistoryReadBodyVersionsAvailable:true});assert.equal(Plan.Ledger.DeferredMaterials!.length,2);assert.match(Plan.Messages[0].Prompt!,/a>0/);assert.match(Plan.Messages[1].Text,/不是证明或条件的摘要/);
	for(const D of Plan.Ledger.DeferredMaterials!){body(await read_history_page('s',Messages,{command:'read',message_id:D.MessageId,field:D.Field,source_version:D.SourceVersion}));}
	Messages[1].Text+='new';assert.equal((await read_history_page('s',Messages,{command:'read',message_id:'a',source_version:Plan.Ledger.DeferredMaterials![1].SourceVersion})).success,false);
	assert.equal(JSON.stringify(Messages).slice(0,Before.length-7).includes('原问题'),true);
});

test('dedup never points at an omitted earlier provider and deferred providers retain exact read locators',()=>
{
	const Text='原定义与假设. '.repeat(500), Context:any={Path:'One.md',Mode:'阅读',Kind:'当前位置',Text,SelectedText:'',LineStart:0,LineEnd:1,Heading:'',Mapping:'源块',CapturedAt:'capture',Truncated:false,Version:'one'};
	const Messages:ChatMessage[]=[{Id:'u1',Role:'user',Text:'最初问题',Prompt:'最初问题\n'+Text,Context},{Id:'a1',Role:'assistant',Text:'第一份证明'.repeat(4000)},{Id:'u2',Role:'user',Text:'继续沿此路线',Prompt:'继续沿此路线\n'+Text,Context:structuredClone(Context)},{Id:'a2',Role:'assistant',Text:'第二份说明'}];
	const Plan=plan_history_input(Messages,{MaxMessages:2,MaxUtf8Bytes:40000,HistoryReadAvailable:true,HistoryReadBodyVersionsAvailable:true});
	assert.deepEqual(Plan.Messages.map(M=>M.Id),['u2','a2']);assert.ok(Plan.Messages[0].Prompt!.includes(Text));assert.equal(Plan.Ledger.Deduplicated.length,0);
	const Needed=plan_history_input(Messages,{RequiredMessageIds:['u1'],MaxUtf8Bytes:26000,HistoryReadAvailable:true,HistoryReadBodyVersionsAvailable:true});
	for(const D of Needed.Ledger.Deduplicated){assert.ok(Needed.Messages.some(M=>M.Id===D.ProvidedIn)||D.ProvidedIn.startsWith('current:'));}
	for(const D of Needed.Ledger.DeferredMaterials!){const M=Needed.Messages.find(M=>M.Id===D.MessageId)!;assert.match(M.Prompt??M.Text,/obsidian_history_read/);}
});
test('same wording does not deduplicate distinct answer identities or source paths; custom saved prompts are opaque',()=>
{
	const Text='相同文字'.repeat(1000),Messages:ChatMessage[]=[{Id:'u1',Role:'user',Text:'第一个条件'},{Id:'a1',Role:'assistant',Text},{Id:'u2',Role:'user',Text:'另一个条件'},{Id:'a2',Role:'assistant',Text}];
	const Plan=plan_history_input(Messages,{MaxUtf8Bytes:60000});assert.equal(Plan.Ledger.Deduplicated.length,0);assert.equal(Plan.Messages[1].Text,Text);assert.equal(Plan.Messages[3].Text,Text);
	const Quote=answer_quote('s','a1','相同',Text),M:ChatMessage={Id:'u3',Role:'user',Text:'question',Prompt:'A custom prompt with immutable instructions',Quote};assert.equal(derived_message_prompt(M),M.Prompt);
	const Opaque=plan_history_input(Messages,{MaxUtf8Bytes:60000,CurrentMessage:M,SessionId:'s'});assert.equal(Opaque.Ledger.Deduplicated.length,0);assert.equal(Opaque.Messages[1].Text,Text);
	const WrongScope=plan_history_input(Messages,{MaxUtf8Bytes:60000,CurrentMessage:{...M,Prompt:build_prompt('question',null,Quote)},SessionId:'different'});assert.equal(WrongScope.Ledger.Deduplicated.length,0);
});
test('old history-read capability cannot create new versioned deferred materials',()=>
{
	const Messages:ChatMessage[]=[{Id:'u',Role:'user',Text:'问题'},{Id:'a',Role:'assistant',Text:'证明'.repeat(20000)}];
	assert.throws(()=>plan_history_input(Messages,{MaxUtf8Bytes:24000,HistoryReadAvailable:true,HistoryReadBodyVersionsAvailable:false}),/完整回合/);
});
