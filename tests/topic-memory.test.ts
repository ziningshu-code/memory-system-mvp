import test from 'node:test';
import assert from 'node:assert/strict';
import {createTopicMemory,InMemoryStorage} from '../src/index.js';
import type {MemoryLlmRequest} from '../src/types.js';

function fixture(options:Record<string,number>={}) {
  const calls:MemoryLlmRequest[]=[],outputs:string[]=[];
  const storage=new InMemoryStorage();
  const llm={async complete(r:MemoryLlmRequest){calls.push(r);const out=outputs.shift();if(!out)throw new Error('Unexpected model call');return out;}};
  const memory=createTopicMemory({storage,llm,familyMode:false,...options});
  const add=async(n:number,text=`user ${n}`)=>memory.append({sourceId:`r${n}`,userText:text,assistantText:`answer ${n}`,userSentAt:n*1000,assistantCompletedAt:n*1000+1});
  const index=(start:number,end:number)=>JSON.stringify({topics:[{labelTerms:['Tokyo lodging'],retrievalTerms:['Ueno','budget'],spans:[{startSequence:start,endSequence:end}],relatedTopicIds:[]}]});
  return{calls,outputs,storage,memory,add,index};
}
test('capture performs no inference; index uses batches and never rereads committed originals',async()=>{
  const f=fixture({batchSize:2});await f.add(1);assert.equal((await f.memory.index()).ran,false);assert.equal(f.calls.length,0);
  await f.add(2);f.outputs.push(f.index(1,2));assert.equal((await f.memory.index()).reason,'accepted');
  const frozen=await f.storage.listTopics();await f.add(3);await f.add(4);f.outputs.push(f.index(3,4));await f.memory.index();
  assert.deepEqual((await f.storage.listTopics())[0],frozen[0]);assert.deepEqual(JSON.parse(f.calls[1].user).records.map((r:{sequence:number})=>r.sequence),[3,4]);
  assert.equal((await f.memory.index()).ran,false);assert.equal(f.calls.length,2);
});
test('directory-only selection sends originals only to the caller',async()=>{
  const f=fixture();await f.add(1,'EXACT_PRIVATE_ORIGINAL_预算14000');f.outputs.push(f.index(1,1));await f.memory.index({flush:true});
  const [t]=await f.storage.listTopics();f.outputs.push(JSON.stringify({topicIds:[t.topicId],inspect:false}));
  const r=await f.memory.recall({query:'住宿费用是多少'});
  assert.equal(r.trace.selectorCalls,1);assert.equal(f.calls[1].user.includes('EXACT_PRIVATE_ORIGINAL'),false);
  assert.ok(r.evidence[0].text.includes('EXACT_PRIVATE_ORIGINAL_预算14000'));assert.equal(r.evidence[0].startedAt,1000);
});
test('ambiguous directory selection inspects only selected originals',async()=>{
  const f=fixture();await f.add(1,'target');await f.add(2,'UNRELATED_SECRET');f.outputs.push(JSON.stringify({topics:[
    {labelTerms:['target'],retrievalTerms:['first'],spans:[{startSequence:1,endSequence:1}]},
    {labelTerms:['other'],retrievalTerms:['second'],spans:[{startSequence:2,endSequence:2}]}]}));await f.memory.index({flush:true});
  const [t]=await f.storage.listTopics();f.outputs.push(JSON.stringify({topicIds:[t.topicId],inspect:true}),JSON.stringify({topicIds:[t.topicId]}));
  const r=await f.memory.recall({query:'target'});assert.equal(r.trace.selectorCalls,2);assert.equal(f.calls[2].user.includes('UNRELATED_SECRET'),false);
});
test('invalid worker spans are rejected atomically and not automatically retried',async()=>{
  const f=fixture();await f.add(1);f.outputs.push(f.index(1,2));assert.equal((await f.memory.index({flush:true})).reason,'rejected');
  assert.equal((await f.storage.listTopics()).length,0);assert.equal((await f.memory.index({flush:true})).ran,false);assert.equal(f.calls.length,1);
});
test('retry explicitly accepts a corrected worker response',async()=>{
  const f=fixture();await f.add(1);f.outputs.push('{}');await f.memory.index({flush:true});f.outputs.push(f.index(1,1));
  assert.equal((await f.memory.index({flush:true,retryFailed:true})).reason,'accepted');
});
test('repeated source ID is idempotent and differing originals cannot overwrite it',async()=>{
  const f=fixture();await f.add(1);await f.add(1);assert.equal((await f.memory.status()).exchanges,1);
  await assert.rejects(f.add(1,'changed'),/immutable/);
});
test('invalid selector ID fails explicitly without opening foreign evidence',async()=>{
  const f=fixture();await f.add(1);f.outputs.push(f.index(1,1));await f.memory.index({flush:true});f.outputs.push('{"topicIds":["foreign"],"inspect":false}');
  const r=await f.memory.recall({query:'test'});assert.ok(r.trace.error);assert.equal(r.complete,false);assert.equal(r.evidence.length,0);
});
test('long originals are recoverable exactly through bounded Unicode-safe pages',async()=>{
  const f=fixture({memoryBudget:600});await f.add(1,'😀汉字'.repeat(200));
  const source=(await f.memory.open(['pending_1']))[0];let text=source.text,offset=source.nextOffset,loops=0;
  while(offset!==null){const [page]=await f.memory.open(['pending_1'],offset);assert.ok(Buffer.byteLength(JSON.stringify([page]))<=600);text+=page.text;offset=page.nextOffset;assert.ok(++loops<100);}
  const parsed=JSON.parse(text);assert.equal(parsed.user,'😀汉字'.repeat(200));assert.equal(text.length,source.totalCharacters);
});
test('unindexed oversized originals are not marked indexed and remain accessible',async()=>{
  const f=fixture({workerBudget:1400});await f.add(1,'x'.repeat(10000));assert.equal((await f.memory.index({flush:true})).reason,'budget_gate');
  assert.equal((await f.memory.status()).pendingExchanges,1);assert.ok((await f.memory.open(['pending_1']))[0].text.includes('xxxxx'));assert.equal(f.calls.length,0);
});
test('directory pagination is explicit; no lexical prefilter silently drops a topic',async()=>{
  const f=fixture({directoryBudget:350});for(let i=1;i<=4;i++)await f.add(i);
  const first=await f.memory.directory();assert.notEqual(first.nextDirectoryOffset,null);
  f.outputs.push('{"topicIds":[],"inspect":false}');const r=await f.memory.recall({query:'paraphrase without lexical overlap'});assert.equal(r.complete,false);assert.equal(r.nextDirectoryOffset,first.nextDirectoryOffset);
  const ids=first.cards.map(c=>c.topicId);let offset=first.nextDirectoryOffset;
  while(offset!==null){const p=await f.memory.directory(offset);ids.push(...p.cards.map(c=>c.topicId));offset=p.nextDirectoryOffset;}
  assert.deepEqual(ids,['pending_1','pending_2','pending_3','pending_4']);
});
test('interleaved spans recover selected exchanges without intervening topics',async()=>{
  const f=fixture();for(let i=1;i<=4;i++)await f.add(i);
  f.outputs.push(JSON.stringify({topics:[{labelTerms:['A'],retrievalTerms:['A'],spans:[{startSequence:1,endSequence:1},{startSequence:3,endSequence:3}]},
    {labelTerms:['B'],retrievalTerms:['B'],spans:[{startSequence:2,endSequence:2},{startSequence:4,endSequence:4}]}]}));await f.memory.index({flush:true});
  const [t]=await f.storage.listTopics();const [p]=await f.memory.open([t.topicId]);assert.deepEqual(p.text.split('\n').map(l=>JSON.parse(l).sequence),[1,3]);
});
test('original and revised cards both remain available and linked without rewriting',async()=>{
  const f=fixture();await f.add(1);f.outputs.push(f.index(1,1));await f.memory.index({flush:true});const [old]=await f.storage.listTopics();
  await f.add(2);const next=JSON.parse(f.index(2,2));next.topics[0].relatedTopicIds=[old.topicId];f.outputs.push(JSON.stringify(next));await f.memory.index({flush:true});
  const topics=await f.storage.listTopics();assert.deepEqual(topics[0],old);assert.deepEqual(topics[1].relatedTopicIds,[old.topicId]);
});

const assignmentCard=(name:string)=>({labelTerms:[name],retrievalTerms:[name],relatedTopicIds:[] as string[]});
const assignments=(indexes:number[],start=1)=>indexes.map((topicIndex,i)=>({sequence:start+i,topicIndex}));
test('explicit assignments preserve interleaved originals and derive disjoint spans',async()=>{
  const f=fixture();for(let i=1;i<=8;i++)await f.add(i);
  const originals=await f.storage.listExchanges();
  f.outputs.push(JSON.stringify({topics:[assignmentCard('lodging'),assignmentCard('coding')],assignments:assignments([0,1,0,1,1,0,0,1]).reverse()}));
  assert.equal((await f.memory.index()).reason,'accepted');
  const topics=await f.storage.listTopics();
  const lodging=topics.find(t=>t.labelTerms[0]==='lodging')!;
  assert.deepEqual(lodging.spans,[{startSequence:1,endSequence:1},{startSequence:3,endSequence:3},{startSequence:6,endSequence:7}]);
  const [page]=await f.memory.open([lodging.topicId]);
  assert.deepEqual(page.text.split('\n').map(l=>JSON.parse(l).sequence),[1,3,6,7]);
  assert.equal((await f.memory.status()).pendingExchanges,0);
  assert.deepEqual(await f.storage.listExchanges(),originals);
  assert.equal(f.calls.length,1);
});
test('assignments use actual sequences even with gaps and unordered output',async()=>{
  const f=fixture();for(let i=1;i<=3;i++){const row=await f.add(i);await f.storage.putExchange({...row,sequence:10+i*2});}
  f.outputs.push(JSON.stringify({topics:[assignmentCard('topic')],assignments:[16,12,14].map(sequence=>({sequence,topicIndex:0}))}));
  assert.equal((await f.memory.index({flush:true})).reason,'accepted');
  const [t]=await f.storage.listTopics();
  assert.deepEqual(t.spans,[{startSequence:12,endSequence:12},{startSequence:14,endSequence:14},{startSequence:16,endSequence:16}]);
});
test('new assignment batches preserve old cards, links, and timestamps',async()=>{
  const f=fixture({batchSize:2});await f.add(1);await f.add(2);
  f.outputs.push(JSON.stringify({topics:[assignmentCard('initial')],assignments:assignments([0,0])}));await f.memory.index();
  const [old]=await f.storage.listTopics();await f.add(3);await f.add(4);
  f.outputs.push(JSON.stringify({topics:[{...assignmentCard('revision'),relatedTopicIds:[old.topicId]}],assignments:assignments([0,0],3)}));
  assert.equal((await f.memory.index()).reason,'accepted');const topics=await f.storage.listTopics();
  assert.deepEqual(topics[0],old);assert.deepEqual(topics[1].relatedTopicIds,[old.topicId]);
  assert.deepEqual(topics[1].spans,[{startSequence:3,endSequence:4}]);
  assert.equal(topics[1].startedAt,3000);assert.equal(topics[1].endedAt,4001);
  assert.deepEqual(JSON.parse(f.calls[1].user).records.map((r:{sequence:number})=>r.sequence),[3,4]);
});
for(const [name,badAssignments] of Object.entries({missing:assignments([0],2),extra:assignments([0,0,0],2),negative:assignments([0,-1],2),foreignTopic:assignments([0,1],2),fractional:assignments([0,.5],2),string:[{sequence:2,topicIndex:'0'},{sequence:3,topicIndex:0}],nullValue:null,
  duplicateSequence:[{sequence:2,topicIndex:0},{sequence:2,topicIndex:0}],foreignSequence:assignments([0,0],3),oldSequence:assignments([0,0]),positional:[0,0],nullEntry:[null,{sequence:3,topicIndex:0}]})){
  test(`invalid ${name} assignments preserve committed cards and pending originals without retries`,async()=>{
    const f=fixture({batchSize:2});await f.add(1);f.outputs.push(f.index(1,1));await f.memory.index({flush:true});
    const old=await f.storage.listTopics();await f.add(2);await f.add(3);const originals=await f.storage.listExchanges();
    f.outputs.push(JSON.stringify({topics:[assignmentCard('bad')],assignments:badAssignments}));
    assert.equal((await f.memory.index()).reason,'rejected');
    assert.deepEqual(await f.storage.listTopics(),old);assert.deepEqual(await f.storage.listExchanges(),originals);
    assert.equal((await f.memory.status()).pendingExchanges,2);
    assert.equal((await f.memory.index()).ran,false);assert.equal(f.calls.length,2);
  });
}
test('unused topic cards and mixed assignment/span outputs are rejected',async()=>{
  for(const topics of [[assignmentCard('used'),assignmentCard('unused')],[{...assignmentCard('mixed'),spans:[{startSequence:1,endSequence:2}]}]]){
    const f=fixture();await f.add(1);await f.add(2);f.outputs.push(JSON.stringify({topics,assignments:assignments([0,0])}));
    assert.equal((await f.memory.index({flush:true})).reason,'rejected');assert.equal((await f.storage.listTopics()).length,0);
  }
});
test('previous NVIDIA missing/overlapping spans remain rejected; explicit assignment repair preserves originals',async()=>{
  const f=fixture();for(let i=1;i<=8;i++)await f.add(i);const originals=await f.storage.listExchanges();
  f.outputs.push(JSON.stringify({topics:[
    {...assignmentCard('gaming'),spans:[{startSequence:2,endSequence:4}]},
    {...assignmentCard('coding'),spans:[{startSequence:3,endSequence:8}]},
    {...assignmentCard('dogs'),spans:[{startSequence:6,endSequence:8}]}]}));
  assert.equal((await f.memory.index()).reason,'rejected');assert.equal((await f.memory.index()).ran,false);
  f.outputs.push(JSON.stringify({topics:[assignmentCard('gaming'),assignmentCard('coding'),assignmentCard('dogs')],assignments:assignments([0,0,1,1,1,2,2,2])}));
  assert.equal((await f.memory.index({retryFailed:true})).reason,'accepted');
  assert.deepEqual(await f.storage.listExchanges(),originals);assert.equal((await f.memory.status()).pendingExchanges,0);assert.equal(f.calls.length,2);
});
