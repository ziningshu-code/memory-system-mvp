const $=id=>document.getElementById(id);
let config, report, busy=false;
let current=localStorage.getItem('topic-memory-session') || `chat_${crypto.randomUUID()}`;
if(!/^[a-zA-Z0-9_-]{1,64}$/.test(current)) current=`chat_${crypto.randomUUID()}`;
async function api(path, payload) {
  const res=await fetch(path,{...(payload===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})});
  const data=await res.json(); if(!res.ok)throw new Error(data.error?.message || `HTTP ${res.status}`); return data;
}
function status(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
function renderConfig(){
  $('base-url').value=config.baseUrl; $('model').value=config.model; $('memory-model').value=config.memoryModel;
  $('api-key').value='';$('clear-key').checked=false;
  $('key-state').textContent=config.hasKey?'Key 已保存在本机；留空会保留。':'没有保存的 Key；本机无鉴权服务可留空。';
  $('connection').textContent=config.configured?'已配置 · 可测试连接':'尚未配置';
  $('data-dir').textContent=config.dataDir;renderIntegration();
}
function renderIntegration(){ $('local-url').value=`${location.origin}/sessions/${current}/v1`;$('local-key').value=config.localToken;$('local-model').value=config.model; }
function setBusy(value){busy=value;for(const id of ['save','test','send','new-session','session','evaluate'])$(id).disabled=value;}
async function action(statusId,fn){if(busy)return;setBusy(true);try{await fn();}catch(error){status(statusId,error.message,true);}finally{setBusy(false);}}
function bubble(role,text,failed=false){const el=document.createElement('div');el.className=`bubble ${role}${failed?' failed':''}`;const label=document.createElement('span');label.className='role';label.textContent=role==='user'?'YOU':'ASSISTANT';el.append(label,document.createTextNode(text));$('messages').append(el);}
async function loadSession(){
  localStorage.setItem('topic-memory-session',current);renderIntegration();
  const data=await api(`/api/session/${current}`);$('messages').replaceChildren();
  if(!data.exchanges.length){const p=document.createElement('p');p.className='empty';p.textContent='这是一段独立的会话。试着告诉模型一件希望它记住的事。';$('messages').append(p);}
  for(const e of data.exchanges){bubble('user',e.userText);if(e.status==='completed')bubble('assistant',e.assistantText);else bubble('assistant',e.status==='failed'?`上次请求失败：${e.failureReason}`:'上次请求未完成，可以重新发送。',true);}
  $('trace').textContent=JSON.stringify({topicCount:data.topics.length,topics:data.topics},null,2);
  $('messages').scrollTop=$('messages').scrollHeight;
}
async function sessions(){const data=await api('/api/sessions');$('session').replaceChildren();const list=data.sessions;if(!list.some(s=>s.id===current))list.push({id:current,label:'新会话',count:0});for(const s of list){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.label} · ${s.count} 轮`;o.selected=s.id===current;$('session').append(o);}}
$('config-form').addEventListener('submit',event=>{event.preventDefault();void action('config-status',async()=>{config=await api('/api/config',{baseUrl:$('base-url').value,model:$('model').value,memoryModel:$('memory-model').value,apiKey:$('api-key').value,clearKey:$('clear-key').checked});renderConfig();status('config-status','配置已保存在本机。现在可以测试连接。');});});
$('test').addEventListener('click',()=>void action('config-status',async()=>{status('config-status','正在验证聊天模型与记忆模型的真实连接…');const result=await api('/api/test',{});$('connection').textContent='连接测试通过';status('config-status',`连接通过：${result.answer.slice(0,100)}。记忆模型 JSON 检查通过。`);}));
$('chat-form').addEventListener('submit',event=>{event.preventDefault();void action('chat-status',async()=>{const message=$('message').value.trim();if(!message)return;status('chat-status','正在找回记忆、生成回答并保存…');try{const result=await api('/api/chat',{memory_session:current,messages:[{role:'user',content:message}]});$('message').value='';await sessions();await loadSession();$('trace').textContent=JSON.stringify(result.memory,null,2)+'\n\n'+$('trace').textContent;const warning=result.memory.selectorError||result.memory.workerError;status('chat-status',warning?`回答已保存，但记忆整理或检索未成功：${warning}`:`已保存。找回话题：${result.memory.selectedTopicIds.join(', ')||'无'}；整理：${result.memory.workerStatus}`,Boolean(warning));}catch(error){await sessions();await loadSession();throw error;}});});
$('new-session').addEventListener('click',()=>void action('chat-status',async()=>{current=`chat_${crypto.randomUUID()}`;await sessions();await loadSession();status('chat-status','已切换到新会话；接入地址也已更新。');}));
$('session').addEventListener('change',()=>void action('chat-status',async()=>{current=$('session').value;await loadSession();status('chat-status','已载入保存在本机的会话。');}));
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($(button.dataset.copy).value);button.textContent='已复制';setTimeout(()=>button.textContent='复制',1500);}catch{$(button.dataset.copy).select();button.textContent='请手动复制';}}));
$('evaluate').addEventListener('click',()=>void action('eval-status',async()=>{status('eval-status','真实测试运行中。约 23 次模型请求，可能需要数分钟，请保持页面打开…');report=await api('/api/evaluate',{});const labels={'recent-5':'最近 5 轮','full-transcript':'完整历史','topic-memory':'话题记忆'};$('eval-summary').textContent=Object.entries(report.summary).map(([k,v])=>`${labels[k]}：${v.passed}/${v.total} 个字面检查通过`).join('\n');$('eval-detail').textContent=JSON.stringify(report,null,2);$('download').hidden=false;status('eval-status','测试完成。请结合原始回答、整理失败和用量判断；小样本结果不能代表普遍准确率。');}));
$('download').addEventListener('click',()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='topic-memory-live-evaluation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try{config=await api('/api/config');renderConfig();await sessions();await loadSession();}catch(error){status('config-status',error.message,true);}
