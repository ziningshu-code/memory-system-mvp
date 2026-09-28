import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';

const compiled=await mkdtemp(join(process.cwd(),'.test-dist-'));
async function run(args){
  const code=await new Promise((resolveCode,reject)=>{
    const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});
    child.once('error',reject);child.once('close',resolveCode);
  });
  if(code!==0)throw new Error(`Test command exited ${code}`);
}
try{
  await run([resolve('node_modules/typescript/bin/tsc'),'-p','tsconfig.test.json','--outDir',compiled]);
  const core=(await readdir(join(compiled,'tests'))).filter(name=>name.endsWith('.test.js')).map(name=>join(compiled,'tests',name));
  const native=(await readdir('tests')).filter(name=>name.endsWith('.test.mjs')).map(name=>resolve('tests',name));
  await run(['--test',...core]);
  await run(['--test',...native]);
}finally{
  // Windows may briefly keep test files open; stale directories are git-ignored.
  await rm(compiled,{recursive:true,force:true,maxRetries:8,retryDelay:100}).catch(()=>{});
}
