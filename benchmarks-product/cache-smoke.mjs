import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEmbeddingPool } from './embedding.mjs';

/** Fully local cache roundtrip; the fetch function never opens a connection. */
export async function verifyVectorCache(cacheDir) {
  const document = 'cache smoke document';
  const query = 'cache smoke query';
  const inputs = { document: [document], query: [query] };
  const vector = Array(2048).fill(0);
  vector[0] = 1;
  let intercepted = 0;
  const fetcher = async (_url, init) => {
    intercepted++;
    const body = JSON.parse(init.body);
    const data = body.input.map((_, index) => ({ index, embedding: vector }));
    const usage = body.input_type === 'passage' ? { prompt_tokens: 3 } : undefined;
    return new Response(JSON.stringify({ data, usage }), { status: 200,
      headers: { 'content-type': 'application/json' } });
  };
  const config = { apiKey: 'smoke-only-secret', model: 'nvidia/nemotron-3-embed-1b',
    baseUrl: 'https://integrate.api.nvidia.com/v1', dimension: 2048, cacheDir, fetcher };
  const first = await createEmbeddingPool(inputs, config);
  assert.equal(intercepted, 2);
  assert.equal(first.physical.length, 2);
  assert.equal(first.reused.length, 0);
  const second = await createEmbeddingPool(inputs, { ...config, apiKey: undefined,
    fetcher: async () => { throw new Error('Cache replay unexpectedly attempted a request'); } });
  assert.equal(second.physical.length, 0);
  assert.equal(second.reused.length, 2);
  assert.equal(second.reused.filter((batch) => batch.usage === 'unknown').length, 1);
  assert.equal((await second.providerFor('product').embed(document, { purpose: 'document' }))[0], 1);
  const files = readdirSync(cacheDir).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 2);
  for (const name of files) {
    const saved = readFileSync(join(cacheDir, name), 'utf8');
    assert.ok(!saved.includes(document) && !saved.includes(query)
      && !saved.includes('smoke-only-secret'));
  }
  return { passed: true, interceptedLocalResponses: intercepted,
    firstNewBatches: first.physical.length, replayedBatches: second.reused.length,
    unknownUsageReplayedBatches: 1, networkCalls: 0 };
}
