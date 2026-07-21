import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import {
  createMemory,
  createOpenAICompatibleMemoryLlm,
  InMemoryStorage,
  IndexedDbMemoryStorage,
  type CanonicalTopic,
  type MemoryLlm,
  type MemoryStorage,
} from '../src/index.js';

const workerJson = JSON.stringify({
  topics: [{
    status: 'provisional',
    labelTerms: ['travel', 'Tokyo'],
    retrievalTerms: ['Tokyo', 'hotel', 'Shibuya'],
    spans: [{ startSequence: 1, endSequence: 6 }],
  }],
});
const selectorJson = JSON.stringify({ needsMemory: true, topicIds: ['T1'], needsTimeMetadata: false });

function dualPurposeLlm(): MemoryLlm {
  return { async complete(input) { return input.system.includes('Topic Worker') ? workerJson : selectorJson; } };
}

async function addCompleted(memory: ReturnType<typeof createMemory>, count = 6, prefix = 'm') {
  for (let i = 1; i <= count; i++) {
    const pending = await memory.beginExchange({ userText: `${prefix} user ${i}`, userSentAt: 1_000 * i });
    await memory.completeExchange({ exchangeId: pending.id, assistantText: `${prefix} assistant ${i}`, assistantCompletedAt: 1_000 * i + 100 });
  }
}

async function storageContract(storage: MemoryStorage) {
  const memory = createMemory({ storage, llm: dualPurposeLlm() });
  const pending = await memory.begin('hello');
  assert.equal((await memory.listExchanges()).length, 1);
  await memory.completeExchange({ exchangeId: pending.id, assistantText: '[[b_mC]] world' });
  assert.equal((await memory.listExchanges())[0].assistantText, 'world');
  await memory.clear();
  assert.equal((await memory.listExchanges()).length, 0);
  assert.equal((await memory.listTopics()).length, 0);
}

test('default one-model configuration uses the same Memory LLM for worker and selector', async () => {
  const memory = createMemory({ storage: new InMemoryStorage(), llm: dualPurposeLlm() });
  await addCompleted(memory);
  assert.equal((await memory.maybeRunTopicWorker()).reason, 'accepted');
  assert.deepEqual((await memory.retrieve({ userMessage: 'what about that Tokyo trip?' })).selectedTopicIds, ['T1']);
});

test('separate worker and selector models are supported', async () => {
  let workerCalls = 0;
  let selectorCalls = 0;
  const memory = createMemory({
    storage: new InMemoryStorage(),
    topicWorker: { complete: async () => { workerCalls++; return workerJson; } },
    selector: { complete: async () => { selectorCalls++; return selectorJson; } },
  });
  await addCompleted(memory);
  await memory.maybeRunTopicWorker();
  await memory.retrieve({ userMessage: 'Tokyo?' });
  assert.equal(workerCalls, 1);
  assert.equal(selectorCalls, 1);
});

test('OpenAI-compatible adapter sends expected URL and payload and parses content', async () => {
  let url = '';
  let body: any;
  const llm = createOpenAICompatibleMemoryLlm({
    baseUrl: 'https://example.test/v1/', model: 'memory-model', apiKey: 'secret',
    fetchImpl: async (input, init) => {
      url = String(input); body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    },
  });
  assert.equal(await llm.complete({ system: 's', user: 'u', maxTokens: 12, temperature: 0.2, topP: 0.8 }), 'ok');
  assert.equal(url, 'https://example.test/v1/chat/completions');
  assert.equal(body.model, 'memory-model');
  assert.equal(body.max_tokens, 12);
  assert.equal(body.top_p, 0.8);
});

test('OpenAI-compatible adapter throws on HTTP errors', async () => {
  const llm = createOpenAICompatibleMemoryLlm({ baseUrl: 'https://x', model: 'm', fetchImpl: async () => new Response('bad', { status: 500 }) });
  await assert.rejects(() => llm.complete({ system: 's', user: 'u', maxTokens: 1 }), /HTTP 500/);
});

test('OpenAI-compatible adapter throws on invalid JSON', async () => {
  const llm = createOpenAICompatibleMemoryLlm({ baseUrl: 'https://x', model: 'm', fetchImpl: async () => new Response('not-json', { status: 200 }) });
  await assert.rejects(() => llm.complete({ system: 's', user: 'u', maxTokens: 1 }), /invalid JSON/);
});

test('OpenAI-compatible adapter throws on empty content', async () => {
  const llm = createOpenAICompatibleMemoryLlm({ baseUrl: 'https://x', model: 'm', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }) });
  await assert.rejects(() => llm.complete({ system: 's', user: 'u', maxTokens: 1 }), /empty content/);
});

test('canonical lifecycle supports pending, completed, failed, and strips protocol tags', async () => {
  const memory = createMemory({ storage: new InMemoryStorage(), llm: dualPurposeLlm() });
  const a = await memory.begin('a'); const b = await memory.begin('b');
  await memory.completeExchange({ exchangeId: a.id, assistantText: '[[b_mS]] done' });
  await memory.failExchange({ exchangeId: b.id, failureReason: 'timeout' });
  const rows = await memory.listExchanges();
  assert.equal(rows[0].status, 'completed'); assert.equal(rows[0].assistantText, 'done'); assert.equal(rows[1].status, 'failed');
});

test('Topic Worker waits for 6 completed exchanges', async () => {
  const memory = createMemory({ storage: new InMemoryStorage(), llm: dualPurposeLlm() });
  await addCompleted(memory, 5);
  assert.equal((await memory.maybeRunTopicWorker()).reason, 'completed_exchange_gate');
});

test('finalized topics are preserved and excluded from the active tail', async () => {
  const storage = new InMemoryStorage();
  const finalized: CanonicalTopic = {
    topicId: 'T1', status: 'finalized', labelTerms: ['old', 'topic'], retrievalTerms: ['old', 'topic', 'done'],
    spans: [{ startSequence: 1, endSequence: 2 }], startedAt: 1000, endedAt: 2100, updatedAt: 2200, source: 'topic_worker_v1',
  };
  await storage.replaceTopics([finalized]);
  let workerInput = '';
  const worker: MemoryLlm = { complete: async (input) => {
    workerInput = input.user;
    return JSON.stringify({ topics: [{ status: 'provisional', labelTerms: ['new', 'topic'], retrievalTerms: ['new', 'topic', 'active'], spans: [{ startSequence: 3, endSequence: 8 }] }] });
  } };
  const memory = createMemory({ storage, topicWorker: worker, selector: { complete: async () => JSON.stringify({ needsMemory: false, topicIds: [], needsTimeMetadata: false }) } });
  await addCompleted(memory, 8);
  assert.equal((await memory.maybeRunTopicWorker()).reason, 'accepted');
  assert.ok(!workerInput.includes('#1\n')); assert.ok(workerInput.includes('#3\n'));
  const topics = await memory.listTopics();
  assert.equal(topics[0].topicId, 'T1'); assert.equal(topics[0].status, 'finalized'); assert.equal(topics[1].topicId, 'T2');
});

test('selector failure safely degrades to empty long-term memory', async () => {
  const memory = createMemory({
    storage: new InMemoryStorage(),
    topicWorker: { complete: async () => workerJson },
    selector: { complete: async () => { throw new Error('selector down'); } },
  });
  await addCompleted(memory); await memory.maybeRunTopicWorker();
  const result = await memory.retrieve({ userMessage: 'remember?' });
  assert.equal(result.memoryContext, ''); assert.match(result.trace.selectorError ?? '', /selector down/);
});

test('time metadata is included when the user asks about timing', async () => {
  const memory = createMemory({ storage: new InMemoryStorage(), llm: dualPurposeLlm() });
  await addCompleted(memory); await memory.maybeRunTopicWorker();
  const result = await memory.retrieve({ userMessage: '我们当时什么时候聊东京的？', now: 10_000 });
  assert.equal(result.needsTimeMetadata, true); assert.match(result.openedTopicPackets[0], /userSentAt:/);
});

test('InMemoryStorage satisfies the storage contract', async () => { await storageContract(new InMemoryStorage()); });
test('IndexedDbMemoryStorage satisfies the storage contract', async () => { await storageContract(new IndexedDbMemoryStorage({ dbName: `test-${Date.now()}`, indexedDB: fakeIndexedDB })); });

test('end-to-end pipeline returns non-empty memoryContext to a host-owned Main LLM', async () => {
  const memory = createMemory({ storage: new InMemoryStorage(), llm: dualPurposeLlm() });
  await addCompleted(memory);
  assert.equal((await memory.maybeRunTopicWorker()).reason, 'accepted');
  const retrieved = await memory.retrieve({ userMessage: 'remind me about Tokyo' });
  let hostReceived = '';
  const myOwnMainLlm = async (input: { userMessage: string; memoryContext: string }) => { hostReceived = input.memoryContext; return `host reply to ${input.userMessage}`; };
  await myOwnMainLlm({ userMessage: 'remind me about Tokyo', memoryContext: retrieved.memoryContext });
  assert.ok(hostReceived.length > 0); assert.match(hostReceived, /MEMORY_SECTION_FROM_TOPIC_STORE/);
});
