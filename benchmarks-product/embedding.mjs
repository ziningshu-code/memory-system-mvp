import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keyOf = (text, purpose) => JSON.stringify([purpose, text]);
const cacheRoot = join(dirname(fileURLToPath(import.meta.url)), '.vector-cache');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validateCachedBatch(record, expected) {
  if (record?.version !== 1 || record.digest !== expected.digest || record.model !== expected.model
    || record.dimension !== expected.dimension || record.purpose !== expected.purpose
    || record.inputs !== expected.inputs || !Array.isArray(record.vectors)
    || record.vectors.length !== expected.inputs) {
    throw new Error(`Cached embedding batch ${expected.digest.slice(0, 12)} does not match the planned input`);
  }
  for (const vector of record.vectors) {
    if (!Array.isArray(vector) || vector.length !== expected.dimension
      || vector.some((value) => !Number.isFinite(value))) {
      throw new Error(`Cached embedding batch ${expected.digest.slice(0, 12)} contains an invalid vector`);
    }
  }
  if (record.promptTokens !== null && (!Number.isSafeInteger(record.promptTokens) || record.promptTokens < 0)) {
    throw new Error(`Cached embedding batch ${expected.digest.slice(0, 12)} has invalid usage`);
  }
  return record;
}

function saveBatch(path, record) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  try { renameSync(temporary, path); }
  catch (error) {
    unlinkSync(temporary);
    throw error;
  }
}

/** One bounded NVIDIA model, with vectors prefetched once and shared by both systems. */
export async function createEmbeddingPool(inputs, config) {
  const { apiKey, model, baseUrl, dimension } = config;
  const fetcher = config.fetcher ?? fetch;
  const cacheDir = config.cacheDir ?? cacheRoot;
  if (!model) throw new Error('NVIDIA_EMBED_MODEL is required');
  if (baseUrl !== 'https://integrate.api.nvidia.com/v1') {
    throw new Error('Benchmark only permits the documented NVIDIA embedding endpoint');
  }
  if (dimension !== 2048 || model !== 'nvidia/nemotron-3-embed-1b') {
    throw new Error('This fixture is calibrated for nvidia/nemotron-3-embed-1b at 2048 dimensions');
  }
  const planned = ['document', 'query'].flatMap((purpose) => {
    const unique = [...new Set(inputs[purpose])];
    const batches = [];
    for (let offset = 0; offset < unique.length; offset += 16) {
      const texts = unique.slice(offset, offset + 16);
      const digest = hash({ version: 1, model, baseUrl, dimension, purpose, texts });
      batches.push({ purpose, texts, digest, path: join(cacheDir, `${digest}.json`) });
    }
    return batches;
  });
  if (planned.length > 8) throw new Error(`Eight physical embedding batch cap exceeded by fixture (${planned.length})`);
  mkdirSync(cacheDir, { recursive: true });
  const values = new Map();
  const physical = [];
  const reused = [];
  const batches = [];
  let lastStart = 0;
  for (const item of planned) {
    const { purpose, texts, digest, path } = item;
    const expected = { digest, model, dimension, purpose, inputs: texts.length };
    let record;
    if (existsSync(path)) {
      const started = performance.now();
      record = validateCachedBatch(JSON.parse(readFileSync(path, 'utf8')), expected);
      const entry = { purpose, inputs: texts.length, digest, cacheReadMs: Math.round(performance.now() - started),
        originalProviderLatencyMs: record.providerLatencyMs, promptTokens: record.promptTokens,
        usage: record.promptTokens === null ? 'unknown' : 'reported' };
      reused.push(entry);
      batches.push({ ...entry, source: 'cache' });
    } else {
      if (!apiKey) throw new Error('NVIDIA_API_KEY is required for an uncached embedding batch');
      const elapsed = performance.now() - lastStart;
      if (lastStart && elapsed < 2_100) await sleep(2_100 - elapsed);
      const started = performance.now();
      lastStart = started;
      const response = await fetcher(`${baseUrl}/embeddings`, {
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
      const vectors = new Array(texts.length);
      for (const row of rows) {
        if (!Number.isSafeInteger(row.index) || row.index < 0 || row.index >= texts.length
          || !Array.isArray(row.embedding) || row.embedding.length !== dimension
          || row.embedding.some((value) => !Number.isFinite(value)) || vectors[row.index]) {
          throw new Error('Invalid NVIDIA embedding vector or index');
        }
        const norm = Math.hypot(...row.embedding);
        if (!norm) throw new Error('NVIDIA returned a zero vector');
        vectors[row.index] = row.embedding.map((value) => value / norm);
      }
      const providerLatencyMs = Math.round(performance.now() - started);
      const promptTokens = Number.isSafeInteger(payload?.usage?.prompt_tokens) && payload.usage.prompt_tokens >= 0
        ? payload.usage.prompt_tokens : null;
      record = { version: 1, ...expected, vectors, providerLatencyMs, promptTokens };
      // Persist each successful batch before moving to the next provider call.
      // The file contains only normalized vectors and a digest of the inputs.
      saveBatch(path, record);
      const entry = { purpose, inputs: texts.length, digest, providerLatencyMs,
        promptTokens, usage: promptTokens === null ? 'unknown' : 'reported' };
      physical.push(entry);
      batches.push({ ...entry, source: 'network' });
    }
    for (let index = 0; index < texts.length; index++) values.set(keyOf(texts[index], purpose), record.vectors[index]);
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
  return { providerFor, logical, physical, reused, batches, uniqueInputs: values.size };
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
  return { physical: [], reused: [], batches: [], uniqueInputs: planned.size, logical,
    providerFor: (side) => ({ name: 'smoke-hash-only', dimension,
      async embed(text, context = {}) {
        const purpose = context.purpose === 'query' ? 'query' : 'document';
        if (!planned.has(keyOf(text, purpose))) throw new Error(`Unplanned ${purpose} smoke embedding`);
        logical[side][purpose]++;
        return vectorOf(text);
      } }),
  };
}
