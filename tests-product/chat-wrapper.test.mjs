import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import OpenAI from 'openai';
import { createMemory } from '../build-product/product/index.js';
import { createMemoryChat } from '../build-product/product/chat.js';
import { count_tokens } from '../build-product/longmemory/core/recall/context_builder.js';

// These are deterministic integration fixtures, not a live embedding accuracy test.
const vector = text => {
  if (/tokyo|hotel|lodging|东京|酒店|上野/i.test(text)) return [1, 0, 0, 0];
  if (/paris|巴黎/i.test(text)) return [0, 1, 0, 0];
  if (/cat|pet|猫/i.test(text)) return [0, 0, 1, 0];
  return [0, 0, 0, 1];
};
const config = (overrides = {}) => ({
  dbPath: join(mkdtempSync(join(tmpdir(), 'memory-chat-wrapper-')), 'memory.sqlite'),
  embedding: { kind: 'custom', id: 'wrapper-test-v1', dimension: 4, embed: async text => vector(text) },
  minSemanticSimilarity: 0.8,
  maxEvidenceTokens: 512,
  ...overrides,
});
const scope = (sessionId = 'trip', personaId) => JSON.stringify([personaId ?? null, sessionId]);
const request = (content, extra = {}) => ({
  userId: 'alice', sessionId: 'trip', model: 'original-model',
  messages: [{ role: 'user', content }], ...extra,
});
const response = (content, finish = 'stop') => ({
  id: 'test-completion', object: 'chat.completion', created: 1, model: 'original-model',
  choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: finish, logprobs: null }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const chunk = (content, finish = null) => ({
  id: 'test-stream', object: 'chat.completion.chunk', created: 1, model: 'original-model',
  choices: [{ index: 0, delta: content === undefined ? {} : { content }, finish_reason: finish, logprobs: null }],
});
const fakeClient = fn => ({ chat: { completions: { create: fn } } });
const evidence = messages => messages.filter(m => typeof m.content === 'string' && m.content.includes('<memory_evidence>'));
const use = (t, options) => {
  const chat = createMemoryChat(options);
  t.after(() => chat.close());
  return chat;
};
async function history(memoryConfig, userId = 'alice', sessionId = 'trip', personaId) {
  const memory = createMemory({ ...memoryConfig, ownerId: userId });
  try { return await memory.history(scope(sessionId, personaId)); }
  finally { await memory.close(); }
}
async function seed(memoryConfig, turns, { userId = 'alice', sessionId = 'trip', personaId } = {}) {
  const memory = createMemory({ ...memoryConfig, ownerId: userId });
  try {
    for (const turn of turns) await memory.remember({ ...turn, sessionId: scope(sessionId, personaId) });
  } finally { await memory.close(); }
}
function streamFixture(chunks, failure) {
  const controller = new AbortController();
  let cleaned = false;
  const stream = {
    controller,
    async *[Symbol.asyncIterator]() {
      try {
        for (const part of chunks) {
          if (controller.signal.aborted) return;
          yield part;
        }
        if (failure) throw failure;
      } finally { cleaned = true; }
    },
  };
  return { stream, controller, cleaned: () => cleaned };
}

test('wrapper forwards ordinary model parameters/options and saves exact visible speech', async t => {
  const memory = config();
  const calls = [];
  const answer = response('  Hotel recommendation.\nPreserve this spacing.  ');
  const chat = use(t, { memory, client: fakeClient(async (body, options) => {
    calls.push({ body, options }); return answer;
  }) });
  const abort = new AbortController();
  const options = { signal: abort.signal, headers: { 'x-app-request': 'request-17' } };
  const input = request('  东京酒店预算是 14000 日元。\n', {
    personaId: 'travel-helper', temperature: 0.2, max_tokens: 117,
    messages: [{ role: 'system', content: 'Keep the original application instruction.' },
      { role: 'developer', content: 'Reply concisely.' }, { role: 'user', content: '  东京酒店预算是 14000 日元。\n' }],
  });
  const original = structuredClone(input);
  assert.strictEqual(await chat.create(input, options), answer);
  assert.deepEqual(input, original);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'original-model');
  assert.equal(calls[0].body.temperature, 0.2);
  assert.equal(calls[0].body.max_tokens, 117);
  assert.equal(calls[0].body.userId, undefined);
  assert.equal(calls[0].body.sessionId, undefined);
  assert.equal(calls[0].body.personaId, undefined);
  assert.strictEqual(calls[0].options.signal, abort.signal);
  assert.equal(calls[0].options.headers['x-app-request'], 'request-17');
  assert.ok(calls[0].body.messages.some(m => m.role === 'developer' && m.content === 'Reply concisely.'));
  await chat.close();
  const saved = await history(memory, 'alice', 'trip', 'travel-helper');
  assert.deepEqual(saved.map(s => s.exactText), [original.messages.at(-1).content, answer.choices[0].message.content]);
});

test('automatic recent context and older exact evidence survive restart without extra generative calls', async t => {
  const memory = config();
  const first = use(t, { memory, recentTurns: 1, client: fakeClient(async () => response('Hotel Sakura is recorded.')) });
  await first.create(request('东京上野 Sakura Hotel，每晚 14000 日元。'));
  await first.close();
  const sent = [];
  const second = use(t, { memory, recentTurns: 1, client: fakeClient(async body => {
    sent.push(body); return response(sent.length === 1 ? 'Your cat is Momo.' : 'The hotel was Sakura Hotel.');
  }) });
  await second.create(request('My cat is Momo.'));
  assert.ok(sent[0].messages.some(m => m.role === 'user' && m.content.includes('14000')));
  await second.create(request('Which Tokyo hotel did I mention?'));
  assert.equal(sent.length, 2);
  assert.ok(evidence(sent[1].messages).some(m => m.content.includes('东京上野 Sakura Hotel，每晚 14000 日元。')));
  assert.ok(sent[1].messages.some(m => m.role === 'user' && m.content === 'My cat is Momo.'));
  await second.close();
  const saved = await history(memory);
  assert.equal(saved.length, 6);
  assert.ok(saved.every(s => !s.exactText.includes('<memory_evidence>')));
});

test('exact retained pairs are deduplicated; pairs removed by the recent budget remain retrievable', async t => {
  const memory = config();
  const old = { turnId: 'old', user: 'Tokyo hotel is Sakura, budget 14000 yen.', assistant: 'Sakura Hotel noted.' };
  await seed(memory, [old]);
  const calls = [];
  const chat = use(t, { memory, recentTurns: 1, recentMaxChars: 100,
    client: fakeClient(async body => { calls.push(body); return response('Answer.'); }) });
  await chat.create(request('Which Tokyo hotel?', { messages: [
    { role: 'user', content: old.user }, { role: 'assistant', content: old.assistant },
    { role: 'user', content: 'Which Tokyo hotel?' },
  ] }));
  assert.equal(evidence(calls[0].messages).length, 0);
  await chat.create(request('Which Tokyo hotel?', { messages: [
    { role: 'user', content: old.user }, { role: 'assistant', content: old.assistant },
    { role: 'user', content: 'A newer unrelated pet question.' }, { role: 'assistant', content: 'Your cat is fine.' },
    { role: 'user', content: 'Which Tokyo hotel?' },
  ] }));
  assert.ok(evidence(calls[1].messages).some(m => m.content.includes(old.user)));
  assert.ok(!calls[1].messages.some(m => m.role === 'user' && m.content === old.user));
});

test('user, persona and session scope are enforced before recent context and retrieval', async t => {
  const memory = config();
  await seed(memory, [{ user: 'Tokyo hotel private code SECRET-481.', assistant: 'Tokyo hotel saved.' }], { personaId: 'traveler' });
  const calls = [];
  const chat = use(t, { memory, recentTurns: 0, client: fakeClient(async body => {
    calls.push(body); return response('No earlier detail available.');
  }) });
  await chat.create(request('Tokyo hotel private code?', { userId: 'bob', personaId: 'traveler' }));
  await chat.create(request('Tokyo hotel private code?', { sessionId: 'another-trip', personaId: 'traveler' }));
  await chat.create(request('Tokyo hotel private code?', { personaId: 'other-persona' }));
  assert.ok(calls.every(call => !JSON.stringify(call.messages).includes('SECRET-481')));
  await chat.create(request('Tokyo hotel private code?', { personaId: 'traveler' }));
  assert.ok(evidence(calls[3].messages).some(m => m.content.includes('SECRET-481')));
});

test('the whole injected evidence block including delimiters fits the configured budget', async t => {
  const memory = config({ maxEvidenceTokens: 70 });
  await seed(memory, [{ user: 'Tokyo hotel detail '.repeat(180), assistant: 'Hotel details saved.' }]);
  let outgoing;
  const chat = use(t, { memory, recentTurns: 0, client: fakeClient(async body => {
    outgoing = body; return response('A reply.');
  }) });
  await chat.create(request('Tokyo hotel details?'));
  const blocks = evidence(outgoing.messages);
  assert.equal(blocks.length, 1);
  assert.ok(count_tokens(blocks[0].content) <= 70);
  assert.match(blocks[0].content, /source=/);
});

test('query embedding failure still returns the unchanged model response with sanitized diagnostics', async t => {
  const events = [];
  const memory = config();
  memory.embedding.embed = async (text, context) => {
    if (context?.purpose === 'query') throw new Error('secret-key-and-query-DO-NOT-LEAK');
    return vector(text);
  };
  await seed(memory, [{ user: 'Tokyo hotel is Sakura.', assistant: 'Hotel saved.' }]);
  const answer = response('Normal main-model reply.');
  const chat = use(t, { memory, recentTurns: 0, onMemoryEvent: event => events.push(event),
    client: fakeClient(async () => answer) });
  assert.strictEqual(await chat.create(request('Tokyo hotel?')), answer);
  assert.ok(events.some(event => event.stage === 'retrieve'));
  assert.ok(!JSON.stringify(events).includes('DO-NOT-LEAK'));
});

test('indexing failure preserves the completed exact exchange and never discards the answer', async t => {
  const events = [];
  const memory = config();
  memory.embedding.embed = async () => { throw new Error('private-provider-body'); };
  const answer = response('A successful visible reply.');
  const chat = use(t, { memory, onMemoryEvent: event => { events.push(event); throw new Error('observer failed'); },
    client: fakeClient(async () => answer) });
  assert.strictEqual(await chat.create(request('A real visible user message.')), answer);
  await chat.close();
  const stored = await history(memory);
  assert.deepEqual(stored.map(s => s.exactText), ['A real visible user message.', 'A successful visible reply.']);
  assert.ok(events.some(event => event.stage === 'index'));
  assert.ok(!JSON.stringify(events).includes('private-provider-body'));
});

test('unavailable local storage reports memory errors without blocking the normal upstream response', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-chat-storage-error-'));
  const blocker = join(dir, 'not-a-directory');
  writeFileSync(blocker, 'fixture');
  const memory = config({ dbPath: join(blocker, 'memory.sqlite') });
  const events = [];
  const answer = response('Chat succeeds despite the local storage failure.');
  const chat = use(t, { memory, onMemoryEvent: e => events.push(e), client: fakeClient(async () => answer) });
  assert.strictEqual(await chat.create(request('Hello.')), answer);
  assert.ok(events.some(e => e.stage === 'history' || e.stage === 'retrieve'));
  assert.ok(events.some(e => e.stage === 'save'));
});

test('upstream errors propagate unchanged and no failed exchange is stored', async t => {
  const memory = config();
  const failure = new Error('upstream refused request');
  const chat = use(t, { memory, client: fakeClient(async () => { throw failure; }) });
  await assert.rejects(chat.create(request('Hello.')), error => error === failure);
  await chat.close();
  assert.deepEqual(await history(memory), []);
});

test('stream yields original chunks and saves only the naturally completed visible text', async t => {
  const memory = config();
  const pieces = [chunk('Hello '), chunk('there.\n'), chunk(undefined, 'stop'),
    { id: 'test-stream', choices: [], usage: { total_tokens: 6 } }];
  const fixture = streamFixture(pieces);
  const chat = use(t, { memory, client: fakeClient(async () => fixture.stream) });
  const result = await chat.create(request('Say hello.', { stream: true }));
  assert.ok(result.controller);
  const received = [];
  for await (const part of result) received.push(part);
  assert.equal(received.length, pieces.length);
  for (let i = 0; i < pieces.length; i++) assert.strictEqual(received[i], pieces[i]);
  assert.equal(fixture.cleaned(), true);
  await chat.close();
  assert.deepEqual((await history(memory)).map(s => s.exactText), ['Say hello.', 'Hello there.\n']);
});

test('breaking stream consumption cancels cleanup and never records a partial reply', async t => {
  const memory = config();
  const fixture = streamFixture([chunk('Only partial'), chunk(' continued'), chunk(undefined, 'stop')]);
  const chat = use(t, { memory, client: fakeClient(async () => fixture.stream) });
  for await (const part of await chat.create(request('Say hello.', { stream: true }))) {
    assert.ok(part); break;
  }
  assert.equal(fixture.cleaned(), true);
  await chat.close();
  assert.deepEqual(await history(memory), []);
});

test('stream transport error propagates and neither error nor length truncation is saved', async t => {
  const memory = config();
  const failure = new Error('stream connection lost');
  const broken = streamFixture([chunk('Partial reply')], failure);
  const short = streamFixture([chunk('Truncated reply'), chunk(undefined, 'length')]);
  let calls = 0;
  const chat = use(t, { memory, client: fakeClient(async () => ++calls === 1 ? broken.stream : short.stream) });
  await assert.rejects(async () => {
    for await (const _ of await chat.create(request('Hello.', { stream: true }))) {}
  }, error => error === failure);
  for await (const _ of await chat.create(request('Another question.', { stream: true }))) {}
  await chat.close();
  assert.deepEqual(await history(memory), []);
});

test('closing a returned but unconsumed stream aborts it and leaves no completed memory', async t => {
  const memory = config();
  const fixture = streamFixture([chunk('not consumed'), chunk(undefined, 'stop')]);
  const chat = use(t, { memory, client: fakeClient(async () => fixture.stream) });
  const pendingStream = await chat.create(request('Hello.', { stream: true }));
  await chat.close();
  assert.equal(pendingStream.controller.signal.aborted, true);
  assert.deepEqual(await history(memory), []);
});

test('tools and multimodal input bypass memory without altering the upstream request or recording it', async t => {
  const memory = config();
  const calls = [];
  const events = [];
  const chat = use(t, { memory, onMemoryEvent: e => events.push(e), client: fakeClient(async body => {
    calls.push(body); return response('Upstream unsupported-mode result.');
  }) });
  const tool = request('Weather?', { tools: [{ type: 'function', function: { name: 'weather', parameters: { type: 'object' } } }] });
  const image = request('Describe image', { messages: [{ role: 'user', content: [
    { type: 'text', text: 'Describe this image.' }, { type: 'image_url', image_url: { url: 'https://example.invalid/picture.png' } },
  ] }] });
  await chat.create(tool);
  await chat.create(image);
  assert.deepEqual(calls[0].tools, tool.tools);
  assert.deepEqual(calls[1].messages, image.messages);
  assert.ok(events.filter(e => e.stage === 'skipped').length >= 2);
  await chat.close();
  assert.deepEqual(await history(memory), []);
});

test('real OpenAI client works with the wrapper for JSON and SSE using a fully local mock transport', async t => {
  const memory = config();
  const captured = [];
  const client = new OpenAI({ apiKey: 'local-fixture-only', baseURL: 'https://fixture.invalid/v1', maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      captured.push(body);
      if (body.stream) {
        const parts = [chunk('Sakura '), chunk('Hotel.'), chunk(undefined, 'stop')];
        const sse = parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify(response('Your Tokyo hotel is recorded.')), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  const chat = use(t, { memory, recentTurns: 0, client });
  const ordinary = await chat.create(request('My Tokyo hotel is Sakura Hotel.'));
  assert.equal(ordinary.choices[0].message.content, 'Your Tokyo hotel is recorded.');
  let answer = '';
  for await (const part of await chat.create(request('What was my Tokyo hotel?', { stream: true }))) {
    answer += part.choices[0]?.delta?.content ?? '';
  }
  assert.equal(answer, 'Sakura Hotel.');
  assert.equal(captured.length, 2);
  assert.ok(evidence(captured[1].messages).some(m => m.content.includes('My Tokyo hotel is Sakura Hotel.')));
  await chat.close();
  assert.equal((await history(memory)).length, 4);
});

test('repeated identical visible exchanges remain distinct completed events', async t => {
  const memory = config();
  const chat = use(t, { memory, client: fakeClient(async () => response('Hello again.')) });
  await chat.create(request('Hello.'));
  await chat.create(request('Hello.'));
  await chat.close();
  const stored = await history(memory);
  assert.equal(stored.length, 4);
  assert.equal(new Set(stored.map(source => source.turnId)).size, 2);
  assert.deepEqual(stored.map(source => source.exactText), ['Hello.', 'Hello again.', 'Hello.', 'Hello again.']);
});

test('overlapping same-session requests wait for the first completed exchange; other sessions proceed', { timeout: 5000 }, async t => {
  const memory = config();
  const sent = [];
  let acknowledgeStart;
  const started = new Promise(resolve => { acknowledgeStart = resolve; });
  let releaseFirst;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  const chat = use(t, { memory, client: fakeClient(async body => {
    sent.push(body);
    if (body.messages.at(-1).content === 'First question.') {
      acknowledgeStart();
      return firstResponse;
    }
    return response('Another answer.');
  }) });
  const first = chat.create(request('First question.'));
  await started;
  const second = chat.create(request('Second question.'));
  await chat.create(request('Independent question.', { sessionId: 'independent' }));
  assert.deepEqual(sent.map(body => body.messages.at(-1).content), ['First question.', 'Independent question.']);
  releaseFirst(response('First answer.'));
  await first;
  await second;
  assert.equal(sent.length, 3);
  assert.ok(sent[2].messages.some(message => message.role === 'user' && message.content === 'First question.'));
  assert.ok(sent[2].messages.some(message => message.role === 'assistant' && message.content === 'First answer.'));
  await chat.close();
  assert.equal((await history(memory)).length, 4);
});

test('external AbortSignal cancels a pending stream read and frees its session without saving', { timeout: 5000 }, async t => {
  const memory = config();
  const upstreamController = new AbortController();
  const callerController = new AbortController();
  let returned = false;
  const upstream = {
    controller: upstreamController,
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((_resolve, reject) => {
          upstreamController.signal.addEventListener('abort', () => reject(new Error('upstream stream aborted')), { once: true });
        }),
        async return() { returned = true; return { done: true, value: undefined }; },
      };
    },
  };
  let calls = 0;
  const chat = use(t, { memory, client: fakeClient(async () => ++calls === 1 ? upstream : response('Next request works.')) });
  const stream = await chat.create(request('Cancelled question.', { stream: true }), { signal: callerController.signal });
  const pending = stream[Symbol.asyncIterator]().next();
  callerController.abort();
  await assert.rejects(pending, /stream aborted/);
  assert.equal(upstreamController.signal.aborted, true);
  await chat.create(request('Question after cancellation.'));
  await chat.close();
  assert.equal(returned, true);
  assert.deepEqual((await history(memory)).map(source => source.exactText), ['Question after cancellation.', 'Next request works.']);
});

test('streamed response remains complete when final memory persistence is unavailable', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-stream-storage-error-'));
  const blocker = join(dir, 'not-a-directory');
  writeFileSync(blocker, 'fixture');
  const memory = config({ dbPath: join(blocker, 'memory.sqlite') });
  const events = [];
  const parts = [chunk('Visible answer '), chunk('still arrives.'), chunk(undefined, 'stop')];
  const fixture = streamFixture(parts);
  const chat = use(t, { memory, onMemoryEvent: event => events.push(event), client: fakeClient(async () => fixture.stream) });
  const received = [];
  for await (const part of await chat.create(request('Hello.', { stream: true }))) received.push(part);
  assert.deepEqual(received, parts);
  assert.ok(events.some(event => event.stage === 'save' && event.status === 'error'));
  assert.equal(fixture.cleaned(), true);
});

test('close waits for an aborted pending read and upstream iterator cleanup', { timeout: 5000 }, async t => {
  const memory = config();
  const controller = new AbortController();
  let startedCleanup;
  const cleanupStarted = new Promise(resolve => { startedCleanup = resolve; });
  let finishCleanup;
  const cleanupGate = new Promise(resolve => { finishCleanup = resolve; });
  const upstream = {
    controller,
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('aborted during pending read')), { once: true });
        }),
        async return() {
          startedCleanup();
          await cleanupGate;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const chat = use(t, { memory, client: fakeClient(async () => upstream) });
  const stream = await chat.create(request('Cancelled during shutdown.', { stream: true }));
  const next = stream[Symbol.asyncIterator]().next();
  let closed = false;
  const closing = chat.close().then(() => { closed = true; });
  await assert.rejects(next, /aborted during pending read/);
  await cleanupStarted;
  // Advance one event-loop turn so all queued close promises run; cleanup remains explicitly gated.
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(closed, false, 'close resolved while the upstream iterator was still cleaning up'); }
  finally { finishCleanup(); await closing; }
  assert.equal(closed, true);
  assert.deepEqual(await history(memory), []);
});

test('invalid setup is rejected before any upstream model request is attempted', () => {
  let calls = 0;
  const client = fakeClient(async () => { calls++; return response('Should not be called.'); });
  const memory = config();
  assert.throws(() => createMemoryChat({ client: {}, memory }), /Chat Completions client/);
  assert.throws(() => createMemoryChat({ client, memory: {} }), /embedding configuration/);
  assert.throws(() => createMemoryChat({ client, memory: { ...memory, embedding: { ...memory.embedding, dimension: 0 } } }), /dimension/);
  assert.throws(() => createMemoryChat({ client, memory: { ...memory,
    embedding: { kind: 'nvidia', model: 'nvidia/nemotron-3-embed-1b', dimension: 2048, apiKey: '' },
  } }), /apiKey/);
  assert.throws(() => createMemoryChat({ client, memory, recentTurns: -1 }), /recentTurns/);
  assert.equal(calls, 0);
});

test('an asynchronously rejected diagnostic callback cannot fail chat or become an unhandled rejection', async t => {
  const memory = config();
  let events = 0;
  const answer = response('Completed normally.');
  const chat = use(t, { memory, client: fakeClient(async () => answer), onMemoryEvent: async () => {
    events++;
    await Promise.resolve();
    throw new Error('diagnostic-only rejected promise');
  } });
  assert.strictEqual(await chat.create(request('Hello.')), answer);
  // Let rejected callback promises settle; node:test reports any unhandled rejection as a failure.
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(events > 0);
  await chat.close();
  assert.deepEqual((await history(memory)).map(source => source.exactText), ['Hello.', 'Completed normally.']);
});
