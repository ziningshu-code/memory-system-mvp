import {spawn} from 'node:child_process';
import {createOpenAICompatibleMemoryLlm} from '../../dist/index.js';
import {fileURLToPath} from 'node:url';

export function configuredModel(config, onUsage=()=>{}) {
  if(config.provider==='openai-compatible') {
    if(!config.baseUrl||!config.model) throw new Error('Set baseUrl and model in the Topic Memory configuration');
    return createOpenAICompatibleMemoryLlm({baseUrl:config.baseUrl,model:config.model,
      apiKey:process.env[config.apiKeyEnv??'TOPIC_MEMORY_API_KEY'],timeoutMs:90000,jsonMode:config.jsonMode===true,reasoningEffort:config.reasoningEffort});
  }
  if(config.provider!=='codex'||!config.model) throw new Error('Configure provider and model before indexing or searching memory');
  return {complete:request=>codexInference(config,request,onUsage)};
}
export function codexArguments(model,{tools=false,hooks=false}={}) {
  const disabled=['memories','apps','plugins','multi_agent','shell_tool','unified_exec','browser_use','computer_use',
    'image_generation','view_image','workspace_dependencies','skill_search','sleep_tool','in_app_browser','in_app_chat',
    'tool_suggest','code_mode','code_mode_only','unbounded_connection_retries','shell_snapshot'];
  if(!tools)disabled.push('code_mode_host');
  if(!hooks) disabled.push('hooks');
  return ['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--model',model,
    ...disabled.flatMap(f=>['--disable',f]),'-c','web_search="disabled"','-c','project_doc_max_bytes=0',
    '-c','skills.max_context_tokens=1','--enable','skip_host_skill_discovery','-c','model_reasoning_effort="low"',
    '-c','approval_policy="never"','-c',`model_instructions_file=${JSON.stringify(fileURLToPath(new URL('model-instructions.txt',import.meta.url)))}`,
    '-c','model_provider="topic_memory"',
    '-c','model_providers.topic_memory={name="Topic Memory",requires_openai_auth=true,wire_api="responses",supports_websockets=false,request_max_retries=0,stream_max_retries=0}',
    '--json'];
}
export async function codexInference(config,request,onUsage) {
  const args=[...codexArguments(config.model),'-'];
  const started=Date.now();let out='',err='';
  const child=spawn(config.codexCommand??'codex',args,{cwd:config.inferenceCwd,windowsHide:true,shell:false,
    env:{...process.env,TOPIC_MEMORY_INTERNAL:'1'},stdio:['pipe','pipe','pipe']});
  let failure;
  const timer=setTimeout(()=>{failure='Model request timed out';child.kill();},config.timeoutMs??120000);
  child.stdout.on('data',b=>{out+=b;if(out.length>2000000){failure='Model output too large';child.kill();}});
  child.stderr.on('data',b=>{err=(err+b).slice(-3000);});
  child.stdin.on('error',()=>{});
  child.stdin.end(`TASK:\n${request.system}\n\nDATA:\n${request.user}\n\nReturn only the requested JSON. Aim for at most ${request.maxTokens} output tokens. Use no tools.`);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(timer));
  const events=out.split(/\r?\n/).flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}});
  const usage=events.findLast(e=>e.type==='turn.completed')?.usage;
  const output=events.findLast(e=>e.type==='item.completed'&&e.item?.type==='agent_message')?.item.text;
  const forbidden=events.some(e=>['mcp_tool_call','command_execution','file_change','web_search','collab_tool_call'].includes(e.item?.type));
  await onUsage({model:config.model,usage:usage??null,ms:Date.now()-started,outputLimitEnforced:false});
  if(code!==0||failure||forbidden||!output) {
    const error=new Error(failure??(forbidden?'Memory inference attempted a tool':`Model request failed (exit ${code}); check Codex login and quota`));
    if(failure==='Model request timed out')error.transient=true;
    throw error;
  }
  return output;
}
