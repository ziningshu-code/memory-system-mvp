// Packaging/protocol checks only. These do not measure a real model's recall.
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run with npm run smoke:consumer');
const root=process.cwd();
execFileSync(process.execPath,[npmCli,'run','build:native'],{cwd:root,stdio:'inherit'});
const [packed]=JSON.parse(execFileSync(process.execPath,[npmCli,'pack','--ignore-scripts','--json'],{cwd:root,encoding:'utf8'}));
const paths=packed.files.map(f=>f.path);
for(const path of ['dist/index.js','dist/node.js','integrations/runtime/cli.mjs',
  'integrations/codex/topic-memory/.codex-plugin/plugin.json','integrations/codex/topic-memory/.mcp.json',
  'integrations/codex/topic-memory/hooks/hooks.json','integrations/codex/topic-memory/dist/index.js',
  'integrations/codex/topic-memory/integrations/runtime/cli.mjs',
  'integrations/claude-code/topic-memory/.claude-plugin/plugin.json','integrations/claude-code/topic-memory/.mcp.json'])assert.ok(paths.includes(path),`Missing ${path}`);
assert.ok(!paths.some(p=>/(^|\/)\.env($|\.)|\.topic-memory|benchmark-results|memory\.json$|activity\.jsonl$/.test(p)),'Private files in package');
assert.ok(!paths.some(p=>p.startsWith('plugin/')),'Retired setup dashboard in native package');
const consumer=mkdtempSync(join(tmpdir(),'topic-memory-consumer-'));
writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'topic-memory-consumer-check',private:true,type:'module'}));
execFileSync(process.execPath,[npmCli,'install','--offline','--ignore-scripts','--no-audit','--no-fund',resolve(root,packed.filename)],{cwd:consumer,stdio:'inherit'});
const packageRoot=join(consumer,'node_modules/topic-memory');
const meta=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
assert.equal(meta.bin['topic-memory'],'./integrations/runtime/cli.mjs');
const source=String.raw`
import assert from 'node:assert/strict';
import {createTopicMemory} from 'topic-memory';
import {FileMemoryStorage} from 'topic-memory/node';
const llm={complete:async()=>{throw new Error('No model expected in packaging check')}};
const memory=createTopicMemory({storage:new FileMemoryStorage('./archive.json'),llm});
await memory.append({sourceId:'packaging-fixture',userText:'literal 😀 source',assistantText:'fixture response',userSentAt:1000,assistantCompletedAt:2000});
const reopened=createTopicMemory({storage:new FileMemoryStorage('./archive.json'),llm});
const evidence=await reopened.open(['pending_1']);
assert.ok(evidence[0].text.includes('literal 😀 source'));
assert.equal((await reopened.status()).exchanges,1);
console.log('Installed SDK persistence and exact originals PASS');
`;
writeFileSync(join(consumer,'check.mjs'),source);
execFileSync(process.execPath,['check.mjs'],{cwd:consumer,stdio:'inherit'});
const env={...process.env,TOPIC_MEMORY_HOME:join(consumer,'test-data')};
function run(script,args=[],input=''){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{cwd:consumer,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Installed command timeout'));},15000);
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);
    child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error(err));});child.stdin.end(input);
  });
}
const cli=join(packageRoot,'integrations/runtime/cli.mjs');
assert.equal(JSON.parse(await run(cli)).exchanges,0);
const event={cwd:consumer,session_id:'fixture-session',turn_id:'fixture-turn'};
await run(cli,['hook'],JSON.stringify({...event,hook_event_name:'UserPromptSubmit',prompt:'Fixture question'}));
await run(cli,['hook'],JSON.stringify({...event,hook_event_name:'Stop',last_assistant_message:'Fixture answer'}));
assert.equal(JSON.parse(await run(cli,['status'])).exchanges,1);
for(const host of ['codex','claude-code']){
  const bundled=join(packageRoot,`integrations/${host}/topic-memory/integrations/runtime/cli.mjs`);
  const reqs=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'memory_open',arguments:{topicIds:['pending_1']}}}];
  const replies=(await run(bundled,['mcp'],reqs.map(q=>JSON.stringify(q)).join('\n')+'\n')).trim().split('\n').map(JSON.parse);
  assert.equal(replies[0].result.serverInfo.name,'topic-memory');assert.equal(replies[1].result.tools.length,2);
  assert.ok(JSON.parse(replies[2].result.content[0].text).evidence[0].text.includes('Fixture question'));
}
console.log('Fresh package: default command, capture hooks, and both bundled MCP servers PASS');
console.log(JSON.stringify({tarball:packed.filename,files:paths.length,consumerDirectory:consumer}));
