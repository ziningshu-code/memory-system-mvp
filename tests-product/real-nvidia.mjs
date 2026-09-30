import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory } from '../build-product/product/index.js';

if (!process.env.NVIDIA_API_KEY || !process.env.NVIDIA_EMBED_MODEL) {
  throw new Error('Run with a local env file containing NVIDIA_API_KEY and NVIDIA_EMBED_MODEL');
}
const memory = createMemory({
  dbPath: process.env.LIVE_DB_PATH ?? join(mkdtempSync(join(tmpdir(), 'memory-product-live-')), 'memory.sqlite'),
  embedding: {
    kind: 'nvidia', baseUrl: process.env.NVIDIA_BASE_URL,
    model: process.env.NVIDIA_EMBED_MODEL, apiKey: process.env.NVIDIA_API_KEY,
    dimension: 2048,
  },
});
try {
  const tokyo = await memory.remember({ sessionId: 'live', turnId: 'tokyo',
    user: '东京旅行预订了上野的 Sakura Hotel，每晚一万四千日元。',
    assistant: '收到，东京住宿是 Sakura Hotel。' });
  const paris = await memory.remember({ sessionId: 'live', turnId: 'paris',
    user: '巴黎旅行预订了塞纳河旁的 Lumiere Hotel。',
    assistant: '收到，巴黎住宿是 Lumiere Hotel。' });
  const crossLanguage = await memory.recall({ sessionId: 'live',
    query: 'Which hotel did I choose for my Tokyo trip?', limit: 2 });
  const unrelated = await memory.recall({ sessionId: 'live',
    query: 'How should I repair a bicycle chain?', limit: 2 });
  const result = {
    indexedSources: tokyo.indexed.length + paris.indexed.length,
    failedSources: tokyo.failed.length + paris.failed.length,
    crossLanguageSources: crossLanguage.sources.map((source) => source.sourceId),
    crossLanguageError: crossLanguage.trace.error ?? null,
    unrelatedSources: unrelated.sources.map((source) => source.sourceId),
    unrelatedError: unrelated.trace.error ?? null,
  };
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.failedSources, 0);
  assert.ok(result.crossLanguageSources.includes('tokyo:user'));
  assert.equal(result.unrelatedSources.length, 0);
} finally {
  await memory.close();
}
