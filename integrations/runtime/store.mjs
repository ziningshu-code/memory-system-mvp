import {mkdir,readFile,writeFile,rename,unlink,rmdir,stat,appendFile,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {FileMemoryStorage} from '../../dist/node.js';

export const hash=text=>createHash('sha256').update(text).digest('hex').slice(0,32);
export function dataRoot(){return resolve(process.env.TOPIC_MEMORY_HOME??join(homedir(),'.topic-memory'));}
export async function projectRoot(project){const path=await realpath(resolve(project));return join(dataRoot(),'projects',hash(process.platform==='win32'?path.toLowerCase():path));}
export async function json(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function atomicJson(path,data){await mkdir(dirname(path),{recursive:true});const tmp=`${path}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify(data),{flag:'wx',mode:0o600});await retryBusy(()=>rename(tmp,path));}
export async function withLock(path,action,{timeoutMs=15000}={}){
  await mkdir(dirname(path),{recursive:true});const begin=Date.now();
  while(true){
    try{await mkdir(path);await writeFile(join(path,'owner.json'),JSON.stringify({pid:process.pid,time:Date.now()}));break;}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const info=await json(join(path,'owner.json'),null);
      let abandoned=false;
      if(info?.pid){try{process.kill(info.pid,0);}catch(e){if(e.code==='ESRCH')abandoned=true;}}
      else{try{abandoned=Date.now()-(await stat(path)).mtimeMs>10000;}catch{}}
      if(abandoned){await unlink(join(path,'owner.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(path).catch(e=>{if(!['ENOENT','ENOTEMPTY'].includes(e.code))throw e;});continue;}
      if(Date.now()-begin>=timeoutMs)throw new Error('Memory store is busy; retry shortly');
      await new Promise(r=>setTimeout(r,50));
    }
  }
  try{return await action();}finally{await retryBusy(()=>unlink(join(path,'owner.json')));await retryBusy(()=>rmdir(path));}
}
async function retryBusy(fn){for(let attempt=0;;attempt++){try{return await fn();}catch(e){if(attempt>=8||!['EBUSY','EPERM','EACCES'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,25*(attempt+1)));}}}
/** Read snapshots are atomic; each write rereads under an inter-process lock. */
export function sharedStore(root){
  const file=new FileMemoryStorage(join(root,'memory.json'));
  const methods=['listExchanges','putExchange','clearExchanges','listTopics','replaceTopics','clearTopics','getLatestTopicWorkerRun','saveLatestTopicWorkerRun','clearLatestTopicWorkerRun','commitIndex'];
  const writes=new Set(['putExchange','clearExchanges','replaceTopics','clearTopics','saveLatestTopicWorkerRun','clearLatestTopicWorkerRun','commitIndex']);
  return Object.fromEntries(methods.map(method=>[method,(...args)=>writes.has(method)?withLock(join(root,'write.lock'),()=>file[method](...args)):file[method](...args)]));
}
export async function audit(root,event){await mkdir(root,{recursive:true});await appendFile(join(root,'activity.jsonl'),JSON.stringify({time:Date.now(),...event})+'\n',{mode:0o600});}
