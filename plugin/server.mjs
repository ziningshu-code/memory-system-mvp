import { createServer } from 'node:http';
import { readFile, mkdir, readdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createMemory } from '../dist/index.js';
import { FileMemoryStorage } from '../dist/node.js';
import { chatMessages } from '../examples/provider.mjs';
import { loadConfig, validateConfig, writeJson } from './config.mjs';
import { completion, memoryLlm } from './provider.mjs';
import { evaluateLive } from './evaluate.mjs';

const sessionPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const publicFiles = { '/': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'] };
const equal = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json = (res,status,value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1024*1024) throw new Error('请求超过 1 MB。请缩短输入。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('请求必须是 JSON。'); }
}
async function lockDirectory(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir,'server.lock');
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const handle = await open(path,'wx',0o600); await handle.writeFile(String(process.pid)); await handle.close();
      return async () => { await unlink(path).catch(() => {}); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(path,'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid server.lock. Check that no plugin is running before removing this file.');
      try { process.kill(pid,0); throw new Error('此数据目录已有插件运行。请打开原窗口，或先停止原进程。'); }
      catch (check) { if (check.code !== 'ESRCH') throw check; }
      await unlink(path);
    }
  }
  throw new Error('无法锁定数据目录。');
}
export async function startServer({ dataDir = resolve('.topic-memory'), port = 4318 } = {}) {
  dataDir = resolve(dataDir);
  const unlock = await lockDirectory(dataDir);
  let config;
  try { config = await loadConfig(dataDir); } catch (error) { await unlock(); throw error; }
  const queues = new Map(); let active = 0, evaluating = false;
  const sessionDir = join(dataDir,'sessions'); await mkdir(sessionDir,{recursive:true});
  const storage = id => new FileMemoryStorage(join(sessionDir,`${id}.json`));
  const sessionId = value => { if (!sessionPattern.test(value ?? '')) throw new Error('会话 ID 只能包含 1–64 位英文、数字、下划线或连字符。'); return value; };
  const configured = () => { if (!config.baseUrl || !config.model) throw new Error('请先在配置页面保存自己的模型地址和模型名称。'); };
  async function serial(id, action) {
    const previous = queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(action); queues.set(id,next);
    try { return await next; } finally { if (queues.get(id) === next) queues.delete(id); }
  }
  function safeConfig() { return { baseUrl: config.baseUrl, model: config.model, memoryModel: config.memoryModel, hasKey: Boolean(config.apiKey), localToken: config.localToken, dataDir, configured: Boolean(config.baseUrl && config.model) }; }
  async function chat(id, input) {
    configured();
    if (evaluating) throw new Error('真实对比测试正在运行，请稍后再聊天。');
    const snapshot = { ...config }; active++;
    try { return await serial(id, async () => {
      const messages = input.messages;
      if (!Array.isArray(messages) || !messages.length || messages.length > 200 || messages.some(m => !m || !['system','user','assistant','developer'].includes(m.role) || typeof m.content !== 'string' || m.tool_calls || m.function_call) || messages.at(-1).role !== 'user') throw new Error('此版本仅支持以用户消息结尾的纯文本聊天（最多 200 条）；不支持图片、工具调用或 Responses API。');
      if (input.tools || input.functions || (input.n !== undefined && input.n !== 1) || input.response_format) throw new Error('此版本仅支持单个纯文本回答；不支持工具调用、多候选或结构化输出。');
      const memory = createMemory({ storage: storage(id), llm: memoryLlm(snapshot) });
      const saved = (await memory.listExchanges()).filter(e => e.status === 'completed');
      // Import supplied history only when starting a new session. Thereafter the session owns history.
      if (!saved.length) {
        const history = messages.slice(0,-1).filter(m => ['user','assistant'].includes(m.role));
        if (history.length % 2 || history.some((m,i) => m.role !== (i % 2 ? 'assistant' : 'user'))) throw new Error('历史需要按用户/助手成对提供。');
        for (let i=0;i+1<history.length;i+=2) {
          const e=await memory.begin(history[i].content); await memory.completeExchange({exchangeId:e.id,assistantText:history[i+1].content});
        }
        if (history.length) await memory.maybeRunTopicWorker();
      } else {
        const lastAssistant = messages.filter(m => m.role === 'assistant').at(-1);
        if (lastAssistant && lastAssistant.content !== saved.at(-1).assistantText) throw new Error('此会话历史与已保存记录不同。编辑、分支或重试旧回答时，请使用新的会话地址。');
      }
      const pending = await memory.begin(messages.at(-1).content);
      let completed = false;
      try {
        const context = await memory.retrieve({ userMessage: messages.at(-1).content });
        // A conservative safety cap; fail explicitly rather than silently discard historical evidence.
        if (context.memoryContext.length + context.recentContext.reduce((n,e)=>n+e.userText.length+e.assistantText.length,0) > 120000) throw new Error('当前记忆超过本地插件的上下文安全上限，请开启新会话。原始记录已保留。');
        const system = messages.filter(m => ['system','developer'].includes(m.role));
        const modelMessages = [...system, ...chatMessages(messages.at(-1).content,context.recentContext,context.memoryContext)];
        const options = {};
        for (const key of ['temperature','top_p','max_tokens','max_completion_tokens','stop','seed','presence_penalty','frequency_penalty']) if (input[key] !== undefined) options[key] = input[key];
        const result = await completion(snapshot, { ...options, messages: modelMessages });
        await memory.completeExchange({exchangeId:pending.id,assistantText:result.choices[0].message.content}); completed = true;
        const worker = await memory.maybeRunTopicWorker();
        return { ...result, id: result.id || `chatcmpl-${randomUUID()}`, object:'chat.completion', created:result.created || Math.floor(Date.now()/1000), model:snapshot.model,
          memory: { sessionId:id, selectedTopicIds:context.selectedTopicIds, selectorError:context.trace.selectorError, workerStatus:worker.reason, workerError:worker.run?.validationError ?? null } };
      } catch(error) { if (!completed) await memory.failExchange({exchangeId:pending.id,failureReason:error.message}); throw error; }
    }); } finally { active--; }
  }
  let origin;
  const server = createServer(async(req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host) { json(res,403,{error:{message:'Use the printed 127.0.0.1 address.'}}); return; }
      if (req.headers.origin && req.headers.origin !== origin) { json(res,403,{error:{message:'Cross-origin requests are not allowed.'}}); return; }
      const path = new URL(req.url,origin).pathname;
      if (req.method === 'GET' && publicFiles[path]) {
        const [file,type] = publicFiles[path];
        if (path === '/') res.setHeader('Set-Cookie',`topic_memory=${config.localToken}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(200,{'Content-Type':type}); res.end(await readFile(new URL(`./public/${file}`,import.meta.url))); return;
      }
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      const cookie = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('topic_memory='))?.slice(13);
      const apiPath = path.startsWith('/api/');
      if (!equal(bearer,config.localToken) && !(apiPath && equal(cookie,config.localToken))) { json(res,401,{error:{message:'Use the local connection key from the setup page.'}}); return; }
      if (req.method === 'GET' && path === '/api/config') { json(res,200,safeConfig()); return; }
      if (req.method === 'POST' && path === '/api/config') {
        if (active || evaluating) throw new Error('请求运行中，请结束后再修改配置。');
        const next = validateConfig(await body(req),config); await writeJson(join(dataDir,'config.json'),next); config=next;
        json(res,200,safeConfig()); return;
      }
      if (req.method === 'POST' && path === '/api/test') {
        configured(); active++;
        try {
          const calls=[]; const snapshot={...config};
          const result=await completion(snapshot,{messages:[{role:'user',content:'Reply briefly with OK.'}],max_tokens:2048},c=>calls.push(c));
          const selector=await memoryLlm(snapshot,c=>calls.push(c)).complete({system:'Return JSON only: {"needsMemory":false,"topicIds":[],"needsTimeMetadata":false}',user:'No history is available.',maxTokens:2048});
          const parsed=JSON.parse(selector);
          if(parsed.needsMemory !== false || !Array.isArray(parsed.topicIds) || parsed.topicIds.length) throw new Error('记忆模型没有返回预期的 JSON，请更换支持 JSON 指令的模型。');
          json(res,200,{ok:true,answer:result.choices[0].message.content,calls});
        } finally { active--; } return;
      }
      if (req.method === 'GET' && path === '/api/sessions') {
        const sessions=[];
        for(const file of await readdir(sessionDir)) if(file.endsWith('.json') && sessionPattern.test(file.slice(0,-5))) {
          const id=file.slice(0,-5), exchanges=await storage(id).listExchanges();
          sessions.push({id,count:exchanges.filter(e=>e.status==='completed').length,label:exchanges[0]?.userText.slice(0,50)||id});
        }
        json(res,200,{sessions}); return;
      }
      if (req.method === 'GET' && path.startsWith('/api/session/')) {
        const id=sessionId(path.slice('/api/session/'.length));
        json(res,200,{exchanges:await storage(id).listExchanges(),topics:await storage(id).listTopics()}); return;
      }
      if (req.method === 'POST' && path === '/api/evaluate') {
        configured(); if(evaluating || active) throw new Error('请等待当前请求完成后再运行测试。'); evaluating=true;
        try { const report=await evaluateLive({...config}); await writeJson(join(dataDir,'evaluation.json'),report); json(res,200,report); }
        finally { evaluating=false; } return;
      }
      const match = /^\/sessions\/([a-zA-Z0-9_-]{1,64})(\/v1\/(?:models|chat\/completions))$/.exec(path);
      const route = match ? match[2] : path;
      if(req.method === 'GET' && route === '/v1/models') { configured(); json(res,200,{object:'list',data:[{id:config.model,object:'model',created:0,owned_by:'your-provider'}]}); return; }
      if(req.method === 'POST' && (route === '/v1/chat/completions' || path === '/api/chat')) {
        const input=await body(req), id=sessionId(match?.[1] || req.headers['x-memory-session'] || input.memory_session || 'default');
        if(input.model && input.model !== config.model) throw new Error('请求模型与页面配置不一致，请刷新模型列表或更新配置。');
        const result=await chat(id,input);
        if(input.stream) {
          // Compatibility SSE, buffered until the full answer and durable write complete.
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8'});
          const chunk={id:result.id,object:'chat.completion.chunk',created:result.created,model:result.model};
          res.write(`data: ${JSON.stringify({...chunk,choices:[{index:0,delta:{role:'assistant',content:result.choices[0].message.content},finish_reason:null}]})}\n\n`);
          res.write(`data: ${JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:result.choices[0].finish_reason || 'stop'}]})}\n\n`);
          if(input.stream_options?.include_usage) res.write(`data: ${JSON.stringify({...chunk,choices:[],usage:result.usage || null})}\n\n`);
          res.end('data: [DONE]\n\n');
        } else json(res,200,result);
        return;
      }
      json(res,404,{error:{message:'Unsupported endpoint. This plugin supports text Chat Completions.'}});
    } catch(error) { if(!res.headersSent) json(res,400,{error:{message:error.message}}); else res.end(); }
  });
  server.requestTimeout=120000;
  try { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);}); }
  catch(error) { await unlock(); throw error; }
  origin=`http://127.0.0.1:${server.address().port}`;
  return { server, url:origin, dataDir, async close() { await new Promise(resolve=>server.close(resolve)); await unlock(); } };
}
