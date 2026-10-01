import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { buildUpstream } from './build-upstream.mjs';
import { createEmbeddingPool, createSmokePool } from './embedding.mjs';
import { productAdapter, upstreamAdapter } from './adapters.mjs';
import { verifyVectorCache } from './cache-smoke.mjs';
import {
  BASE_TIME, baselineTurns, recallCases, correctionTurns, correctionQueries,
  failureTurn, failureQuery, allEmbeddingInputs,
} from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
if (![...args].every((arg) => ['--prepare', '--smoke', '--live'].includes(arg)) || args.size !== 1) {
  throw new Error('Use exactly one mode: node benchmarks-product/run.mjs --prepare | --smoke | --live');
}
const upstreamBuild = buildUpstream();
const productDir = resolve(here, '..');
const productCommit = execFileSync('git', [
  '-c', `safe.directory=${productDir.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD',
], { cwd: productDir, encoding: 'utf8', windowsHide: true }).trim();
// Resolve local source and imports before any provider request.
const { create_memory } = await import(pathToFileURL(upstreamBuild.entry).href);
// Exercise both SQLite/native entry points and result-directory writes before
// provider work. An empty session never requests an embedding.
const resultsRoot = join(here, 'results');
mkdirSync(resultsRoot, { recursive: true });
const preflightDir = mkdtempSync(join(resultsRoot, 'preflight-'));
const noEmbedding = { name: 'preflight-only', dimension: 8,
  embed: async () => { throw new Error('Unexpected embedding in local preflight'); } };
const preflightProduct = productAdapter(preflightDir, noEmbedding);
const preflightUpstream = upstreamAdapter(preflightDir, create_memory, noEmbedding);
try {
  await preflightProduct.history('empty');
  await preflightUpstream.explain('empty', 'missing');
  writeFileSync(join(preflightDir, 'ok.json'), JSON.stringify({ productCommit, upstreamCommit: upstreamBuild.head }));
} finally {
  await Promise.allSettled([preflightProduct.close(), preflightUpstream.close()]);
}
const fixtureSources = new Map([...baselineTurns, ...correctionTurns, failureTurn]
  .flatMap((turn) => ['user', 'assistant'].map((role) => [`${turn.turnId}:${role}`, {
    sessionId: turn.sessionId, turnId: turn.turnId, role, text: turn[role], recordedAt: turn.recordedAt,
  }])));
const allInputs = {
  document: allEmbeddingInputs.document,
  query: [...allEmbeddingInputs.query,
    'Do I currently live in Beijing?', 'Do I currently live in Shenzhen?',
    'Do I currently live in Shanghai?'],
};

if (args.has('--prepare')) {
  console.log(JSON.stringify({ mode: 'prepared', upstreamCommit: upstreamBuild.head,
    corpus: { turns: baselineTurns.length, correctionTurns: correctionTurns.length,
      failureTurns: 1, queries: new Set(allInputs.query).size,
      uniqueDocumentInputs: new Set(allInputs.document).size },
    liveCallsMade: 0 }, null, 2));
  process.exit(0);
}

const smoke = args.has('--smoke');
const model = smoke ? 'smoke-hash-only (not a real embedding model)' : process.env.NVIDIA_EMBED_MODEL;
const pool = smoke ? createSmokePool(allInputs) : await createEmbeddingPool(allInputs, {
  apiKey: process.env.NVIDIA_API_KEY,
  model, baseUrl: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1', dimension: 2048,
});
const runId = `${smoke ? 'smoke' : 'live'}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
const outDir = join(here, 'results', runId);
mkdirSync(outDir, { recursive: true });
const cacheSelfTest = smoke ? await verifyVectorCache(join(outDir, 'cache-self-test')) : null;

const report = {
  manifest: {
    mode: smoke ? 'offline harness smoke; no real-model quality claims' : 'live real-embedding comparison',
    upstreamCommit: upstreamBuild.head,
    productCommit,
    embeddingProvider: smoke ? 'deterministic local hash for harness validation' : 'NVIDIA NIM',
    embeddingModel: model, dimension: smoke ? 64 : 2048,
    inputFairness: 'Both systems ingest the same exact user and assistant strings, IDs, roles, sessions, and timestamps. Explicit source correction and transcript recovery are product features; upstream receives its native conflict_behavior=supersede for correction.',
    warmVectorCaveat: smoke
      ? 'This smoke run uses local vectors only. Its retrieval quality and latency are not comparable to the requested real-model benchmark.'
      : 'The same real NVIDIA vectors are prefetched once and served from a shared in-memory cache. Operation latency excludes provider network time; provider latency is reported separately.',
    noGenerativeCalls: true,
    ...(cacheSelfTest ? { cacheSelfTest } : {}),
  },
  embeddings: { physical: pool.physical, reused: pool.reused, batches: pool.batches,
    newPhysicalCalls: pool.physical.length, reusedBatches: pool.reused.length,
    uniqueInputs: pool.uniqueInputs, logical: pool.logical },
  categories: {},
  caveats: [
    `The fixture has ${baselineTurns.length} baseline turns across two sessions, not production scale.`,
    'Upstream has no native history, erase, or rebuild-from-authoritative-transcript API. Unsupported operations are N/A, not measured failures.',
    'Upstream exact-source inspection uses externally retained fixture IDs with explain(); this does not establish native transcript enumeration.',
    'A correct node ID and exact raw text are reported separately from provenance source_trace.source_id.',
    'Correction cases compare upstream native heuristic conflict handling with the product explicit source-ID correction API; they do not supply equal correction hints.',
    'The paired-turn correction check only covers assistant messages in the explicitly corrected turn; unrelated later repetitions are outside this fixture.',
  ],
};

function add(category, id, upstream, product, notes = {}) {
  const group = report.categories[category] ??= [];
  group.push({ id, upstream, product, ...notes });
}
function status(pass, details = {}, latencyMs = null, embeddingCalls = null) {
  return { status: pass ? 'pass' : 'fail', ...details,
    ...(latencyMs === null ? {} : { latencyMs: Math.round(latencyMs * 10) / 10 }),
    ...(embeddingCalls === null ? {} : { embeddingCalls }) };
}
function unsupported(reason) { return { status: 'N/A', reason }; }
function calls(side) { return pool.logical[side].document + pool.logical[side].query; }
function sourceChecks(result) {
  const returned = result.sources.map((source) => {
    const expected = fixtureSources.get(source.id);
    return { id: source.id, exactIdText: Boolean(expected && expected.text === source.text),
      derivedTextMatchesId: Boolean(expected && source.derivedText === expected.text),
      provenanceMatchesId: source.sourceTraceId === source.id,
      provenanceSourceId: source.sourceTraceId, role: source.role };
  });
  return { ids: returned.map((item) => item.id), exactIdText: returned.filter((item) => item.exactIdText).length,
    derivedTextMatchesId: returned.filter((item) => item.derivedTextMatchesId).length,
    provenanceMatchesId: returned.filter((item) => item.provenanceMatchesId).length,
    returnedCount: returned.length,
    bad: returned.filter((item) => !item.exactIdText || !item.derivedTextMatchesId || !item.provenanceMatchesId) };
}
function recallStatus(testCase, result, embeddingCalls) {
  const checks = sourceChecks(result);
  const found = testCase.expected === null ? checks.ids.length === 0 : checks.ids.includes(testCase.expected);
  const isolated = !testCase.forbidden?.some((id) => checks.ids.includes(id));
  const pass = found && isolated && !result.error;
  return status(pass, { expected: testCase.expected, ...checks,
    top1Expected: testCase.expected !== null && checks.ids[0] === testCase.expected,
    error: result.error }, result.latencyMs, embeddingCalls);
}
function exactStatus(actual, expected, sequence) {
  const fields = {
    text: actual?.text === expected.text,
    role: actual?.role === expected.role,
    turnId: actual?.turnId === expected.turnId,
    sequence: actual?.sequence === sequence,
    sessionId: actual?.sessionId === expected.sessionId,
    recordedAt: actual?.recordedAt === expected.recordedAt,
  };
  return status(Object.values(fields).every(Boolean), { fields, id: `${expected.turnId}:${expected.role}` });
}
function sequenceFor(turn, role) {
  return baselineTurns.filter((value) => value.sessionId === turn.sessionId
    && value.recordedAt < turn.recordedAt).length * 2 + (role === 'user' ? 1 : 2);
}

const baselineDir = join(outDir, 'baseline');
mkdirSync(baselineDir);
const product = productAdapter(baselineDir, pool.providerFor('product'), smoke ? 0 : 0.45);
const upstream = upstreamAdapter(baselineDir, create_memory, pool.providerFor('upstream'));
try {
  const ingestion = { upstream: [], product: [] };
  for (const turn of baselineTurns) {
    for (const [side, adapter] of [['upstream', upstream], ['product', product]]) {
      const started = performance.now();
      const before = calls(side);
      const result = await adapter.ingest(turn);
      ingestion[side].push({ turnId: turn.turnId, ms: Math.round(performance.now() - started),
        embeddingCalls: calls(side) - before,
        failed: side === 'product' ? result.failed : [] });
    }
  }
  report.ingestion = ingestion;
  await upstream.restart();
  await product.restart();

  for (const turn of baselineTurns) {
    const productHistory = await product.history(turn.sessionId);
    for (const role of ['user', 'assistant']) {
      const expected = fixtureSources.get(`${turn.turnId}:${role}`);
      const sequence = sequenceFor(turn, role);
      const productSource = productHistory.find((item) => item.sourceId === `${turn.turnId}:${role}`);
      const explanation = await upstream.explain(turn.sessionId, `${turn.turnId}:${role}`);
      const node = explanation.node;
      const upstreamSource = node ? { text: node.content.original_text ?? node.content.raw,
        role: node.metadata.speaker, turnId: node.metadata.turn_id,
        sequence: node.metadata.sequence, sessionId: node.metadata.conversation_id,
        recordedAt: node.temporal.recorded_at } : null;
      add('exact transcript after restart', `${turn.turnId}:${role}`,
        exactStatus(upstreamSource, expected, sequence),
        exactStatus(productSource && { text: productSource.exactText, role: productSource.role,
          turnId: productSource.turnId, sequence: productSource.sequence,
          sessionId: productSource.sessionId, recordedAt: productSource.recordedAt }, expected, sequence));
    }
  }

  for (const item of recallCases) {
    const uBefore = calls('upstream');
    const u = await upstream.recall(item.sessionId, item.query);
    const pBefore = calls('product');
    const p = await product.recall(item.sessionId, item.query);
    add(item.category, item.id,
      recallStatus(item, u, calls('upstream') - uBefore),
      recallStatus(item, p, calls('product') - pBefore));
    if (item.expected !== null) {
      const uSource = sourceChecks(u);
      const pSource = sourceChecks(p);
      add('source-grounded recall', `${item.id}:attribution`,
        status(uSource.returnedCount > 0 && uSource.provenanceMatchesId === uSource.returnedCount
          && uSource.exactIdText === uSource.returnedCount
          && uSource.derivedTextMatchesId === uSource.returnedCount, uSource, u.latencyMs),
        status(pSource.returnedCount > 0 && pSource.provenanceMatchesId === pSource.returnedCount
          && pSource.exactIdText === pSource.returnedCount
          && pSource.derivedTextMatchesId === pSource.returnedCount, pSource, p.latencyMs));
    }
  }

  const historyBefore = await product.history('primary');
  const pBefore = calls('product');
  const started = performance.now();
  const rebuilt = await product.rebuild('primary');
  const rebuildMs = performance.now() - started;
  const historyAfter = await product.history('primary');
  const recallAfter = await product.recall('primary', 'What is the exact Tokyo booking code?');
  const rebuildPass = rebuilt.failed === 0 && historyAfter.length === historyBefore.length
    && historyAfter.every((source, index) => source.sourceId === historyBefore[index].sourceId
      && source.exactText === historyBefore[index].exactText
      && source.sessionId === historyBefore[index].sessionId)
    && recallAfter.sources.some((source) => source.id === 'tokyo:user');
  add('rebuild from authoritative transcript', 'derived state recreated',
    unsupported('No native upstream transcript-to-derived rebuild API'),
    status(rebuildPass, { indexed: rebuilt.indexed, failed: rebuilt.failed,
      sourcesBefore: historyBefore.length, sourcesAfter: historyAfter.length,
      recallIds: recallAfter.sources.map((source) => source.id) }, rebuildMs, calls('product') - pBefore));
} finally {
  await Promise.allSettled([product.close(), upstream.close()]);
}

const correctionDir = join(outDir, 'correction');
mkdirSync(correctionDir);
const correctionProduct = productAdapter(correctionDir, pool.providerFor('product'), smoke ? 0 : 0.45);
const correctionUpstream = upstreamAdapter(correctionDir, create_memory, pool.providerFor('upstream'));
try {
  for (let index = 0; index < correctionTurns.length; index++) {
    const turn = correctionTurns[index];
    await correctionUpstream.ingest(turn, { nativeCorrection: index > 0 });
    await correctionProduct.ingest(turn);
    const expected = `${turn.turnId}:user`;
    const obsoleteUserIds = correctionTurns.slice(0, index).map((prior) => `${prior.turnId}:user`);
    const u = await correctionUpstream.recall('correction', correctionQueries.current);
    const p = await correctionProduct.recall('correction', correctionQueries.current);
    add('historical correction', `current after ${turn.turnId}`,
      status(u.sources.some((source) => source.id === expected)
        && obsoleteUserIds.every((id) => !u.sources.some((source) => source.id === id)),
      { expected, forbidden: obsoleteUserIds, ...sourceChecks(u) }, u.latencyMs),
      status(p.sources.some((source) => source.id === expected)
        && obsoleteUserIds.every((id) => !p.sources.some((source) => source.id === id)),
      { expected, forbidden: obsoleteUserIds, ...sourceChecks(p) }, p.latencyMs));
    if (index === 1) {
      const priorTime = BASE_TIME + 30_000;
      const historicalUpstream = await correctionUpstream.historical('correction', priorTime);
      const historicalProduct = await correctionProduct.recall('correction', correctionQueries.old, { asOf: priorTime });
      const upstreamIds = historicalUpstream.timeline.agent_belief_at_time.map((node) => node.id);
      add('historical correction', 'asOf before Shanghai',
        status(upstreamIds.includes('beijing:user'), { ids: upstreamIds }),
        status(historicalProduct.sources.some((source) => source.id === 'beijing:user'),
          sourceChecks(historicalProduct), historicalProduct.latencyMs));
      const echoQuery = 'Do I currently live in Beijing?';
      const echoUpstream = await correctionUpstream.recall('correction', echoQuery);
      const echoProduct = await correctionProduct.recall('correction', echoQuery);
      add('paired assistant echo', 'old assistant after user correction',
        status(!echoUpstream.sources.some((source) => source.id === 'beijing:assistant'),
          sourceChecks(echoUpstream), echoUpstream.latencyMs),
        status(!echoProduct.sources.some((source) => source.id === 'beijing:assistant'),
          sourceChecks(echoProduct), echoProduct.latencyMs));
    }
  }
  for (const [erased, expected, echoQuery, echoId] of [
    ['shenzhen:user', 'shanghai:user', 'Do I currently live in Shenzhen?', 'shenzhen:assistant'],
    ['shanghai:user', 'beijing:user', 'Do I currently live in Shanghai?', 'shanghai:assistant'],
  ]) {
    await correctionProduct.erase('correction', erased);
    const current = await correctionProduct.recall('correction', correctionQueries.current);
    add('historical correction', `erase ${erased}`,
      unsupported('Upstream has no source erase API'),
      status(current.sources.some((source) => source.id === expected)
        && !current.sources.some((source) => source.id === erased),
      { expected, erased, ...sourceChecks(current) }, current.latencyMs));
    const echo = await correctionProduct.recall('correction', echoQuery);
    add('paired assistant echo', `assistant after erase ${erased}`,
      unsupported('Upstream has no source erase API'),
      status(!echo.sources.some((source) => source.id === echoId),
        { echoId, ...sourceChecks(echo) }, echo.latencyMs));
  }
  await correctionProduct.erase('correction', 'beijing:user');
  const afterOldErase = await correctionProduct.recall('correction', correctionQueries.current);
  add('historical correction', 'erase oldest source in chain',
    unsupported('Upstream has no source erase API'),
    status(!afterOldErase.sources.some((source) => source.id === 'beijing:user'),
      sourceChecks(afterOldErase), afterOldErase.latencyMs));
  await correctionProduct.rebuild('correction');
  const postRebuild = await correctionProduct.history('correction');
  add('erase survives rebuild', 'all erased turn sources remain absent',
    unsupported('Upstream has no source erase or transcript rebuild API'),
    status(postRebuild.length === 0,
      { survivingIds: postRebuild.map((source) => source.sourceId) }));
} finally {
  await Promise.allSettled([correctionProduct.close(), correctionUpstream.close()]);
}

const failureDir = join(outDir, 'failure');
mkdirSync(failureDir);
let failEmbedding = true;
const failProvider = (side) => {
  const real = pool.providerFor(side);
  return { ...real, embed: async (text, context) => {
    if (failEmbedding && context.purpose !== 'query') throw new Error('Injected document embedding failure');
    return real.embed(text, context);
  } };
};
const failureProduct = productAdapter(failureDir, failProvider('product'), smoke ? 0 : 0.45);
const failureUpstream = upstreamAdapter(failureDir, create_memory, failProvider('upstream'));
try {
  let upstreamError = null;
  try { await failureUpstream.ingest(failureTurn); }
  catch (error) { upstreamError = error.message; }
  const productResult = await failureProduct.ingest(failureTurn);
  const productHistory = await failureProduct.history('failure');
  const upstreamNode = (await failureUpstream.explain('failure', 'failed:user')).node;
  add('embedding failure before indexing', 'exact source survives document embedding outage',
    status(Boolean(upstreamNode && upstreamNode.content.raw === failureTurn.user),
      { error: upstreamError, savedNode: Boolean(upstreamNode) }),
    status(productResult.failed.length === 2 && productHistory.length === 2
      && productHistory[0].exactText === failureTurn.user
      && productHistory[1].exactText === failureTurn.assistant,
    { failedSourceIds: productResult.failed, savedSourceIds: productHistory.map((item) => item.sourceId) }));
  failEmbedding = false;
  await Promise.all([failureUpstream.restart(), failureProduct.restart()]);
  const afterRestart = await failureProduct.history('failure');
  const rebuilt = await failureProduct.rebuild('failure');
  const repaired = await failureProduct.recall('failure', failureQuery);
  const upstreamAfter = (await failureUpstream.explain('failure', 'failed:user')).node;
  add('failure recovery and rebuild', 'recover retrieval from local saved data',
    status(Boolean(upstreamAfter), { savedNodeAfterRestart: Boolean(upstreamAfter),
      recoveryRequiresExternalReplay: true }),
    status(afterRestart.length === 2 && rebuilt.failed === 0
      && repaired.sources.some((source) => source.id === 'failed:user'),
    { rebuilt, recalledIds: repaired.sources.map((source) => source.id) }, repaired.latencyMs));
} finally {
  await Promise.allSettled([failureProduct.close(), failureUpstream.close()]);
}

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = values.toSorted((left, right) => left - right);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1] * 10) / 10;
};
const usageBearingCalls = pool.physical.filter((call) => call.promptTokens !== null);
report.embeddings.physicalInputTokensObserved = pool.physical.length === 0
  ? 0
  : usageBearingCalls.length === pool.physical.length
    ? usageBearingCalls.reduce((total, call) => total + call.promptTokens, 0)
    : null;
report.embeddings.physicalInputTokensUsageCalls = usageBearingCalls.length;
const reusedWithUsage = pool.reused.filter((batch) => batch.promptTokens !== null);
report.embeddings.reusedOriginalInputTokensObserved = pool.reused.length === 0
  ? 0
  : reusedWithUsage.length === pool.reused.length
    ? reusedWithUsage.reduce((total, batch) => total + batch.promptTokens, 0)
    : null;
report.embeddings.reusedOriginalInputTokensUsageBatches = reusedWithUsage.length;
report.embeddings.missingUsageBatches = pool.batches.filter((batch) => batch.usage === 'unknown').length;
report.embeddings.monetaryCost = 'not calculated; provider billing and current pricing were not independently verified';
report.summary = Object.fromEntries(Object.entries(report.categories).map(([name, rows]) => [name, {
  cases: rows.length,
  upstream: { pass: rows.filter((row) => row.upstream.status === 'pass').length,
    fail: rows.filter((row) => row.upstream.status === 'fail').length,
    notApplicable: rows.filter((row) => row.upstream.status === 'N/A').length,
    latencyMsP50: percentile(rows.map((row) => row.upstream.latencyMs).filter(Number.isFinite), 0.5),
    latencyMsP95: percentile(rows.map((row) => row.upstream.latencyMs).filter(Number.isFinite), 0.95) },
  product: { pass: rows.filter((row) => row.product.status === 'pass').length,
    fail: rows.filter((row) => row.product.status === 'fail').length,
    notApplicable: rows.filter((row) => row.product.status === 'N/A').length,
    latencyMsP50: percentile(rows.map((row) => row.product.latencyMs).filter(Number.isFinite), 0.5),
    latencyMsP95: percentile(rows.map((row) => row.product.latencyMs).filter(Number.isFinite), 0.95) },
}]));
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: join(outDir, 'report.json'), summary: report.summary,
  embeddingPhysicalCalls: pool.physical.length, embeddingReusedBatches: pool.reused.length,
  embeddingPhysicalInputTokensObserved: report.embeddings.physicalInputTokensObserved,
  embeddingLogicalCalls: pool.logical }, null, 2));
