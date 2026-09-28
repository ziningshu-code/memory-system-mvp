import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTopicMemory,InMemoryStorage,createOpenAICompatibleMemoryLlm,type MemoryStorage,type MemoryLlmRequest} from '../src/index.js';
import {FileMemoryStorage} from '../src/node.js';

const topic=(scope:string)=>({scope,labelTerms:[scope],retrievalTerms:[scope]});
const assign=(sequence:number,topicIndex:number)=>({sequence,topicIndex,change:'addition'});
async function setup(store:MemoryStorage=new InMemoryStorage(),maxTopics=3){
  const output:string[]=[],calls:MemoryLlmRequest[]=[];
  const memory=createTopicMemory({storage:store,batchSize:2,maxTopics,memoryBudget:1400,workerMaxTokens:6400,selectorMaxTokens:1600,
    llm:{async complete(r){calls.push(r);const next=output.shift();if(next===undefined)throw Error('Unexpected model call');return next;}}});
  const texts=['Friday dinner at Pine for four.','Move that dinner to Bamboo; keep four people.','A separate Friday dinner for coworkers at Pine.'];
  for(const [i,text] of texts.entries())await memory.append({sourceId:`r${i}`,userText:text,assistantText:'Recorded.',userSentAt:100+i,assistantCompletedAt:100+i});
  const run=async(links:unknown[])=>{output.push(JSON.stringify({topics:[topic('Friday dinner at Pine'),topic('Friday dinner at Bamboo')],assignments:[assign(1,0),assign(2,1)],links}));return memory.index();};
  const link={fromTopic:1,toTopic:0,kind:'same_event',sequence:2,quote:'Move that dinner to Bamboo; keep four people.'};
  return {memory,store,output,calls,texts,run,link};
}
test('explicit same-event links join split cards, preserve both originals and survive restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'grounded-family-')),file=join(dir,'memory.json');
  const f=await setup(new FileMemoryStorage(file));assert.equal((await f.run([f.link])).reason,'accepted');
  const cards=await f.store.listTopics();assert.equal(cards.length,2);assert.equal(cards[0].family!.id,cards[1].family!.id);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].maxTokens,6400);
  const store=new FileMemoryStorage(file);assert.deepEqual(await store.listTopics(),cards);
  const restarted=createTopicMemory({storage:store,llm:{complete:async()=>{throw Error('Not needed');}}});
  const [e]=await restarted.open([cards[0].family!.id]);assert.ok(e.text.includes(f.texts[0]));assert.ok(e.text.includes(f.texts[1]));
  assert.equal(cards[0].family!.linkEvidence!.length,0);
  assert.equal(cards[1].family!.linkEvidence![0].quote,f.link.quote);
});
for(const [name,change] of [
  ['paraphrased quote',{quote:'Change the restaurant to Bamboo.'}],
  ['unassigned source',{sequence:1,quote:'Friday dinner at Pine for four.'}],
] as const)test(`ignores ${name} without losing indexed originals`,async()=>{
  const f=await setup();const result=await f.run([{...f.link,...change}]);
  assert.equal(result.reason,'accepted');
  assert.match(result.run!.warnings![0],/Ignored 1 ungrounded optional family link/);
  const cards=await f.store.listTopics();assert.equal(cards.length,2);
  assert.notEqual(cards[0].family!.id,cards[1].family!.id);
  assert.deepEqual(cards.flatMap(card=>card.family!.linkEvidence),[]);
  const [first]=await f.memory.open([cards[0].family!.id]);
  const [second]=await f.memory.open([cards[1].family!.id]);
  assert.ok(first.text.includes(f.texts[0]));assert.ok(second.text.includes(f.texts[1]));
});
for(const [name,change] of [
  ['foreign topic',{toTopic:7}],
  ['ambiguous target',{toFamily:'unknown'}],
] as const)test(`rejects ${name} with exact originals still available and no automatic retry`,async()=>{
  const f=await setup();assert.equal((await f.run([{...f.link,...change}])).reason,'rejected');
  assert.equal((await f.memory.index()).reason,'unchanged_input');assert.equal(f.calls.length,1);
  assert.equal((await f.store.listTopics()).length,0);assert.ok((await f.memory.open(['pending_2']))[0].text.includes(f.texts[1]));
});
test('contradictory same-event and separate links are rejected',async()=>{
  const f=await setup();assert.equal((await f.run([f.link,{...f.link,kind:'separate'}])).reason,'rejected');
});
test('an ungrounded optional link does not discard a separate grounded link',async()=>{
  const f=await setup();const result=await f.run([
    {...f.link,quote:'Paraphrased instead of quoted'},
    {...f.link,kind:'related'},
  ]);
  assert.equal(result.reason,'accepted');
  const cards=await f.store.listTopics();
  assert.equal(cards.length,2);
  assert.notEqual(cards[0].family!.id,cards[1].family!.id);
  assert.equal(cards[1].family!.linkEvidence!.length,1);
  assert.equal(cards[1].family!.linkEvidence![0].quote,f.link.quote);
});
test('unused model cards and their links are dropped without losing assigned originals',async()=>{
  const f=await setup();
  f.output.push(JSON.stringify({topics:[topic('Friday dinner'),topic('Dinner change'),topic('Unused card')],
    assignments:[assign(1,0),assign(2,1)],links:[
      {fromTopic:0,toTopic:2,kind:'related',sequence:1,quote:f.texts[0]},
    ]}));
  const result=await f.memory.index();
  assert.equal(result.reason,'accepted');
  assert.match(result.run!.warnings![0],/Ignored 1 unused optional topic cards and 1 links/);
  const cards=await f.store.listTopics();assert.equal(cards.length,2);
  assert.deepEqual(cards.flatMap(card=>card.family!.linkEvidence),[]);
  assert.ok((await f.memory.open([cards[0].family!.id]))[0].text.includes(f.texts[0]));
  assert.ok((await f.memory.open([cards[1].family!.id]))[0].text.includes(f.texts[1]));
});
test('conflicting duplicate assignments keep one primary card and preserve the original',async()=>{
  const f=await setup();
  f.output.push(JSON.stringify({topics:[topic('Dinner plan'),topic('Dinner revision'),topic('Extra interpretation')],
    assignments:[assign(1,0),assign(2,1),assign(2,2)],links:[]}));
  const result=await f.memory.index();
  assert.equal(result.reason,'accepted');
  assert.match(result.run!.warnings![0],/first assignment for 1 duplicate record entries \(1 conflicting\)/);
  assert.match(result.run!.warnings![1],/Ignored 1 unused optional topic cards/);
  const cards=await f.store.listTopics();assert.equal(cards.length,2);
  assert.ok((await f.memory.open([cards[1].family!.id]))[0].text.includes(f.texts[1]));
});
test('a claimed bridge between two old families becomes a related link',async()=>{
  const f=await setup();assert.equal((await f.run([])).reason,'accepted');
  const old=await f.store.listTopics();assert.notEqual(old[0].family!.id,old[1].family!.id);
  const fourth='Another separate dinner needs a reservation.';
  await f.memory.append({sourceId:'r3',userText:fourth,assistantText:'Recorded.',userSentAt:103,assistantCompletedAt:103});
  f.output.push(JSON.stringify({topics:[topic('Coworker dinner'),topic('Other dinner')],
    assignments:[assign(3,0),assign(4,1)],links:[
      {fromTopic:0,toTopic:1,kind:'same_event',sequence:3,quote:f.texts[2]},
      {fromTopic:0,toFamily:old[0].family!.id,kind:'same_event',sequence:3,quote:f.texts[2]},
      {fromTopic:1,toFamily:old[1].family!.id,kind:'same_event',sequence:4,quote:fourth},
    ]}));
  const result=await f.memory.index();assert.equal(result.reason,'accepted');
  assert.match(result.run!.warnings![0],/downgrading 1 conflicting same-event links to related/);
  const cards=await f.store.listTopics();assert.deepEqual(cards.slice(0,2),old);
  assert.equal(cards[2].family!.id,old[0].family!.id);
  assert.equal(cards[3].family!.id,old[1].family!.id);
  assert.equal(cards[2].family!.linkEvidence!.find(link=>link.targetFamilyId===old[1].family!.id)?.kind,'related');
});
test('change words without a grounded relation cannot force a merge',async()=>{
  const f=await setup();assert.equal((await f.run([])).reason,'accepted');
  const cards=await f.store.listTopics();assert.notEqual(cards[0].family!.id,cards[1].family!.id);
});
test('a cited same-event self-link is a harmless no-op; a separate self-link is rejected',async()=>{
  const self={fromTopic:0,toTopic:0,kind:'same_event',sequence:1,quote:'Friday dinner at Pine for four.'};
  const f=await setup();assert.equal((await f.run([self])).reason,'accepted');
  const cards=await f.store.listTopics();assert.notEqual(cards[0].family!.id,cards[1].family!.id);
  assert.equal(cards[0].family!.linkEvidence!.length,0);
  const other=await setup();assert.equal((await other.run([{...self,kind:'separate'}])).reason,'rejected');
});
test('related split cards expand in either direction only when requested and within the same budget',async()=>{
  const f=await setup();await f.run([{...f.link,kind:'related'}]);const cards=await f.store.listTopics();
  for(const c of cards){
    f.output.push(JSON.stringify({familyIds:[c.family!.id],includeRelated:true,inspect:false}));
    const r=await f.memory.recall({query:'What changed in the dinner plan?'});
    assert.equal(r.trace.error,null);assert.equal(r.selectedTopicIds.length,2);assert.equal(r.trace.expandedFamilyIds!.length,1);
    assert.ok(Buffer.byteLength(JSON.stringify(r.evidence))<=1400);assert.equal(f.calls.at(-1)!.maxTokens,1600);
  }
  f.output.push(JSON.stringify({familyIds:[cards[0].family!.id],includeRelated:false}));
  assert.equal((await f.memory.recall({query:'Pine'})).selectedTopicIds.length,1);
});
test('linked originals omitted by the family cap are explicit and prevent a completeness claim',async()=>{
  const f=await setup(undefined,1);await f.run([{...f.link,kind:'related'}]);const [card]=await f.store.listTopics();
  f.output.push(JSON.stringify({familyIds:[card.family!.id],includeRelated:true}));
  const r=await f.memory.recall({query:'dinner'});assert.equal(r.selectedTopicIds.length,1);assert.equal(r.trace.omittedRelatedFamilyIds!.length,1);assert.equal(r.complete,false);
});
test('valid-looking JSON truncated by a reasoning model is still reported as incomplete',async()=>{
  let body:Record<string,unknown>={};
  const llm=createOpenAICompatibleMemoryLlm({baseUrl:'https://example.test',model:'model',reasoningEffort:'medium',fetchImpl:async(_,init)=>{
    body=JSON.parse(String(init!.body));return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"topics":[]}'}}]}));}});
  await assert.rejects(llm.complete({system:'s',user:'u',maxTokens:6400}),/truncated/);
  assert.equal(body.max_tokens,6400);assert.equal(body.reasoning_effort,'medium');
});
test('one delayed transient Worker retry is bounded, while rejected content is not retried',async()=>{
  let clock=1000,calls=0;
  const storage=new InMemoryStorage();
  const memory=createTopicMemory({storage,batchSize:2,now:()=>clock,llm:{async complete(){
    calls++;throw Object.assign(new Error('temporary timeout'),{transient:true});
  }}});
  for(let i=1;i<=2;i++)await memory.append({sourceId:`retry-${i}`,userText:`record ${i}`,assistantText:'saved',userSentAt:i,assistantCompletedAt:i});
  assert.equal((await memory.index()).reason,'failed');
  assert.equal((await memory.index()).reason,'cooldown');assert.equal(calls,1);
  clock+=15*60*1000;
  assert.equal((await memory.index()).reason,'failed');assert.equal(calls,2);
  clock+=15*60*1000;
  assert.equal((await memory.index()).reason,'unchanged_input');assert.equal(calls,2);
  const last=await storage.getLatestTopicWorkerRun();
  assert.equal(last?.transportTransient,true);assert.equal(last?.transportRetryCount,1);
  assert.equal((await memory.open(['pending_1']))[0].text.includes('record 1'),true);
});
test('only retryable HTTP failures are marked transient by the API adapter',async()=>{
  for(const [status,transient] of [[503,true],[429,true],[400,false]] as const){
    const llm=createOpenAICompatibleMemoryLlm({baseUrl:'https://example.test',model:'model',fetchImpl:async()=>new Response('',{status})});
    await assert.rejects(llm.complete({system:'s',user:'u',maxTokens:20}),e=>Boolean((e as {transient?:boolean}).transient)===transient);
  }
});
