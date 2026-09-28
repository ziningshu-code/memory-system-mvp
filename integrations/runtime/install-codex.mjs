import {mkdir,readdir,copyFile,readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {atomicJson,json,withLock} from './store.mjs';

const owner='https://github.com/ziningshu-code/memory-system-mvp';
async function copyTree(from,to){
  await mkdir(to,{recursive:true});
  for(const e of await readdir(from,{withFileTypes:true})){
    if(e.isDirectory())await copyTree(join(from,e.name),join(to,e.name));
    else if(e.isFile())for(let attempt=0;;attempt++){
      try{await copyFile(join(from,e.name),join(to,e.name));break;}catch(error){
        if(attempt>=8||!['EBUSY','EPERM','EACCES'].includes(error.code))throw error;
        await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));
      }
    }
    else throw new Error('Plugin bundle must not contain links');
  }
}
async function register(selector){
  const child=spawn('codex',['plugin','add',selector],{stdio:'inherit',windowsHide:true,shell:false});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(code!==0)throw new Error('Codex plugin registration failed; check your Codex CLI version');
}
/** Install only our bundle; never replace an unrelated plugin or marketplace entry. */
export async function installCodex({home=homedir(),run=register}={}){
  const source=fileURLToPath(new URL('../codex/topic-memory/',import.meta.url));
  await access(join(source,'dist','index.js'));
  const marketplace=join(home,'.agents','plugins','marketplace.json'),target=join(home,'plugins','topic-memory');
  const selector=await withLock(join(home,'.agents','plugins','topic-memory-install.lock'),async()=>{
    const manifest=await json(marketplace,{name:'personal',interface:{displayName:'Personal'},plugins:[]});
    if(typeof manifest.name!=='string'||!/^[A-Za-z0-9_-]+$/.test(manifest.name)||!Array.isArray(manifest.plugins))throw new Error('Existing personal marketplace is invalid; left unchanged');
    const existing=manifest.plugins.find(p=>p.name==='topic-memory');
    if(existing&&(existing.source?.source!=='local'||existing.source?.path!=='./plugins/topic-memory'))throw new Error('An unrelated topic-memory marketplace entry already exists; left unchanged');
    let exists=false;try{await access(target);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    const marker=await json(join(target,'.topic-memory-package.json'),null);
    if(exists&&marker?.repository!==owner)throw new Error('Plugin destination already exists and is not owned by this installer; left unchanged');
    const sourceVersion=JSON.parse(await readFile(join(source,'.codex-plugin','plugin.json'),'utf8')).version;
    if(exists&&marker.version===sourceVersion){
      // Installing the same release again only repeats registration; avoid stale same-version cache updates.
    }else{
      if(!exists)await atomicJson(join(target,'.topic-memory-package.json'),{repository:owner,version:null});
      await copyTree(source,target);
      await atomicJson(join(target,'.topic-memory-package.json'),{repository:owner,version:sourceVersion});
    }
    // Codex does not expand plugin-root placeholders in MCP args on tested Windows builds.
    // Resolve at installation time; retain the host's cwd for project isolation.
    const mcp=JSON.parse(await readFile(join(source,'.mcp.json'),'utf8'));
    mcp.mcpServers['topic-memory'].args=[join(target,'integrations','runtime','cli.mjs'),'mcp'];
    await atomicJson(join(target,'.mcp.json'),mcp);
    if(!existing){
      manifest.plugins.push({name:'topic-memory',source:{source:'local',path:'./plugins/topic-memory'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'});
      await atomicJson(marketplace,manifest);
    }
    return `topic-memory@${manifest.name}`;
  });
  await run(selector);
  return {selector,target,marketplace};
}
