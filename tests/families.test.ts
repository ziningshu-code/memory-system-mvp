import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTopicMemory,InMemoryStorage,type TopicMemoryOptions,type CanonicalTopic,type MemoryLlmRequest} from '../src/index.js';
import {FileMemoryStorage} from '../src/node.js';
import {familyViews,rankFamilies} from '../src/families.js';

function fixture(options:Partial<TopicMemoryOptions>={}){
  const calls:MemoryLlmRequest[]=[],outputs:string[]=[];
  const storage=options.storage??new InMemoryStorage();
  const llm={async complete(r:MemoryLlmRequest){calls.push(r);const value=outputs.shift();if(value===undefined)throw new Error('Unexpected inference');return value;}};
  const memory=createTopicMemory({storage,llm,batchSize:2,now:()=>2000000000000,...options});
  const add=(n:number,text:string)=>memory.append({sourceId:`r${n}`,userText:text,assistantText:`ack ${n}`,userSentAt:1700000000000+n*3600000,assistantCompletedAt:1700000000100+n*3600000});
  const index=async(topics:unknown[],assignments:unknown[])=>{
    const rows=await storage.listExchanges();const links:unknown[]=[];
    topics.forEach((value,i)=>{const t=value as ReturnType<typeof topic>,a=(assignments as Array<{topicIndex:number;sequence:number}>).find(a=>a.topicIndex===i),r=rows.find(r=>r.sequence===a?.sequence);
      if(!r)return;const evidence={fromTopic:i,sequence:r.sequence,quote:r.userText.slice(0,240)};
      if(t.familyId)links.push({...evidence,toFamily:t.familyId,kind:'same_event'});
      for(const id of t.relatedFamilyIds??[])links.push({...evidence,toFamily:id,kind:'related'});
    });
    outputs.push(JSON.stringify({topics,assignments,links}));return memory.index({flush:true});
  };
  return {storage,memory,calls,outputs,add,index};
}
const topic=(scope:string,familyId:string|null=null,relatedFamilyIds:string[]=[])=>({familyId,scope,labelTerms:[scope],retrievalTerms:[scope],relatedFamilyIds});
const assignment=(sequence:number,topicIndex=0,change='addition')=>({sequence,topicIndex,change});
function segment(id:string,family:string,sequence:number,labels:string,time=1700000000000):CanonicalTopic{
  return {topicId:id,status:'finalized',labelTerms:[labels],retrievalTerms:[labels],spans:[{startSequence:sequence,endSequence:sequence}],startedAt:time,endedAt:time+1,updatedAt:time,source:'topic_worker_v2',
    family:{id:family,scope:labels,relatedIds:[],changes:[{sequence,kind:'addition'}]}};
}

test('a revised plan adds an immutable segment to its family; a related plan stays separate',async()=>{
  const f=fixture();await f.add(1,'October Tokyo hotel Maple Ueno 14000 yen');await f.add(2,'October Tokyo needs a desk');
  assert.equal((await f.index([topic('October Tokyo trip')],[assignment(1),assignment(2)])).reason,'accepted');
  const [frozen]=await f.storage.listTopics(),id=frozen.family!.id;
  await f.add(3,'October Tokyo hotel changed to Cedar Asakusa 16500 yen');await f.add(4,'Separate November Tokyo trip: Maple Ueno 16000 yen');
  assert.equal((await f.index([topic('ignored renamed scope',id),topic('November Tokyo trip',null,[id])],[assignment(3,0,'revision'),assignment(4,1)])).reason,'accepted');
  const all=await f.storage.listTopics();assert.deepEqual(all[0],frozen);
  assert.equal(all[1].family!.id,id);assert.equal(all[1].family!.scope,'October Tokyo trip');
  assert.notEqual(all[2].family!.id,id);assert.deepEqual(all[2].family!.relatedIds,[id]);
  assert.equal((await f.memory.status()).families,2);
  const [p]=await f.memory.open([id]);assert.deepEqual(p.text.split('\n').map(l=>JSON.parse(l).sequence),[1,2,3]);
  assert.equal(p.text.includes('16000'),false);assert.equal(p.text.includes('14000'),true);assert.equal(p.text.includes('16500'),true);
});

test('worker retrieves a relevant old family beyond the last eight segments without sending old originals',async()=>{
  const f=fixture({workerCandidateFamilies:3});await f.add(1,'Atlas migration redaction private original');
  await f.index([topic('Atlas migration')],[assignment(1)]);const [old]=await f.storage.listTopics();
  await f.storage.replaceTopics([old,...Array.from({length:15},(_,i)=>segment(`s${i}`,`f${i}`,100+i,`unrelated${i}`))]);
  await f.add(2,'Atlas migration redaction is now mandatory');
  await f.index([topic('Atlas migration',old.family!.id)],[assignment(2,0,'revision')]);
  const request=JSON.parse(f.calls[1].user);
  assert.ok(request.candidateFamilies.some((c:{familyId:string})=>c.familyId===old.family!.id));
  assert.equal(f.calls[1].user.includes('private original'),false);assert.deepEqual(request.records.map((r:{sequence:number})=>r.sequence),[2]);
});

for(const [name,topics,assignments] of [
  ['foreign family',[topic('trip','foreign')],[assignment(1)]],
  ['missing membership',[{labelTerms:['trip'],retrievalTerms:['trip']}],[assignment(1)]],
  ['foreign relation',[topic('trip',null,['foreign'])],[assignment(1)]],
  ['invalid change',[topic('trip')],[assignment(1,0,'replace-everything')]],
] as const)test(`family protocol rejects ${name} without losing originals or automatically retrying`,async()=>{
  const f=fixture();await f.add(1,'original 😀');f.outputs.push(JSON.stringify({topics,assignments}));
  assert.equal((await f.memory.index({flush:true})).reason,'rejected');
  assert.equal((await f.memory.index({flush:true})).reason,'unchanged_input');assert.equal(f.calls.length,1);
  assert.equal((await f.storage.listTopics()).length,0);assert.ok((await f.memory.open(['pending_1']))[0].text.includes('original 😀'));
});

test('separate new cards can join one existing family through grounded links without rewriting old cards',async()=>{
  const f=fixture();await f.add(1,'Atlas');await f.index([topic('Atlas')],[assignment(1)]);const [t]=await f.storage.listTopics();
  await f.add(2,'Atlas details');await f.add(3,'Atlas correction');
  assert.equal((await f.index([topic('Atlas',t.family!.id),topic('Atlas',t.family!.id)],[assignment(2),assignment(3,1)])).reason,'accepted');
  const all=await f.storage.listTopics();assert.deepEqual(all[0],t);assert.ok(all.every(s=>s.family!.id===t.family!.id));
  assert.equal((await f.memory.status()).pendingExchanges,0);
});

test('scope equality alone cannot silently merge different records',async()=>{
  const f=fixture();await f.add(1,'Atlas migration');await f.index([topic('Atlas migration')],[assignment(1)]);
  const frozen=await f.storage.listTopics();await f.add(2,'Atlas migration adds a rollback requirement');
  const result=await f.index([topic('  ATLAS   migration  ')],[assignment(2)]);
  assert.equal(result.reason,'accepted');const all=await f.storage.listTopics();assert.deepEqual(all[0],frozen[0]);
  assert.notEqual(all[0].family!.id,all[1].family!.id);assert.equal(f.calls.length,2);
});

test('selector sees compact candidates; returned originals include only the chosen family',async()=>{
  const f=fixture();await f.add(1,'Tokyo secret exact original');await f.add(2,'Osaka different original');
  await f.index([topic('Tokyo'),topic('Osaka')],[assignment(1),assignment(2,1)]);
  const id=(await f.storage.listTopics())[0].family!.id;
  f.outputs.push(JSON.stringify({familyIds:[id],inspect:false,order:'earliest'}));
  const result=await f.memory.recall({query:'Tokyo original'});
  assert.equal(result.trace.selectorCalls,1);assert.equal(result.trace.error,null);
  assert.equal(f.calls[1].user.includes('secret exact original'),false);assert.ok(result.evidence[0].text.includes('secret exact original'));
  assert.equal(result.evidence[0].text.includes('Osaka different original'),false);
});

test('latest and earliest family evidence paginate losslessly with an explicit stable order',async()=>{
  const f=fixture({memoryBudget:600});await f.add(1,'old😀'.repeat(100));await f.add(2,'new😀'.repeat(100));
  await f.index([topic('trip')],[assignment(1),assignment(2,0,'revision')]);const id=(await f.storage.listTopics())[0].family!.id;
  for(const order of ['earliest','latest'] as const){
    let text='',offset:number|null=0,loops=0;
    do{const [p]=await f.memory.open([id],offset,order);assert.ok(Buffer.byteLength(JSON.stringify([p]))<=600);assert.equal(p.order,order);text+=p.text;offset=p.nextOffset;assert.ok(++loops<50);}while(offset!==null);
    const rows=text.split('\n').map(s=>JSON.parse(s));assert.deepEqual(rows.map(r=>r.sequence),order==='earliest'?[1,2]:[2,1]);
    assert.equal(rows.find(r=>r.sequence===1).user,'old😀'.repeat(100));assert.equal(rows.find(r=>r.sequence===2).user,'new😀'.repeat(100));
  }
});

test('family paging does not discard no-overlap candidates or claim archive completeness',async()=>{
  const f=fixture({candidateFamilies:2});await f.storage.replaceTopics(Array.from({length:5},(_,i)=>segment(`s${i}`,`f${i}`,i+1,`subject${i}`)));
  const ids:string[]=[];let offset:number|null=0;
  do{const p=await f.memory.familyDirectory('meaning without literal overlap',offset);ids.push(...p.cards.map(c=>c.familyId));offset=p.nextDirectoryOffset;}while(offset!==null);
  assert.equal(new Set(ids).size,5);
  f.outputs.push(JSON.stringify({familyIds:[],inspect:false}));const result=await f.memory.recall({query:'meaning without literal overlap'});
  assert.equal(result.complete,false);assert.equal(result.nextDirectoryOffset,2);assert.equal(result.trace.remainingFamilies,3);
});

test('raw local search marks an omitted detail without copying the original into the directory',async()=>{
  const f=fixture({candidateFamilies:1});await f.add(1,'Hotel booking reference ZX9837');await f.add(2,'garden flowers');
  await f.index([topic('lodging'),topic('garden')],[assignment(1),assignment(2,1)]);
  const id=(await f.storage.listTopics())[0].family!.id;
  const p=await f.memory.familyDirectory('ZX9837');assert.equal(p.cards[0].familyId,id);assert.equal(p.cards[0].originalKeywordMatch,true);assert.equal(JSON.stringify(p.cards).includes('ZX9837'),false);
});

test('a broad family opens a middle matching original first without losing full archive paging',async()=>{
  const f=fixture({memoryBudget:900});
  for(let n=1;n<=100;n++)await f.storage.putExchange({id:`long-${n}`,sequence:n,
    userText:n===50?'The notebook recovery phrase is BLUE-ORBIT-5847.':`Notebook routine entry ${n}.`,
    assistantText:`Recorded entry ${n}.`,userSentAt:1700000000000+n*3600000,
    assistantCompletedAt:1700000000100+n*3600000,status:'completed',failureReason:null,source:'live'});
  const wide=segment('wide','wide',1,'notebook');
  wide.spans=[{startSequence:1,endSequence:100}];wide.endedAt=1700000000100+100*3600000;
  await f.storage.replaceTopics([wide]);
  f.outputs.push(JSON.stringify({familyIds:['wide'],inspect:false,order:'earliest'}));
  const found=await f.memory.recall({query:'What was the notebook recovery phrase?'});
  assert.equal(found.trace.error,null);assert.equal(found.evidence.length,1);
  assert.equal(found.trace.selectorCalls,1);assert.equal(f.calls.length,1);
  assert.ok(!f.calls[0].user.includes('The notebook recovery phrase is'));
  assert.ok(found.evidence[0].text.includes('BLUE-ORBIT-5847'));
  assert.ok(found.evidence[0].offset>0);assert.equal(found.evidence[0].unreadPrefix,true);
  assert.equal(found.complete,false);
  async function allFrom(offset:number){
    let text='',next:number|null=offset,steps=0;
    while(next!==null){const [page]=await f.memory.open(['wide'],next,'earliest');text+=page.text;next=page.nextOffset;assert.ok(++steps<100);}
    return text;
  }
  const full=await allFrom(0),suffix=await allFrom(found.evidence[0].offset);
  assert.deepEqual(full.split('\n').map(line=>JSON.parse(line).sequence),Array.from({length:100},(_,i)=>i+1));
  assert.equal(suffix,full.slice(found.evidence[0].offset));
  f.outputs.push(JSON.stringify({familyIds:['wide'],inspect:false,order:'earliest'}));
  const first=await f.memory.recall({query:'What was the first notebook entry?'});
  assert.equal(first.evidence[0].offset,0);assert.equal(first.evidence[0].unreadPrefix,undefined);
  assert.ok(first.evidence[0].text.includes('Notebook routine entry 1.'));
  f.outputs.push(JSON.stringify({familyIds:['wide'],inspect:false,order:'latest'}));
  const latest=await f.memory.recall({query:'What is the latest notebook entry?'});
  assert.equal(latest.evidence[0].offset,0);assert.equal(latest.evidence[0].unreadPrefix,undefined);
  assert.ok(latest.evidence[0].text.includes('Notebook routine entry 100.'));
  f.outputs.push(JSON.stringify({familyIds:['wide'],inspect:false,order:'earliest'}));
  const firstMatch=await f.memory.recall({query:'What was the first notebook recovery phrase?'});
  assert.ok(firstMatch.evidence[0].offset>0);
  assert.ok(firstMatch.evidence[0].text.includes('BLUE-ORBIT-5847'));
  f.outputs.push(JSON.stringify({familyIds:['wide'],inspect:false,order:'latest'}));
  const latestMatch=await f.memory.recall({query:'What was the latest notebook recovery phrase?'});
  assert.ok(latestMatch.evidence[0].offset>0);
  assert.ok(latestMatch.evidence[0].text.includes('BLUE-ORBIT-5847'));
  f.outputs.push(JSON.stringify({familyIds:['wide'],inspect:false,order:'earliest'}));
  const comparison=await f.memory.recall({query:'Compare the original and revised notebook entries.'});
  assert.equal(comparison.evidence.length,2);
  assert.equal(comparison.evidence[0].order,'earliest');
  assert.equal(comparison.evidence[1].order,'latest');
  assert.ok(comparison.evidence[0].text.includes('Notebook routine entry 1.'));
  assert.ok(comparison.evidence[1].text.includes('Notebook routine entry 100.'));
  assert.ok(comparison.trace.evidenceUnits<=900);
});

test('interleaved family spans cannot crowd matched original text out of evidence budget',async()=>{
  const f=fixture({memoryBudget:900});
  for(let n=1;n<=200;n++)await f.storage.putExchange({id:`interleaved-${n}`,sequence:n,
    userText:n===101?'Notebook recovery phrase: SILVER-COMET-29.':
      n%2?`Notebook note ${n}.`:`Unrelated garden note ${n}.`,
    assistantText:`Acknowledged ${n}.`,userSentAt:1700000000000+n*3600000,
    assistantCompletedAt:1700000000100+n*3600000,status:'completed',failureReason:null,source:'live'});
  const notebook=segment('notebook','notebook',1,'notebook'),garden=segment('garden','garden',2,'garden');
  notebook.spans=Array.from({length:100},(_,i)=>({startSequence:i*2+1,endSequence:i*2+1}));
  garden.spans=Array.from({length:100},(_,i)=>({startSequence:i*2+2,endSequence:i*2+2}));
  await f.storage.replaceTopics([notebook,garden]);
  f.outputs.push(JSON.stringify({familyIds:['notebook'],inspect:false,order:'earliest'}));
  const result=await f.memory.recall({query:'What was the notebook recovery phrase?'});
  assert.equal(result.trace.error,null);
  assert.ok(result.evidence[0].text.includes('SILVER-COMET-29'));
  assert.equal(result.evidence[0].spansOmitted,true);
  assert.equal(result.evidence[0].spanCount,100);
  assert.deepEqual(result.evidence[0].spans,[]);
  assert.ok(result.trace.evidenceUnits<=900);
  const [fromStart]=await f.memory.open(['notebook']);
  assert.equal(fromStart.offset,0);
  assert.equal(fromStart.spansOmitted,true);
});

test('recency, length and recurrence cannot promote an unrelated family over an exact older match',async()=>{
  const now=2000000000000,old=segment('old','old',1,'passport replacement Quito',1000000000000);
  const popular=Array.from({length:40},(_,i)=>segment(`new${i}`,'popular',i+2,'garden watering',now-i*86400000));
  const ranked=await rankFamilies('Quito passport',[old,...popular],[],now);
  assert.equal(ranked.ranked[0].family.familyId,'old');assert.equal(ranked.ranked[1].relevance,0);
});

test('batch boundaries alone do not count as recurring conversations',()=>{
  const base=1700000000000;
  const [view]=familyViews([segment('a','f',1,'trip',base),segment('b','f',2,'trip',base+1000),segment('c','f',3,'trip',base+3600000)]);
  assert.equal(view.occurrences,2);assert.equal(view.turnCount,3);
});

test('optional card vectors survive file-storage restart and reuse without re-embedding originals',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'topic-family-')),store=new FileMemoryStorage(join(dir,'memory.json'));
  const calls:Array<{texts:string[];kind:string}>=[];
  const embedding={id:'test/model/2',async embed(texts:string[],kind:'passage'|'query'){calls.push({texts,kind});return texts.map(()=>[1,0]);}};
  const f=fixture({storage:store,embedding});await f.add(1,'secret original paragraph');await f.index([topic('Tokyo')],[assignment(1)]);
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'passage');assert.equal(calls[0].texts[0].includes('secret'),false);
  const restarted=fixture({storage:new FileMemoryStorage(join(dir,'memory.json')),embedding});
  const page=await restarted.memory.familyDirectory('Japan accommodation');
  assert.equal(page.embeddingCalls,1);assert.equal(page.embeddingError,null);assert.equal(calls.length,2);assert.equal(calls[1].kind,'query');
  assert.equal(page.cards.length,1);
});

test('embedding failure preserves accepted index and falls back explicitly at query time',async()=>{
  let fail=false;
  const embedding={id:'test/model/2',async embed(texts:string[]){if(fail)throw new Error('offline');return texts.map(()=>[1,0]);}};
  const f=fixture({embedding});await f.add(1,'Tokyo');await f.index([topic('Tokyo')],[assignment(1)]);
  fail=true;await f.add(2,'Osaka');const result=await f.index([topic('Osaka')],[assignment(2)]);
  assert.equal(result.reason,'accepted');assert.ok(result.run!.warnings!.length>0);
  const page=await f.memory.familyDirectory('Tokyo');assert.ok(page.embeddingError);assert.equal(page.cards[0].scope,'Tokyo');
  assert.equal((await f.memory.status()).pendingExchanges,0);
});

test('dimension changes trigger a visible lexical fallback rather than mixing incompatible vectors',async()=>{
  let dimension=2;
  const embedding={id:'same-provider-identity',async embed(texts:string[]){return texts.map(()=>Array(dimension).fill(1));}};
  const f=fixture({embedding});await f.add(1,'Tokyo');await f.index([topic('Tokyo')],[assignment(1)]);dimension=3;
  const page=await f.memory.familyDirectory('Tokyo');assert.ok(page.embeddingError);assert.equal(page.cards.length,1);
});

test('existing archives are readable and can acquire new segments without rewriting legacy cards',async()=>{
  const f=fixture();await f.add(1,'legacy Tokyo');const old=segment('legacy','temporary',1,'Tokyo');delete old.family;
  await f.storage.replaceTopics([old]);await f.add(2,'Tokyo update');
  assert.equal((await f.index([topic('Tokyo','legacy')],[assignment(2,0,'revision')])).reason,'accepted');
  assert.deepEqual((await f.storage.listTopics())[0],old);
  const [p]=await f.memory.open(['legacy']);assert.deepEqual(p.text.split('\n').map(s=>JSON.parse(s).sequence),[1,2]);
});

test('extra short labels are folded without losing text; over-budget keywords remain rejected',async()=>{
  const f=fixture();await f.add(1,'青鸟项目 UTF-8 导出文件 列顺序 文件名');
  const labels=['青鸟项目','导出文件','UTF-8','列顺序','文件名'];
  assert.equal((await f.index([{...topic('青鸟项目'),labelTerms:labels}],[assignment(1)])).reason,'accepted');
  const [stored]=await f.storage.listTopics();assert.equal(stored.labelTerms.length,4);
  for(const label of labels)assert.ok(stored.labelTerms.join(' ').includes(label));
  await f.add(2,'new');assert.equal((await f.index([{...topic('new'),labelTerms:Array.from({length:5},(_,i)=>String(i)+'长'.repeat(100))}],[assignment(2)])).reason,'rejected');
  assert.equal((await f.storage.listTopics()).length,1);assert.equal((await f.memory.status()).pendingExchanges,1);
});
