import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createMemory } from '../build-product/product/index.js';

const db = () => join(mkdtempSync(join(tmpdir(), 'memory-product-')), 'memory.sqlite');
const vector = (text) => {
  const value = text.toLowerCase();
  if (/东京|tokyo|japan|日本|上野|ueno|hotel|酒店|旅馆/.test(value)) return [1, 0, 0, 0];
  if (/巴黎|paris|france|法国/.test(value)) return [0, 1, 0, 0];
  if (/猫|cat|pet|宠物/.test(value)) return [0, 0, 1, 0];
  return [0, 0, 0, 1];
};
const config = (dbPath, embed = async (text) => vector(text)) => ({
  dbPath, embedding: { kind: 'custom', id: 'test-semantic-v1', dimension: 4, embed },
  minSemanticSimilarity: 0.8,
});

test('exact sources survive restart and paraphrase retrieval', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  const saved = await memory.remember({ sessionId: 'trip', turnId: 'trip-1', user: '东京上野的 Sakura Hotel，每晚 14000 日元。', assistant: '记下了：Sakura Hotel，每晚 14000 日元。' });
  assert.deepEqual(saved.failed, []);
  const history = await memory.history('trip');
  assert.equal(history[0].exactText, '东京上野的 Sakura Hotel，每晚 14000 日元。');
  assert.equal(history[1].exactText, '记下了：Sakura Hotel，每晚 14000 日元。');
  await memory.close();

  const reopened = createMemory(config(dbPath));
  const recalled = await reopened.recall({ sessionId: 'trip', query: 'Which Japan lodging did I mention?', limit: 3 });
  assert.ok(recalled.sources.some((source) => source.sourceId === 'trip-1:user'));
  assert.ok(recalled.context.includes('Sakura Hotel'));
  assert.ok(recalled.sources.every((source) => source.exactRange.end <= source.exactRange.total));
  await reopened.close();
});

test('session isolation and no-memory rejection', async () => {
  const memory = createMemory(config(db()));
  await memory.remember({ sessionId: 'A', user: '我在东京订了上野的 Sakura Hotel。', assistant: '好的。' });
  await memory.remember({ sessionId: 'B', user: '我养了一只猫叫豆豆。', assistant: '记住了。' });
  const b = await memory.recall({ sessionId: 'B', query: '东京酒店是哪家？' });
  assert.equal(b.sources.length, 0);
  const noMatch = await memory.recall({ sessionId: 'A', query: '我养的宠物叫什么？' });
  assert.equal(noMatch.sources.length, 0);
  await memory.close();
});

test('a factual conversational utterance needs transcript provenance, not external verification', async () => {
  const dbPath = db();
  const memory = createMemory({ dbPath, minSemanticSimilarity: 0.8,
    embedding: { kind: 'custom', id: 'utterance-contract', dimension: 2, embed: async () => [1, 0] } });
  const user = 'My appointment is at 09:15.';
  await memory.remember({ sessionId: 'appointments', turnId: 'time', user, assistant: 'Understood.' });
  const result = await memory.recall({ sessionId: 'appointments', query: 'appointment' });
  assert.equal(result.sources.find((source) => source.sourceId === 'time:user')?.text, user);
  await memory.close();
  const reopened = createMemory({ dbPath, minSemanticSimilarity: 0.8,
    embedding: { kind: 'custom', id: 'utterance-contract', dimension: 2, embed: async () => [1, 0] } });
  assert.ok((await reopened.recall({sessionId: 'appointments', query: 'appointment'})).sources.some(source => source.sourceId === 'time:user'));
  await reopened.close();
});

test('recent turns are excluded before exact evidence is budgeted', async () => {
  const memory = createMemory(config(db()));
  await memory.remember({ sessionId: 'trip', turnId: 'older',
    user: '东京酒店是 Sakura Hotel。', assistant: '记住了 Sakura Hotel。' });
  await memory.remember({ sessionId: 'trip', turnId: 'recent',
    user: '东京酒店刚改成 Maple Hotel。', assistant: '好的，Maple Hotel。' });
  const result = await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？',
    excludeTurnIds: ['recent'], limit: 2, maxEvidenceTokens: 100 });
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.every((source) => source.turnId === 'older'));
  assert.ok(result.trace.rejected.some((item) => item.reason === 'already supplied in recent context'));
  assert.ok(!result.context.includes('Maple Hotel'));
  await memory.close();
});

test('explicit correction supersedes current evidence but retains exact history', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  await memory.remember({ sessionId: 'trip', turnId: 'old', recordedAt: 1000,
    user: '东京旅行住 Sakura Hotel。', assistant: '好的，住 Sakura Hotel。' });
  await memory.remember({ sessionId: 'trip', turnId: 'new', recordedAt: 2000,
    supersedesSourceId: 'old:user', user: '更正：东京旅行改住 Maple Hotel。', assistant: '收到，改住 Maple Hotel。' });
  const current = await memory.recall({ sessionId: 'trip', query: '东京旅行的酒店是什么？' });
  assert.ok(current.sources.some((source) => source.sourceId === 'new:user'));
  assert.ok(!current.sources.some((source) => source.sourceId === 'old:user'));
  assert.ok(!current.sources.some((source) => source.sourceId === 'old:assistant'));
  const before = await memory.recall({ sessionId: 'trip', query: '东京旅行酒店', asOf: 1500 });
  assert.ok(before.sources.some((source) => source.sourceId === 'old:user'));
  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  assert.ok(store.load_edges().some((edge) => edge.type === 'supersedes' && edge.from === 'new:user' && edge.to === 'old:user'));
  assert.ok(store.load_edges().some((edge) => edge.type === 'supersedes' && edge.from === 'new:assistant' && edge.to === 'old:assistant'));
  assert.equal(store.load_node('old:user').temporal.superseded_at, 2000);
  assert.equal(store.load_node('old:assistant').temporal.superseded_at, 2000);
  store.close();
  await memory.close();
});

test('same turnId retries reject changed correction or explicit time metadata', async () => {
  const memory = createMemory(config(db()));
  await memory.remember({ sessionId: 'trip', turnId: 'A', recordedAt: 1000,
    user: '东京酒店是 Sakura Hotel。', assistant: '收到。' });
  await memory.remember({ sessionId: 'trip', turnId: 'X', recordedAt: 1100,
    user: '巴黎酒店是 Blue Hotel。', assistant: '收到。' });
  const correction = { sessionId: 'trip', turnId: 'B', recordedAt: 2000, validFrom: 1500,
    supersedesSourceId: 'A:assistant', user: '东京酒店改为 Maple Hotel。', assistant: '收到。' };
  await memory.remember(correction);
  await memory.remember({ ...correction, supersedesSourceId: 'A:user' });
  await assert.rejects(() => memory.remember({ ...correction, supersedesSourceId: 'X:user' }),
    /different correction or time metadata/);
  await assert.rejects(() => memory.remember({ ...correction, supersedesSourceId: undefined }),
    /different correction or time metadata/);
  await assert.rejects(() => memory.remember({ ...correction, recordedAt: 2001 }),
    /different correction or time metadata/);
  await assert.rejects(() => memory.remember({ ...correction, validFrom: 1600 }),
    /different correction or time metadata/);
  await assert.rejects(() => memory.remember({ ...correction, validFrom: undefined }),
    /different correction or time metadata/);

  await memory.remember({ sessionId: 'trip', turnId: 'plain', recordedAt: 3000,
    user: '另外订了火车票。', assistant: '收到。' });
  await memory.remember({ sessionId: 'trip', turnId: 'plain',
    user: '另外订了火车票。', assistant: '收到。' });
  assert.equal((await memory.history('trip')).filter((source) => source.turnId === 'plain').length, 2);
  await memory.close();
});

test('restart repairs a correction edge after its predecessor embedding recovers', async () => {
  const dbPath = db();
  let predecessorUnavailable = true;
  let correctionEmbeds = 0;
  const embed = async (text) => {
    if (text === '东京酒店是 Sakura Hotel。' && predecessorUnavailable) {
      throw new Error('temporary embedding outage');
    }
    if (text === '东京酒店改为 Maple Hotel。') correctionEmbeds++;
    return vector(text);
  };
  const first = createMemory(config(dbPath, embed));
  assert.deepEqual((await first.remember({ sessionId: 'trip', turnId: 'A', recordedAt: 1000,
    user: '东京酒店是 Sakura Hotel。', assistant: '收到。' })).failed, ['A:user']);
  assert.deepEqual((await first.remember({ sessionId: 'trip', turnId: 'B', recordedAt: 2000,
    supersedesSourceId: 'A:user', user: '东京酒店改为 Maple Hotel。', assistant: '收到。' })).failed, []);
  await first.close();

  const initialCorrectionEmbeds = correctionEmbeds;
  const stillUnavailable = createMemory(config(dbPath, embed));
  await stillUnavailable.history('trip');
  assert.equal(correctionEmbeds, initialCorrectionEmbeds);
  await stillUnavailable.close();

  predecessorUnavailable = false;
  const recovered = createMemory(config(dbPath, embed));
  const history = await recovered.history('trip');
  assert.equal(history.find((source) => source.sourceId === 'A:user').derivationStatus, 'indexed');
  assert.equal(history.find((source) => source.sourceId === 'A:user').supersededBy, 'B:user');
  assert.ok(!(await recovered.recall({ sessionId: 'trip', query: '东京酒店是哪家？' })).sources
    .some((source) => source.sourceId === 'A:user'));
  await recovered.close();

  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  assert.ok(store.load_edges().some((edge) => edge.type === 'supersedes'
    && edge.from === 'B:user' && edge.to === 'A:user'));
  assert.equal(store.load_node('A:user').state.status, 'superseded');
  store.close();
});

test('embedding failure does not lose exact source and rebuild can repair it', async () => {
  const dbPath = db();
  let fail = true;
  const embed = async (text) => {
    if (fail) throw new Error('embedding provider offline');
    return vector(text);
  };
  const memory = createMemory(config(dbPath, embed));
  const first = await memory.remember({ sessionId: 'trip', turnId: 'one',
    user: '东京上野酒店是 Sakura Hotel。', assistant: '收到。' });
  assert.equal(first.failed.length, 2);
  assert.equal((await memory.history('trip'))[0].exactText, '东京上野酒店是 Sakura Hotel。');
  fail = false;
  const rebuilt = await memory.rebuild('trip');
  assert.equal(rebuilt.failed, 0);
  assert.ok((await memory.recall({ sessionId: 'trip', query: 'Japan hotel?' })).sources.length > 0);
  await memory.close();
});

test('erasure removes the exact source and its derived candidate', async () => {
  const memory = createMemory(config(db()));
  await memory.remember({ sessionId: 'trip', turnId: 'private',
    user: '东京酒店的私人代码是 ZX-938。', assistant: '知道了。' });
  assert.equal((await memory.erase({ sessionId: 'trip', sourceId: 'private:user' })).erased, true);
  assert.deepEqual((await memory.history('trip')).map((source) => source.sourceId), []);
  const recalled = await memory.recall({ sessionId: 'trip', query: '东京酒店私人代码是什么？' });
  assert.ok(!recalled.context.includes('ZX-938'));
  await memory.close();
});

test('erasing the newer correction restores the older source and derived graph', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  await memory.remember({ sessionId: 'trip', turnId: 'A', recordedAt: 1000,
    user: '东京酒店是 Sakura Hotel。', assistant: '收到。' });
  await memory.remember({ sessionId: 'trip', turnId: 'B', recordedAt: 2000,
    supersedesSourceId: 'A:user', user: '东京酒店改为 Maple Hotel。', assistant: '收到。' });
  assert.equal((await memory.erase({ sessionId: 'trip', sourceId: 'B:user' })).erased, true);
  const history = await memory.history('trip');
  assert.equal(history.find((source) => source.sourceId === 'A:user').supersededBy, null);
  assert.ok(!history.some((source) => source.sourceId === 'B:user'));
  assert.ok(!history.some((source) => source.sourceId === 'B:assistant'));
  assert.equal(history.find((source) => source.sourceId === 'A:assistant').supersededBy, null);
  const current = await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？' });
  assert.ok(current.sources.some((source) => source.sourceId === 'A:user'));
  assert.ok(!current.sources.some((source) => source.sourceId === 'B:user'));
  await memory.close();

  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  assert.equal(store.load_node('B:user'), null);
  assert.equal(store.load_node('B:assistant'), null);
  assert.equal(store.load_node('A:user').state.status, 'active');
  assert.equal(store.load_node('A:assistant').state.status, 'active');
  assert.ok(store.load_edges().every((edge) => !['B:user', 'B:assistant'].includes(edge.from)
    && !['B:user', 'B:assistant'].includes(edge.to)));
  store.close();

  const reopened = createMemory(config(dbPath));
  await reopened.rebuild('trip');
  assert.ok((await reopened.recall({ sessionId: 'trip', query: '东京酒店是哪家？' })).sources
    .some((source) => source.sourceId === 'A:user'));
  await reopened.close();
});

test('erasing the older source leaves the newer source active without dangling links', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  await memory.remember({ sessionId: 'trip', turnId: 'A', recordedAt: 1000,
    user: '东京酒店是 Sakura Hotel。', assistant: '收到。' });
  await memory.remember({ sessionId: 'trip', turnId: 'B', recordedAt: 2000,
    supersedesSourceId: 'A:user', user: '东京酒店改为 Maple Hotel。', assistant: '收到。' });
  assert.equal((await memory.erase({ sessionId: 'trip', sourceId: 'A:user' })).erased, true);
  const current = await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？' });
  assert.ok(current.sources.some((source) => source.sourceId === 'B:user'));
  assert.ok(!current.sources.some((source) => source.sourceId === 'A:user'));
  assert.ok(!current.sources.some((source) => source.sourceId === 'A:assistant'));
  assert.equal((await memory.history('trip')).find((source) => source.sourceId === 'B:user').supersedesSourceId, null);
  await memory.close();

  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  assert.equal(store.load_node('A:user'), null);
  assert.equal(store.load_node('A:assistant'), null);
  assert.equal(store.load_node('B:user').state.status, 'active');
  assert.equal(store.load_node('B:assistant').state.status, 'active');
  assert.ok(store.load_edges().every((edge) => !['A:user', 'A:assistant'].includes(edge.from)
    && !['A:user', 'A:assistant'].includes(edge.to)));
  store.close();
});

test('erasing a correction chain in reverse restores each surviving predecessor', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  for (const [turnId, recordedAt, hotel, supersedesSourceId] of [
    ['A', 1000, 'Sakura', undefined], ['B', 2000, 'Maple', 'A:user'], ['C', 3000, 'Pine', 'B:user'],
  ]) {
    await memory.remember({ sessionId: 'trip', turnId, recordedAt, supersedesSourceId,
      user: `东京酒店是 ${hotel} Hotel。`, assistant: '收到。' });
  }
  await memory.erase({ sessionId: 'trip', sourceId: 'C:user' });
  assert.equal((await memory.history('trip')).find((source) => source.sourceId === 'A:user').supersededBy, 'B:user');
  assert.equal((await memory.history('trip')).find((source) => source.sourceId === 'B:user').supersededBy, null);
  assert.ok((await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？' })).sources
    .some((source) => source.sourceId === 'B:user'));
  await memory.erase({ sessionId: 'trip', sourceId: 'B:user' });
  assert.equal((await memory.history('trip')).find((source) => source.sourceId === 'A:user').supersededBy, null);
  assert.ok((await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？' })).sources
    .some((source) => source.sourceId === 'A:user'));
  await memory.close();

  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  assert.equal(store.load_node('A:user').state.status, 'active');
  assert.equal(store.load_node('B:user'), null);
  assert.equal(store.load_node('B:assistant'), null);
  assert.equal(store.load_node('C:user'), null);
  assert.equal(store.load_node('C:assistant'), null);
  assert.ok(store.load_edges().every((edge) => !['B:user', 'B:assistant', 'C:user', 'C:assistant'].includes(edge.from)
    && !['B:user', 'B:assistant', 'C:user', 'C:assistant'].includes(edge.to)));
  store.close();
});

test('erasing a middle correction relinks its surviving successor', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  for (const [turnId, recordedAt, hotel, supersedesSourceId] of [
    ['A', 1000, 'Sakura', undefined], ['B', 2000, 'Maple', 'A:user'], ['C', 3000, 'Pine', 'B:user'],
  ]) {
    await memory.remember({ sessionId: 'trip', turnId, recordedAt, supersedesSourceId,
      user: `东京酒店是 ${hotel} Hotel。`, assistant: '收到。' });
  }
  await memory.erase({ sessionId: 'trip', sourceId: 'B:user' });
  const history = await memory.history('trip');
  assert.equal(history.find((source) => source.sourceId === 'C:user').supersedesSourceId, 'A:user');
  assert.equal(history.find((source) => source.sourceId === 'A:user').supersededBy, 'C:user');
  const current = await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？' });
  assert.ok(current.sources.some((source) => source.sourceId === 'C:user'));
  assert.ok(!current.sources.some((source) => source.sourceId === 'A:user'));
  assert.ok(!current.sources.some((source) => source.sourceId === 'B:user'));
  await memory.close();

  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  assert.equal(store.load_node('B:user'), null);
  assert.equal(store.load_node('B:assistant'), null);
  assert.ok(store.load_edges().some((edge) => edge.type === 'supersedes'
    && edge.from === 'C:user' && edge.to === 'A:user'));
  assert.ok(store.load_edges().some((edge) => edge.type === 'supersedes'
    && edge.from === 'C:assistant' && edge.to === 'A:assistant'));
  assert.ok(store.load_edges().every((edge) => !['B:user', 'B:assistant'].includes(edge.from)
    && !['B:user', 'B:assistant'].includes(edge.to)));
  store.close();
});

test('paired assistant echoes follow correction and turn-level erasure', async () => {
  const memory = createMemory(config(db()));
  await memory.remember({ sessionId: 'trip', turnId: 'A', recordedAt: 1000,
    user: '东京酒店是 Sakura Hotel。', assistant: '你选的是 Sakura Hotel。' });
  await memory.remember({ sessionId: 'trip', turnId: 'B', recordedAt: 2000,
    supersedesSourceId: 'A:user', user: '东京酒店改为 Maple Hotel。', assistant: '收到。' });
  const history = await memory.history('trip');
  assert.equal(history.find((source) => source.sourceId === 'A:user').supersededBy, 'B:user');
  assert.equal(history.find((source) => source.sourceId === 'A:assistant').supersededBy, 'B:assistant');
  const current = await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？' });
  assert.ok(!current.sources.some((source) => source.sourceId === 'A:assistant'));
  await memory.erase({ sessionId: 'trip', sourceId: 'B:user' });
  const restored = await memory.recall({ sessionId: 'trip', query: '东京酒店是哪家？' });
  assert.ok(restored.sources.some((source) => source.sourceId === 'A:assistant'));
  assert.ok(!(await memory.history('trip')).some((source) => source.turnId === 'B'));
  await memory.close();
});

test('evidence budget makes an exact marked excerpt', async () => {
  const memory = createMemory(config(db()));
  await memory.remember({ sessionId: 'trip', turnId: 'long',
    user: '东京酒店：' + 'Sakura Hotel 位于上野。'.repeat(80), assistant: '好的。' });
  const result = await memory.recall({ sessionId: 'trip', query: '东京酒店', maxEvidenceTokens: 50 });
  assert.ok(result.trace.tokensUsed <= 50);
  assert.ok(result.sources.some((source) => source.exactRange.end < source.exactRange.total));
  assert.ok(result.trace.omitted.some((item) => item.reason.includes('excerpted')));
  await memory.close();
});

test('English sources answer a Chinese paraphrase and preserve provenance IDs', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  await memory.remember({ sessionId: 'english', turnId: 'en-1',
    user: 'I booked Sakura Hotel in Ueno for my Tokyo trip.',
    assistant: 'The Tokyo stay is Sakura Hotel.' });
  const result = await memory.recall({ sessionId: 'english', query: '我在日本旅行住哪家酒店？' });
  assert.ok(result.sources.some((source) => source.sourceId === 'en-1:user'));
  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'english']) });
  const node = store.load_node('en-1:user');
  assert.equal(node.provenance.source_trace[0].source_id, 'en-1:user');
  store.close();
  await memory.close();
});

test('a changed embedding identity rebuilds derived vectors from exact sources', async () => {
  const dbPath = db();
  const first = createMemory(config(dbPath));
  await first.remember({ sessionId: 'trip', turnId: 'one',
    user: '东京上野住 Sakura Hotel。', assistant: '记住了。' });
  await first.close();
  let reembedded = 0;
  const second = createMemory({ dbPath, embedding: { kind: 'custom', id: 'test-semantic-v2', dimension: 4,
    embed: async (text) => { reembedded++; return vector(text); } }, minSemanticSimilarity: 0.8 });
  const result = await second.recall({ sessionId: 'trip', query: 'Japan lodging?' });
  assert.ok(reembedded >= 3); // two saved sources plus this query
  assert.ok(result.sources.some((source) => source.sourceId === 'one:user'));
  const history = await second.history('trip');
  assert.equal(history[0].exactText, '东京上野住 Sakura Hotel。');
  await second.close();
});

test('same-session concurrent saves preserve a unique ordered transcript', async () => {
  const dbPath = db();
  const memory = createMemory(config(dbPath));
  await Promise.all(Array.from({ length: 12 }, (_, index) => memory.remember({
    sessionId: 'one', turnId: `turn-${index}`, user: `东京酒店第 ${index} 条`, assistant: `确认第 ${index} 条`,
  })));
  const history = await memory.history('one');
  assert.equal(history.length, 24);
  assert.deepEqual(history.map((source) => source.sequence), Array.from({ length: 24 }, (_, index) => index + 1));
  await memory.close();
  const reopened = createMemory(config(dbPath));
  assert.equal((await reopened.history('one')).length, 24);
  await reopened.close();
});

test('a crash after derived save but before status update triggers safe rebuild', async () => {
  const dbPath = db();
  const first = createMemory(config(dbPath));
  await first.remember({ sessionId: 'trip', turnId: 'one', user: '东京 Sakura Hotel。', assistant: '收到。' });
  await first.close();
  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  store.database.prepare("UPDATE conversation_sources SET derivation_status = 'pending', embedding_fingerprint = NULL WHERE source_id = 'one:user'").run();
  store.close();
  let calls = 0;
  const second = createMemory(config(dbPath, async (text) => { calls++; return vector(text); }));
  const result = await second.recall({ sessionId: 'trip', query: 'Japan hotel?' });
  assert.ok(calls >= 3);
  assert.ok(result.sources.some((source) => source.sourceId === 'one:user'));
  await second.close();
});

test('a missing derived node is rebuilt from its authoritative source', async () => {
  const dbPath = db();
  const first = createMemory(config(dbPath));
  await first.remember({ sessionId: 'trip', turnId: 'missing', user: '东京住 Sakura Hotel。', assistant: '收到。' });
  await first.close();
  const { SqliteStore } = await import('../build-product/longmemory/stores/sqlite/sqlite_store.js');
  const store = new SqliteStore(dbPath, { tenant_id: 'local', user_id: JSON.stringify(['default', 'trip']) });
  store.database.prepare("DELETE FROM hydro_nodes WHERE node_id = 'missing:user'").run();
  store.close();
  const second = createMemory(config(dbPath));
  const recalled = await second.recall({ sessionId: 'trip', query: 'Japan hotel?' });
  assert.ok(recalled.sources.some((source) => source.sourceId === 'missing:user'));
  await second.close();
});

test('validAt only uses explicitly dated sources', async () => {
  const memory = createMemory(config(db()));
  await memory.remember({ sessionId: 'trip', turnId: 'dated', recordedAt: 3000, validFrom: 1000,
    user: '东京酒店从一月起改为 Sakura Hotel。', assistant: '收到。' });
  await memory.remember({ sessionId: 'trip', turnId: 'undated', recordedAt: 4000,
    user: '东京酒店还有 Maple Hotel 备选。', assistant: '收到。' });
  const asValid = await memory.recall({ sessionId: 'trip', query: '东京酒店', validAt: 2000 });
  assert.ok(asValid.sources.some((source) => source.sourceId === 'dated:user'));
  assert.ok(!asValid.sources.some((source) => source.sourceId === 'undated:user'));
  await memory.close();
});
