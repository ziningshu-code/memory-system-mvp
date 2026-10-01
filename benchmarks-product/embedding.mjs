import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keyOf = (text, purpose) => JSON.stringify([purpose, text]);

/** One bounded NVIDIA model, with vectors prefetched once and shared by both systems. */
export async function createEmbeddingPool(inputs, config) {
  const { apiKey, model, baseUrl, dimension } = config;
  if (!apiKey || !model) throw new Error('NVIDIA_API_KEY and NVIDIA_EMBED_MODEL are required');
  if (baseUrl !== 'https://integrate.api.nvidia.com/v1') {
    throw new Error('Benchmark only permits the documented NVIDIA embedding endpoint');
  }
  if (dimension !== 2048 || model !== 'nvidia/nemotron-3-embed-1b') {
    throw new Error('This fixture is calibrated for nvidia/nemotron-3-embed-1b at 2048 dimensions');
  }
  const values = new Map();
  const calls = [];
  let lastStart = 0;
  for (const purpose of ['document', 'query']) {
    const unique = [...new Set(inputs[purpose])];
    for (let offset = 0; offset < unique.length; offset += 16) {
      if (calls.length >= 8) throw new Error('Eight physical embedding request cap reached');
      const texts = unique.slice(offset, offset + 16);
      const elapsed = performance.now() - lastStart;
      if (lastStart && elapsed < 2_100) await sleep(2_100 - elapsed);
      const started = performance.now();
      lastStart = started;
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts, input_type: purpose === 'query' ? 'query' : 'passage',
          encoding_format: 'float', truncate: 'NONE' }),
        signal: AbortSignal.timeout(60_000),
        redirect: 'error',
      });
      if (!response.ok) {
        // Keep secrets and provider response bodies out of benchmark output.
        throw new Error(`NVIDIA embedding HTTP ${response.status}; no automatic retry`);
      }
      const payload = await response.json();
      const rows = payload?.data;
      if (!Array.isArray(rows) || rows.length !== texts.length) throw new Error('Embedding response row count mismatch');
      for (const row of rows) {
        if (!Number.isSafeInteger(row.index) || row.index < 0 || row.index >= texts.length
          || !Array.isArray(row.embedding) || row.embedding.length !== dimension
          || row.embedding.some((value) => !Number.isFinite(value))) {
          throw new Error('Invalid NVIDIA embedding vector or index');
        }
        const key = keyOf(texts[row.index], purpose);
        if (values.has(key)) throw new Error('Duplicate NVIDIA embedding index');
        const norm = Math.hypot(...row.embedding);
        if (!norm) throw new Error('NVIDIA returned a zero vector');
        values.set(key, row.embedding.map((value) => value / norm));
      }
      calls.push({ purpose, inputs: texts.length, latencyMs: Math.round(performance.now() - started),
        promptTokens: Number.isSafeInteger(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null });
    }
  }
  const logical = { upstream: { document: 0, query: 0 }, product: { document: 0, query: 0 } };
  const providerFor = (side) => ({
    name: `nvidia:${model}`,
    dimension,
    async embed(text, context = {}) {
      const purpose = context.purpose === 'query' ? 'query' : 'document';
      logical[side][purpose]++;
      const vector = values.get(keyOf(text, purpose));
      if (!vector) throw new Error(`Unplanned ${purpose} embedding: ${text.slice(0, 60)}`);
      return vector;
    },
  });
  return { providerFor, logical, physical: calls, uniqueInputs: values.size };
}

/** Local harness check only. Its output is never a real-model benchmark result. */
export function createSmokePool(inputs) {
  const planned = new Set(Object.entries(inputs).flatMap(([purpose, texts]) =>
    texts.map((text) => keyOf(text, purpose))));
  const logical = { upstream: { document: 0, query: 0 }, product: { document: 0, query: 0 } };
  const dimension = 64;
  const vectorOf = (text) => {
    const vector = Array(dimension).fill(0);
    for (const token of text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      const hash = createHash('sha256').update(token).digest();
      vector[hash[0] % dimension] += 1;
    }
    const norm = Math.hypot(...vector);
    if (!norm) vector[0] = 1;
    return vector.map((value) => value / (norm || 1));
  };
  return { physical: [], uniqueInputs: planned.size, logical,
    providerFor: (side) => ({ name: 'smoke-hash-only', dimension,
      async embed(text, context = {}) {
        const purpose = context.purpose === 'query' ? 'query' : 'document';
        if (!planned.has(keyOf(text, purpose))) throw new Error(`Unplanned ${purpose} smoke embedding`);
        logical[side][purpose]++;
        return vectorOf(text);
      } }),
  };
}
