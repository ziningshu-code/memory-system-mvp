#!/usr/bin/env node
import { resolve } from 'node:path';
import { startServer } from '../plugin/server.mjs';
const args=process.argv.slice(2);
if(args.includes('--help')) {
  console.log('topic-memory [--port 4318] [--data-dir path]\nOpen the printed URL to configure your own model. Data stays in .topic-memory in the current folder by default.');
} else {
  try {
    const options={};
    for(let i=0;i<args.length;i+=2) {
      if(args[i]==='--port' && /^\d+$/.test(args[i+1]||'')) options.port=Number(args[i+1]);
      else if(args[i]==='--data-dir' && args[i+1]) options.dataDir=resolve(args[i+1]);
      else throw new Error('Unknown argument. Run topic-memory --help.');
    }
    const app=await startServer(options);
    console.log(`\nTopic Memory — local memory plugin\n\nOpen: ${app.url}\nData: ${app.dataDir}\n\nKeep this terminal open. Press Ctrl+C to stop; your memory stays on disk.\n`);
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;console.log('Finishing requests and saving memory…');await app.close();process.exit(0);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  } catch(error) { console.error(error.code==='EADDRINUSE' ? 'Port is in use. Open the existing plugin, or choose --port 4319.' : error.message);process.exitCode=1; }
}
