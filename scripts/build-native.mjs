import {copyFile,mkdir,readdir,writeFile} from 'node:fs/promises';
async function copyTree(source,target){
  await mkdir(target,{recursive:true});
  for(const entry of await readdir(source,{withFileTypes:true})){
    const from=new URL(entry.name+(entry.isDirectory()?'/':''),source),to=new URL(entry.name+(entry.isDirectory()?'/':''),target);
    if(entry.isDirectory())await copyTree(from,to);
    else if(entry.isFile())for(let attempt=0;;attempt++){
      try{await copyFile(from,to);break;}catch(error){
        if(attempt>=8||!['EBUSY','EPERM','EACCES'].includes(error.code))throw error;
        await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));
      }
    }
  }
}
const root=new URL('../',import.meta.url);
for(const host of ['codex','claude-code']){
  const target=new URL(`integrations/${host}/topic-memory/`,root);await mkdir(target,{recursive:true});
  await writeFile(new URL('package.json',target),JSON.stringify({private:true,type:'module'})+'\n');
  await copyTree(new URL('dist/',root),new URL('dist/',target));
  await copyTree(new URL('integrations/runtime/',root),new URL('integrations/runtime/',target));
}
console.log('Built local Codex and Claude Code plugin bundles.');
