import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { evaluateLive } from '../plugin/evaluate.mjs';
const dir=resolve(process.env.TOPIC_MEMORY_DATA_DIR || '.topic-memory');
try {
  const config=JSON.parse(await readFile(join(dir,'config.json'),'utf8'));
  if(!config.baseUrl || !config.model)throw new Error('First open npm start and save your model configuration.');
  const result=await evaluateLive(config);
  await mkdir('benchmark-results',{recursive:true});
  await writeFile('benchmark-results/plugin-live.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.summary,null,2));
  console.log('Raw report: benchmark-results/plugin-live.json');
  if(result.workerRuns.some(r=>r.reason==='failed'||r.reason==='rejected')||result.cases.some(c=>c.selectorError||c.answers.some(a=>a.error)))process.exitCode=1;
} catch(error){console.error(error.message);process.exitCode=1;}
