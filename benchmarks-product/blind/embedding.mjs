import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './config.mjs';
import { allInputs } from './dataset.mjs';
import { here, sha } from './build.mjs';
import { planEmbeddings } from './freeze.mjs';
const key = (purpose, text) => JSON.stringify([purpose, text]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function atomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}
function appendDurably(path, value, flag = 'a') {
  const fd = openSync(path, flag, 0o600);
  try { writeSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
}
function readLedger(path, manifestSha256) {
  if (!existsSync(path)) appendDurably(path, { version: 1, manifestSha256 }, 'wx');
  const content = readFileSync(path, 'utf8');
  if (!content.endsWith('\n')) throw new Error('Partial request journal; refuse further provider attempts');
  const [header, ...attempts] = content.trimEnd().split('\n').map(line => JSON.parse(line));
  if (header.version !== 1 || header.manifestSha256 !== manifestSha256 || attempts.length > config.maxPhysicalRequests) {
    throw new Error('Request ledger does not match frozen manifest');
  }
  return { ...header, attempts };
}
function validate(record, batch) {
  if (record.version !== 1 || record.inputSha256 !== batch.inputSha256 || record.model !== config.model
    || record.dimension !== config.dimension || record.purpose !== batch.purpose || !Array.isArray(record.vectors)
    || record.vectors.length !== batch.inputs) throw new Error('Cached real vector batch identity mismatch');
  for (const vector of record.vectors) {
    if (!Array.isArray(vector) || vector.length !== config.dimension || vector.some(v => !Number.isFinite(v))
      || Math.abs(Math.hypot(...vector) - 1) > 0.000001) throw new Error('Invalid normalized real vector cache');
  }
  if (record.promptTokens !== null && (!Number.isSafeInteger(record.promptTokens) || record.promptTokens < 0)) {
    throw new Error('Invalid cached provider usage');
  }
  return record;
}
function pool(values, name, dimension, physical, reused) {
  const logical = { product: { document: 0, query: 0 }, upstream: { document: 0, query: 0 } };
  return { physical, reused, logical, uniqueInputs: values.size,
    providerFor: side => ({ name, dimension, async embed(text, context = {}) {
      const purpose = context.purpose === 'query' ? 'query' : 'document';
      if (!logical[side]) throw new Error('Unknown benchmark system');
      logical[side][purpose]++;
      const vector = values.get(key(purpose, text));
      if (!vector) throw new Error('Unplanned exact embedding input refused');
      return [...vector];
    } }),
  };
}
// Harness-only token hashes. No labels, source IDs, scenario mapping, or semantic substitutes.
export function createSmokePool() {
  const values = new Map();
  for (const [purpose, texts] of Object.entries(allInputs)) {
    for (const text of texts) {
      const vector = Array(config.smokeDimension).fill(0);
      for (const token of text.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []) {
        vector[createHash('sha256').update(token).digest()[0] % vector.length]++;
      }
      const norm = Math.hypot(...vector) || 1;
      if (!Math.hypot(...vector)) vector[0] = 1;
      values.set(key(purpose, text), vector.map(value => value / norm));
    }
  }
  return pool(values, 'SMOKE ONLY: token hashes, no quality claims', config.smokeDimension, [], []);
}
/** Exactly one attempt per frozen batch. Failed attempts consume the persistent cap too. */
export async function createRealPool(manifest, options = {}) {
  const { apiKey } = options;
  const fetcher = options.fetcher ?? fetch;
  const cacheDir = options.cacheDir ?? join(here, '.vector-cache');
  const ledgerPath = options.ledgerPath ?? join(here, '.request-ledger.json');
  const lock = `${ledgerPath}.lock`;
  const currentPlan = planEmbeddings();
  if (sha(JSON.stringify(currentPlan)) !== sha(JSON.stringify(manifest.embeddingPlan))) throw new Error('Manifest input plan differs');
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(lock, 'bounded benchmark request lock', { flag: 'wx', mode: 0o600 });
  try {
    const ledger = readLedger(ledgerPath, manifest.manifestSha256);
    const values = new Map(), physical = [], reused = [];
    let lastStart = 0;
    for (const purpose of ['document', 'query']) {
      const size = config[`${purpose}BatchSize`];
      for (let offset = 0; offset < allInputs[purpose].length; offset += size) {
        const texts = allInputs[purpose].slice(offset, offset + size);
        const inputSha256 = sha(JSON.stringify({ model: config.model, baseUrl: config.baseUrl,
          dimension: config.dimension, purpose, texts }));
        const batch = currentPlan.batches.find(item => item.inputSha256 === inputSha256);
        if (!batch) throw new Error('Unplanned provider batch refused');
        const path = join(cacheDir, `${inputSha256}.json`);
        let record;
        if (existsSync(path)) {
          record = validate(JSON.parse(readFileSync(path, 'utf8')), batch);
          reused.push({ purpose, inputs: texts.length, inputSha256,
            originalProviderLatencyMs: record.providerLatencyMs, promptTokens: record.promptTokens });
        } else {
          if (ledger.attempts.some(attempt => attempt.inputSha256 === inputSha256)) {
            throw new Error('Previously attempted uncached batch cannot be retried under this frozen authorization');
          }
          if (ledger.attempts.length >= config.maxPhysicalRequests) throw new Error('Physical request cap reached');
          if (!apiKey) throw new Error('NVIDIA_API_KEY is required for missing real vectors');
          if (lastStart && performance.now() - lastStart < config.requestStartSpacingMs) {
            await (options.wait ?? pause)(config.requestStartSpacingMs - (performance.now() - lastStart));
          }
          const attempt = { inputSha256, purpose, inputs: texts.length, status: 'attempted' };
          ledger.attempts.push(attempt);
          appendDurably(ledgerPath, attempt); // Immutable, fsynced consumption before starting the HTTP request.
          const started = performance.now(); lastStart = started;
          const response = await fetcher(`${config.baseUrl}/embeddings`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: config.model, input: texts,
              input_type: purpose === 'query' ? 'query' : 'passage', encoding_format: 'float', truncate: 'NONE' }),
            signal: AbortSignal.timeout(config.timeoutMs), redirect: 'error',
          });
          if (!response.ok) throw new Error(`NVIDIA embedding HTTP ${response.status}; attempt consumed; no retry`);
          const payload = await response.json();
          if (!Array.isArray(payload?.data) || payload.data.length !== texts.length) throw new Error('Provider row count mismatch');
          const vectors = Array(texts.length);
          for (const row of payload.data) {
            if (!Number.isSafeInteger(row.index) || row.index < 0 || row.index >= texts.length || vectors[row.index]
              || !Array.isArray(row.embedding) || row.embedding.length !== config.dimension
              || row.embedding.some(value => !Number.isFinite(value))) throw new Error('Invalid provider vector or index');
            const norm = Math.hypot(...row.embedding);
            if (!norm) throw new Error('Zero provider embedding');
            vectors[row.index] = row.embedding.map(value => value / norm);
          }
          const promptTokens = Number.isSafeInteger(payload.usage?.prompt_tokens) && payload.usage.prompt_tokens >= 0
            ? payload.usage.prompt_tokens : null;
          record = { version: 1, model: config.model, dimension: config.dimension, purpose, inputSha256, vectors,
            providerLatencyMs: Math.round(performance.now() - started), promptTokens };
          validate(record, batch); atomic(path, record);
          physical.push({ purpose, inputs: texts.length, inputSha256, providerLatencyMs: record.providerLatencyMs, promptTokens });
        }
        texts.forEach((text, index) => values.set(key(purpose, text), record.vectors[index]));
      }
    }
    return { ...pool(values, `nvidia:${config.model}`, config.dimension, physical, reused),
      cumulativeAttempts: ledger.attempts.length };
  } finally { unlinkSync(lock); }
}
