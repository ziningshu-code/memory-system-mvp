import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {installCodex} from '../integrations/runtime/install-codex.mjs';
import {drainReadyBatches} from '../integrations/runtime/index-jobs.mjs';
const cli=resolve('integrations/runtime/cli.mjs');
function run(args,input,env,cwd){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,...args],{env:{...process.env,...env},cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);
  child.once('close',code=>code===0?resolve(out):reject(new Error(err)));child.stdin.end(input??'');
});}
test('native hooks capture exact text, persist across processes, deduplicate, and isolate projects',async()=>{
  const root=await mkdtemp(join(tmpdir(),'topic-native-')),a=join(root,'project-a'),b=join(root,'project-b');await mkdir(a);await mkdir(b);
  const env={TOPIC_MEMORY_HOME:join(root,'data')},event={cwd:a,session_id:'s',turn_id:'t'};
  const start=JSON.parse(await run(['hook'],JSON.stringify({...event,hook_event_name:'UserPromptSubmit',prompt:'原话😀 14000'}),env,a));assert.deepEqual(start,{});
  const stop=JSON.stringify({...event,hook_event_name:'Stop',last_assistant_message:'实际回复'});await run(['hook'],stop,env,a);await run(['hook'],stop,env,a);
  const reminder=JSON.parse(await run(['hook'],JSON.stringify({...event,turn_id:'next',hook_event_name:'UserPromptSubmit',prompt:'我们之前说的原话是什么？'}),env,a));
  assert.match(reminder.hookSpecificOutput.additionalContext,/memory_search/);
  assert.ok(reminder.hookSpecificOutput.additionalContext.length<200);
  assert.equal(JSON.parse(await run(['status'],'',env,a)).exchanges,1);assert.equal(JSON.parse(await run(['status'],'',env,b)).exchanges,0);
  const dirs=await readdir(join(root,'data','projects'));let records=[];for(const dir of dirs){try{records.push(...JSON.parse(await readFile(join(root,'data','projects',dir,'memory.json'),'utf8')).exchanges);}catch{}}
  assert.equal(records[0].userText,'原话😀 14000');assert.equal(records[0].assistantText,'实际回复');
});
test('automatic index drains ready accepted batches and stops at the first gate or failure',async()=>{
  const reasons=['accepted','accepted','batch_gate'];const calls=[];
  const memory={async index(options){calls.push(options);return {ran:reasons[0]==='accepted',reason:reasons.shift()};}};
  const result=await drainReadyBatches(memory,{auto:true});
  assert.equal(result.acceptedBatches,2);assert.equal(result.last.reason,'batch_gate');assert.equal(result.hitLimit,false);
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.flush===false));
  const failed=[];const stop=await drainReadyBatches({async index(){failed.push(1);return {ran:true,reason:'failed'};}},{auto:true});
  assert.equal(stop.acceptedBatches,0);assert.equal(failed.length,1);
});
test('automatic index has a per-job cap; explicit index remains a single batch',async()=>{
  let calls=0;const memory={async index(){calls++;return {ran:true,reason:'accepted'};}};
  const auto=await drainReadyBatches(memory,{auto:true,maxBatches:3});
  assert.equal(auto.acceptedBatches,3);assert.equal(auto.hitLimit,true);assert.equal(calls,3);
  const manual=await drainReadyBatches(memory,{auto:false,retry:true});
  assert.equal(manual.acceptedBatches,1);assert.equal(calls,4);
});
test('MCP handshake, tool discovery, empty search and validation work without a configured model',async()=>{
  const root=await mkdtemp(join(tmpdir(),'topic-mcp-')),env={TOPIC_MEMORY_HOME:join(root,'data')};
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},
    {jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'memory_search',arguments:{query:'old decision'}}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'memory_open',arguments:{topicIds:['../foreign']}}}];
  const responses=(await run(['mcp'],messages.map(m=>JSON.stringify(m)).join('\n')+'\n',env,root)).trim().split('\n').map(JSON.parse);
  assert.equal(responses.length,4);assert.equal(responses[0].result.serverInfo.name,'topic-memory');assert.equal(responses[1].result.tools.length,2);
  assert.equal(JSON.parse(responses[2].result.content[0].text).trace.selectorCalls,0);assert.equal(responses[3].result.isError,true);
});
test('parallel host sessions retain separate exchanges with unique sequence numbers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'topic-concurrent-')),env={TOPIC_MEMORY_HOME:join(root,'data')};
  await Promise.all([1,2,3].map(async n=>{const event={cwd:root,session_id:`s${n}`,turn_id:`t${n}`};
    await run(['hook'],JSON.stringify({...event,hook_event_name:'UserPromptSubmit',prompt:`q${n}`}),env,root);
    await run(['hook'],JSON.stringify({...event,hook_event_name:'Stop',last_assistant_message:`a${n}`}),env,root);
  }));
  assert.equal(JSON.parse(await run(['status'],'',env,root)).exchanges,3);
  const [dir]=await readdir(join(root,'data','projects'));const state=JSON.parse(await readFile(join(root,'data','projects',dir,'memory.json'),'utf8'));
  assert.deepEqual(state.exchanges.map(r=>r.sequence).sort(),[1,2,3]);
});

test('Codex installer preserves existing marketplace entries and registers an idempotent local bundle',async()=>{
  const home=await mkdtemp(join(tmpdir(),'topic-install-')),market=join(home,'.agents','plugins','marketplace.json');
  await mkdir(join(home,'.agents','plugins'),{recursive:true});
  const unrelated={name:'other-tool',source:{source:'local',path:'./plugins/other-tool'}};
  await writeFile(market,JSON.stringify({name:'personal',plugins:[unrelated]}));
  const calls=[];const run=async value=>calls.push(value);
  await installCodex({home,run});await installCodex({home,run});
  const result=JSON.parse(await readFile(market,'utf8'));
  assert.deepEqual(result.plugins[0],unrelated);assert.equal(result.plugins.length,2);
  assert.deepEqual(calls,['topic-memory@personal','topic-memory@personal']);
  const mcp=JSON.parse(await readFile(join(home,'plugins','topic-memory','.mcp.json'),'utf8'));
  assert.equal(mcp.mcpServers['topic-memory'].args[0],join(home,'plugins','topic-memory','integrations','runtime','cli.mjs'));
  assert.ok((await readFile(join(home,'plugins','topic-memory','dist','index.js'),'utf8')).includes('createTopicMemory'));
});

test('Codex installer refuses to overwrite a foreign destination',async()=>{
  const home=await mkdtemp(join(tmpdir(),'topic-install-conflict-')),target=join(home,'plugins','topic-memory');
  await mkdir(target,{recursive:true});await writeFile(join(target,'keep.txt'),'untouched');
  await assert.rejects(installCodex({home,run:async()=>assert.fail('Must not register')}),/not owned/);
  assert.equal(await readFile(join(target,'keep.txt'),'utf8'),'untouched');
  await assert.rejects(readFile(join(home,'.agents','plugins','marketplace.json')),e=>e.code==='ENOENT');
});
