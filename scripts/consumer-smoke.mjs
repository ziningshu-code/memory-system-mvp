import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run smoke:consumer.');
const root = process.cwd();

const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json'], {
  cwd: root,
  encoding: 'utf8',
}));

const tarballName = packed?.[0]?.filename;
if (!tarballName) throw new Error('npm pack did not return a tarball filename');
const filePaths = packed[0].files.map(file => file.path);
for (const required of ['bin/topic-memory.mjs','plugin/server.mjs','plugin/public/index.html','plugin/public/app.js','dist/node.js','examples/provider.mjs','examples/scenario.mjs']) {
  if (!filePaths.includes(required)) throw new Error(`Published plugin is missing ${required}`);
}
if (filePaths.some(path => /(^|\/)\.env($|\.)|\.topic-memory|benchmark-results/.test(path))) throw new Error('Private local files must not be published');

const tarballPath = resolve(root, tarballName);
const consumerDir = mkdtempSync(join(tmpdir(), 'topic-memory-consumer-'));

writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
  name: 'topic-memory-consumer-smoke',
  private: true,
  type: 'module',
}, null, 2));

execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', tarballPath], {
  cwd: consumerDir,
  stdio: 'inherit',
});

const smokeSource = String.raw`
import { createMemory, InMemoryStorage } from 'topic-memory';
import { FileMemoryStorage } from 'topic-memory/node';

const persistent = new FileMemoryStorage('./persistent-memory.json');
await persistent.replaceTopics([]);
if ((await new FileMemoryStorage('./persistent-memory.json').listTopics()).length !== 0) throw new Error('Node storage export failed');

const fakeMemoryLlm = {
  async complete(input) {
    if (input.system.includes('Topic Worker')) {
      return JSON.stringify({
        topics: [{
          status: 'provisional',
          labelTerms: ['moving plans', 'new apartment'],
          retrievalTerms: ['Shanghai', 'new apartment', 'moving next month'],
          spans: [{ startSequence: 1, endSequence: 6 }],
        }],
      });
    }

    return JSON.stringify({
      needsMemory: true,
      topicIds: ['T1'],
      needsTimeMetadata: false,
    });
  },
};

const memory = createMemory({
  storage: new InMemoryStorage(),
  llm: fakeMemoryLlm,
});

for (let i = 1; i <= 6; i += 1) {
  const pending = await memory.begin(
    i === 1
      ? 'I am moving to a new apartment in Shanghai next month.'
      : 'More details about the apartment and moving plan ' + i,
  );

  await memory.completeExchange({
    exchangeId: pending.id,
    assistantText: 'Acknowledged moving detail ' + i,
  });
}

const worker = await memory.maybeRunTopicWorker();
if (!worker.ran || worker.reason !== 'accepted') {
  throw new Error('Topic Worker did not produce an accepted topic set');
}

const retrieved = await memory.retrieve({
  userMessage: 'What did I tell you about my move?',
});

if (!retrieved.memoryContext.includes('MEMORY_SECTION_FROM_TOPIC_STORE')) {
  throw new Error('Expected a non-empty restored memoryContext');
}

if (!retrieved.selectedTopicIds.includes('T1')) {
  throw new Error('Expected selector to restore topic T1');
}

let hostReceivedMemory = '';
async function myOwnMainLlm({ memoryContext }) {
  hostReceivedMemory = memoryContext;
  return 'Host model reply';
}

await myOwnMainLlm({
  userMessage: 'What did I tell you about my move?',
  memoryContext: retrieved.memoryContext,
});

if (!hostReceivedMemory.includes('MEMORY_SECTION_FROM_TOPIC_STORE')) {
  throw new Error('Host Main LLM did not receive memoryContext');
}

console.log('Fresh consumer smoke test PASS');
console.log('Selected topics:', retrieved.selectedTopicIds.join(', '));
console.log('memoryContext chars:', retrieved.memoryContext.length);
`;

writeFileSync(join(consumerDir, 'smoke.mjs'), smokeSource);

execFileSync(process.execPath, ['smoke.mjs'], {
  cwd: consumerDir,
  stdio: 'inherit',
});

// Launch the installed package, not the source checkout, with no provider credentials.
const child = spawn(process.execPath, ['node_modules/topic-memory/bin/topic-memory.mjs','--port','0','--data-dir',join(consumerDir,'plugin-data')], { cwd:consumerDir, stdio:['ignore','pipe','pipe'], windowsHide:true });
try {
  const url = await new Promise((resolve,reject) => {
    let output='';
    const timer=setTimeout(()=>reject(new Error('Installed plugin did not start within 15 seconds')),15000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Installed plugin exited early: ${code}`));});
    child.stdout.on('data',data=>{output+=data;const match=/Open: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  const response=await fetch(url);
  if(!response.ok || !(await response.text()).includes('config-form'))throw new Error('Installed plugin page failed');
  console.log('Installed plugin startup and setup page PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
}
