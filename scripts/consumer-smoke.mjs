import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = process.cwd();

const packed = JSON.parse(execFileSync(npm, ['pack', '--json'], {
  cwd: root,
  encoding: 'utf8',
}));

const tarballName = packed?.[0]?.filename;
if (!tarballName) throw new Error('npm pack did not return a tarball filename');

const tarballPath = resolve(root, tarballName);
const consumerDir = mkdtempSync(join(tmpdir(), 'topic-memory-consumer-'));

writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
  name: 'topic-memory-consumer-smoke',
  private: true,
  type: 'module',
}, null, 2));

execFileSync(npm, ['install', '--ignore-scripts', tarballPath], {
  cwd: consumerDir,
  stdio: 'inherit',
});

const smokeSource = String.raw`
import { createMemory, InMemoryStorage } from 'topic-memory';

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
