import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIncrementalMemory, InMemoryStorage, type MemoryLlm } from '../src/index.js';
import { FileMemoryStorage } from '../src/storage/file.js';
import { TextBudget } from '../src/budget.js';
import { timeFilter } from '../src/retrieval.js';

type Engine = ReturnType<typeof createIncrementalMemory>;
async function add(memory:Engine,text:string,sequenceTime=Date.now()) {
  const e=await memory.beginExchange({userText:text,userSentAt:sequenceTime});
  await memory.completeExchange({exchangeId:e.id,assistantText:'Acknowledged.',assistantCompletedAt:sequenceTime+1});
  return e;
}
function worker(inputs: number[][]): MemoryLlm {
  return { async complete(request) {
    const records=JSON.parse(request.user).records as Array<{sequence:number}>;
    inputs.push(records.map(r=>r.sequence));
    return JSON.stringify({topics:[{labelTerms:['project','requirements'],retrievalTerms:['project','requirements','decision'],spans:records.map(r=>({startSequence:r.sequence,endSequence:r.sequence}))}]});
  } };
}
async function fill(memory:Engine,count=6) { for(let i=0;i<count;i++) await add(memory,`Weather observation ${i}.`); }

test('raw evidence is available without a model, and stored text is exact',async()=>{
  const m=createIncrementalMemory({storage:new InMemoryStorage()});
  const text='Aurora hotel ceiling is 13640 yen. [[b_mS]] should remain verbatim.';
  const e=await m.begin(text); await m.completeExchange({exchangeId:e.id,assistantText:'[[b_mC]] original reply'});
  await fill(m);
  const r=await m.retrieve({userMessage:'What was the Aurora hotel ceiling?'});
  assert.deepEqual(r.trace.recoveredSequences,[1]);
  assert.equal(JSON.parse(r.openedTopicPackets[0]).user.text,text);
  assert.equal((await m.listExchanges())[0].assistantText,'[[b_mC]] original reply');
  assert.equal((await m.maybeRunTopicWorker()).reason,'disabled');
});
test('200 continuing turns index once each, in ten nonoverlapping batches',async()=>{
  const inputs:number[][]=[]; const m=createIncrementalMemory({storage:new InMemoryStorage(),topicWorker:worker(inputs)});
  for(let i=0;i<200;i++){await add(m,`Project requirement ${i}`);await m.maybeRunTopicWorker();}
  assert.equal(inputs.length,10);
  assert.deepEqual(inputs.flat(),Array.from({length:200},(_,i)=>i+1));
  assert.equal((await m.maybeRunTopicWorker()).reason,'unchanged_input');
});
test('concurrent indexing does not duplicate model calls or IDs',async()=>{
  const inputs:number[][]=[];const m=createIncrementalMemory({storage:new InMemoryStorage(),topicWorker:worker(inputs),batchSize:2});
  const pending=await Promise.all(Array.from({length:4},(_,i)=>m.begin(`record ${i}`)));
  assert.equal(new Set(pending.map(e=>e.sequence)).size,4);
  for(const e of pending)await m.completeExchange({exchangeId:e.id,assistantText:'done'});
  await Promise.all([m.maybeRunTopicWorker(),m.maybeRunTopicWorker(),m.maybeRunTopicWorker()]);
  assert.deepEqual(inputs,[[1,2],[3,4]]);
  assert.deepEqual((await m.listTopics()).map(t=>t.topicId),['T1','T2']);
});
test('invalid worker output is rejected without losing raw search or retrying every turn',async()=>{
  let calls=0;const m=createIncrementalMemory({storage:new InMemoryStorage(),batchSize:2,topicWorker:{async complete(){calls++;return '{invalid';}}});
  await add(m,'Marmot passphrase is cedar-406.');await fill(m,6);
  assert.equal((await m.maybeRunTopicWorker()).reason,'rejected');
  assert.equal((await m.maybeRunTopicWorker()).reason,'unchanged_input');
  assert.equal(calls,1);
  assert.match((await m.retrieve({userMessage:'Marmot passphrase?'})).memoryContext,/cedar-406/);
  await m.maybeRunTopicWorker({retryFailed:true});assert.equal(calls,2);
});
test('missing sequences, overlaps and huge forged spans are rejected',async()=>{
  for(const spans of [[{startSequence:1,endSequence:999999999999}],[{startSequence:1,endSequence:1}],[{startSequence:1,endSequence:2},{startSequence:2,endSequence:2}]]){
    const m=createIncrementalMemory({storage:new InMemoryStorage(),batchSize:2,topicWorker:{async complete(){return JSON.stringify({topics:[{labelTerms:['a','b'],retrievalTerms:['a','b','c'],spans}]});}}});
    await fill(m,2);assert.equal((await m.maybeRunTopicWorker()).reason,'rejected');assert.equal((await m.listTopics()).length,0);
  }
});
test('failed exchanges never enter indexing and gaps remain separate',async()=>{
  const inputs:number[][]=[]; const m=createIncrementalMemory({storage:new InMemoryStorage(),batchSize:2,topicWorker:worker(inputs)});
  await add(m,'one');const failed=await m.begin('failed secret');await m.failExchange({exchangeId:failed.id,failureReason:'network'});await add(m,'three');
  await m.maybeRunTopicWorker();assert.deepEqual(inputs,[[1,3]]);
});
test('file restart retains coverage, stable IDs and raw evidence; separate files are isolated',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'memory-v03-test-'));
  try{
    const inputs:number[][]=[],path=join(dir,'a.json');
    let m=createIncrementalMemory({storage:new FileMemoryStorage(path),batchSize:2,topicWorker:worker(inputs)});
    await add(m,'Cobalt scarf is violet.');await add(m,'Cobalt shipping on Tuesday.');await m.maybeRunTopicWorker();
    m=createIncrementalMemory({storage:new FileMemoryStorage(path),batchSize:2,topicWorker:worker(inputs)});
    await fill(m,6);await m.maybeRunTopicWorker();assert.deepEqual(inputs,[[1,2],[3,4]]);
    assert.match((await m.retrieve({userMessage:'Cobalt scarf colour?'})).memoryContext,/violet/);
    const isolated=createIncrementalMemory({storage:new FileMemoryStorage(join(dir,'b.json'))});
    assert.equal((await isolated.retrieve({userMessage:'Cobalt scarf colour?'})).memoryContext,'');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('both original and corrected facts are recoverable without replacing raw history',async()=>{
  const m=createIncrementalMemory({storage:new InMemoryStorage()});
  await add(m,'Falcon event budget is 1300.');await fill(m,6);await add(m,'Correction: Falcon event budget is 2100, replacing 1300.');await fill(m,6);
  const r=await m.retrieve({userMessage:'How did the Falcon event budget change?'});
  assert.ok(r.trace.recoveredSequences?.includes(1));assert.ok(r.trace.recoveredSequences?.includes(8));
});
test('unknown facts do not retrieve unrelated records',async()=>{
  const m=createIncrementalMemory({storage:new InMemoryStorage()});await fill(m,20);
  assert.equal((await m.retrieve({userMessage:'What is the dragonfly serial number?'})).memoryContext,'');
});
test('strict memory budget keeps valid exact excerpts with offsets near query matches',async()=>{
  const m=createIncrementalMemory({storage:new InMemoryStorage(),memoryBudget:1400});
  const original='无关背景。'.repeat(2000)+'蓝鹊项目口令是杏林42。'+'补充材料。'.repeat(1000);
  await add(m,original);await fill(m);
  const r=await m.retrieve({userMessage:'蓝鹊项目口令？'});
  assert.ok(r.trace.memoryUnits!<=1400);assert.equal(r.trace.budgetUnit,'utf8-bytes');assert.match(r.memoryContext,/杏林42/);
  const excerpt=JSON.parse(r.openedTopicPackets[0]).user;
  assert.equal(excerpt.text,original.slice(excerpt.start,excerpt.end));assert.equal(excerpt.truncated,true);
});
test('zero budgets disable output/model dispatch without losing storage',async()=>{
  let calls=0;const m=createIncrementalMemory({storage:new InMemoryStorage(),batchSize:1,workerBudget:0,memoryBudget:0,recentBudget:0,topicWorker:{async complete(){calls++;return '';}}});
  await add(m,'Koala key is 712.');
  assert.equal((await m.maybeRunTopicWorker()).reason,'budget_gate');assert.equal(calls,0);
  const r=await m.retrieve({userMessage:'Koala key?'});assert.equal(r.memoryContext,'');assert.deepEqual(r.recentContext,[]);assert.equal((await m.listExchanges()).length,1);
});
test('selector cannot invent records; failure falls back and lifetime calls are bounded',async()=>{
  let calls=0;const m=createIncrementalMemory({storage:new InMemoryStorage(),maxSelectorCalls:1,selector:{async complete(){calls++;return '{"sequences":[9999]}';}}});
  await add(m,'Cerulean flight takes three hours.');await fill(m);
  const query='Cerulean flight departure runway luggage ticket weather?';
  const r=await m.retrieve({userMessage:query});assert.equal(r.trace.strategy,'local-fallback');assert.match(r.trace.selectorError!,/invalid evidence/);
  await m.retrieve({userMessage:query});assert.equal(calls,1);
});
test('date filters use record timestamps, not dates mentioned in text',async()=>{
  const m=createIncrementalMemory({storage:new InMemoryStorage()});
  await add(m,'Pearl appointment is next week.',new Date(2026,0,1,12).getTime());await fill(m);
  const r=await m.retrieve({userMessage:'2026-01-02 Pearl appointment?'});assert.equal(r.memoryContext,'');
  const f=timeFilter('yesterday',new Date(2026,0,2,12).getTime())!;assert.equal(f.start,new Date(2026,0,1).getTime());
});
test('custom token counter is respected and bad configurations rejected',()=>{
  const b=new TextBudget(s=>s.length);assert.equal(b.unit,'tokens');assert.ok(b.count(b.clip('😀'.repeat(30),13))<=13);
  assert.throws(()=>createIncrementalMemory({storage:new InMemoryStorage(),batchSize:0}));
  assert.throws(()=>new TextBudget(()=>NaN).count('x'));
});
test('completed records cannot be edited silently after indexing',async()=>{
  const m=createIncrementalMemory({storage:new InMemoryStorage()});const e=await add(m,'original');
  await assert.rejects(m.completeExchange({exchangeId:e.id,assistantText:'replacement'}),/immutable/);
});
