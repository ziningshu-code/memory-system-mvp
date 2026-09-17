import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../plugin/server.mjs';
import { FileMemoryStorage } from '../dist/node.js';
import { validateConfig } from '../plugin/config.mjs';

test('plugin setup, authenticated model proxy, persistent isolated sessions, errors and buffered SSE',async()=>{
  const received=[];
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    const body=JSON.parse(raw);received.push({body,auth:req.headers.authorization});
    let answer='reply: '+body.messages.at(-1).content;
    if(body.messages[0].content.includes('Return JSON only')) answer=JSON.stringify({needsMemory:false,topicIds:[],needsTimeMetadata:false});
    if(body.messages.at(-1).content==='fail'){res.writeHead(401);res.end('never-display-private-provider-key');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}],usage:{prompt_tokens:8,completion_tokens:4}}));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const dir=await mkdtemp(join(tmpdir(),'topic-plugin-test-'));
  let app=await startServer({dataDir:dir,port:0});
  const request=async(path,body,headers={})=>{const res=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,data:await res.json()};};
  try{
    const page=await fetch(app.url);const cookie=page.headers.get('set-cookie').split(';')[0];assert.match(await page.text(),/连接你的模型/);
    assert.equal((await request('/api/config')).status,401);
    assert.equal((await request('/api/config',undefined,{Cookie:cookie,Origin:'https://other.test'})).status,403);
    let setup=await request('/api/config',undefined,{Cookie:cookie});const token=setup.data.localToken;
    const auth={Authorization:`Bearer ${token}`};
    assert.equal((await request('/api/config',{baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,model:'main',memoryModel:'small',apiKey:'private-provider-key'},auth)).status,200);
    assert.ok(!JSON.stringify((await request('/api/config',undefined,auth)).data).includes('private-provider-key'));
    assert.equal((await request('/api/test',{},auth)).data.ok,true);
    assert.equal(received[0].body.model,'main');assert.equal(received[1].body.model,'small');assert.equal(received[0].auth,'Bearer private-provider-key');
    await assert.rejects(()=>startServer({dataDir:dir,port:0}),/已有插件运行/);
    let reply=await request('/sessions/alpha/v1/chat/completions',{model:'main',messages:[{role:'user',content:'My city is Paris.'}]},auth);
    assert.equal(reply.status,200);assert.equal(reply.data.memory.sessionId,'alpha');
    await request('/sessions/beta/v1/chat/completions',{messages:[{role:'user',content:'My city is Tokyo.'}]},auth);
    await app.close();app=await startServer({dataDir:dir,port:0});
    assert.equal((await request('/api/session/alpha',undefined,auth)).data.exchanges[0].userText,'My city is Paris.');
    assert.equal((await request('/api/session/beta',undefined,auth)).data.exchanges[0].userText,'My city is Tokyo.');
    reply=await request('/sessions/alpha/v1/chat/completions',{messages:[{role:'user',content:'Recall my city.'}]},auth);
    const prompt=received.at(-1).body.messages;
    assert.ok(prompt.some(m=>m.content==='My city is Paris.'));assert.ok(!JSON.stringify(prompt).includes('My city is Tokyo.'));
    assert.equal((await request('/v1/chat/completions',{tools:[],messages:[{role:'user',content:'tool'}]},auth)).status,400);
    assert.equal((await request('/v1/chat/completions',{messages:[{role:'user',content:[{type:'text',text:'image'}]}]},auth)).status,400);
    const failed=await request('/sessions/alpha/v1/chat/completions',{messages:[{role:'user',content:'fail'}]},auth);
    assert.equal(failed.status,400);assert.ok(!JSON.stringify(failed).includes('never-display-private-provider-key'));
    assert.equal((await request('/api/session/alpha',undefined,auth)).data.exchanges.at(-1).status,'failed');
    const stream=await fetch(app.url+'/sessions/gamma/v1/chat/completions',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({stream:true,stream_options:{include_usage:true},messages:[{role:'user',content:'hello'}]})});
    assert.match(stream.headers.get('content-type'),/text\/event-stream/);const events=await stream.text();assert.match(events,/chat.completion.chunk/);assert.match(events,/\[DONE\]/);assert.match(events,/prompt_tokens/);
    const two=await Promise.all([request('/sessions/delta/v1/chat/completions',{messages:[{role:'user',content:'one'}]},auth),request('/sessions/delta/v1/chat/completions',{messages:[{role:'user',content:'two'}]},auth)]);
    assert.ok(two.every(r=>r.status===200));const rows=(await request('/api/session/delta',undefined,auth)).data.exchanges;assert.deepEqual(rows.map(e=>e.sequence),[1,2]);
  }finally{await app.close();await new Promise(r=>upstream.close(r));}
});

test('file storage does not overwrite corrupt data and survives a new instance',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'topic-storage-test-')),path=join(dir,'memory.json');
  const store=new FileMemoryStorage(path);
  await store.replaceTopics([{topicId:'T1'}]);assert.equal((await new FileMemoryStorage(path).listTopics())[0].topicId,'T1');
  await writeFile(path,'broken');await assert.rejects(()=>store.clearTopics());assert.equal(await readFile(path,'utf8'),'broken');
  assert.deepEqual(await readdir(dir),['memory.json']);
});

test('changing provider never silently forwards the previous provider key',()=>{
  const previous={baseUrl:'https://old.test/v1',apiKey:'old-key'};
  assert.throws(()=>validateConfig({baseUrl:'https://new.test/v1',model:'m'},previous),/更换服务商/);
  assert.equal(validateConfig({baseUrl:'https://new.test/v1',model:'m',clearKey:true},previous).apiKey,'');
  assert.throws(()=>validateConfig({baseUrl:'http://remote.test/v1',model:'m'},previous),/HTTPS/);
});
