import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { config } from './config.mjs';
import { exchanges, queries } from './dataset.mjs';
import { here, buildRuntimes } from './build.mjs';
import { prepareFreeze, verifyFreeze, json } from './freeze.mjs';
import { createAdapters } from './adapters.mjs';
import { createSmokePool, createRealPool } from './embedding.mjs';
import { auditEvidence, auditSource } from './audit.mjs';

const args = process.argv.slice(2);
const mode = args[0];
if (!['--prepare', '--check', '--smoke', '--live'].includes(mode)
  || (mode === '--live' ? args.length !== 2 || args[1] !== '--max-calls=29' : args.length !== 1)) {
  throw new Error('Use --prepare | --check | --smoke | --live --max-calls=29');
}
if (mode === '--prepare') {
  const manifest = prepareFreeze();
  console.log(json({ mode: 'frozen before evaluation', manifest: 'benchmarks-product/blind/manifest.json',
    manifestSha256: manifest.manifestSha256, corpus: manifest.corpus, embeddingPlan: manifest.embeddingPlan, liveCallsMade: 0 }));
  process.exit(0);
}
const manifest = verifyFreeze();
if (mode === '--check') {
  const { runChecks } = await import('./checks.mjs');
  console.log(json(await runChecks(manifest)));
  process.exit(0);
}
// Build, import, open native SQLite, and test result writes before the first provider attempt.
const entries = buildRuntimes();
const resultsRoot = join(here, 'results'); mkdirSync(resultsRoot, { recursive: true });
const preflightDir = mkdtempSync(join(resultsRoot, 'preflight-'));
const forbid = { name: 'preflight no network', dimension: config.dimension,
  embed: async () => { throw new Error('Unexpected embedding during preflight'); } };
const preflight = await createAdapters(preflightDir, entries, { product: forbid, upstream: forbid });
try {
  await preflight.product.history('preflight-owner', 'empty');
  await preflight.upstream.explain('preflight-owner', 'empty', 'missing:user');
  writeFileSync(join(preflightDir, 'ok.json'), json({ ok: true }));
} finally { await Promise.all([preflight.product.close(), preflight.upstream.close()]); }
verifyFreeze();
const smoke = mode === '--smoke';
const pool = smoke ? createSmokePool() : await createRealPool(manifest, { apiKey: process.env.NVIDIA_API_KEY });
const runId = `${smoke ? 'smoke' : 'live'}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
const outDir = join(resultsRoot, runId), stateDir = join(outDir, 'state'); mkdirSync(stateDir, { recursive: true });
const report = {
  version: 1, runId, syntheticOnly: true, manifestSha256: manifest.manifestSha256,
  mode: smoke ? 'offline harness smoke ONLY; no embedding quality claims' : 'frozen independent real-embedding retrieval benchmark',
  startedAt: new Date().toISOString(), config,
  corpus: manifest.corpus, embeddings: { planned: manifest.embeddingPlan, physical: pool.physical, reused: pool.reused,
    newPhysicalRequests: pool.physical.length, cumulativeAttemptedRequests: pool.cumulativeAttempts ?? 0,
    logical: pool.logical, sharedExactInputs: true, cacheKeyIncludesPurpose: true },
  fairness: manifest.fairness,
  caveats: [
    'This independently authored holdout is synthetic; it is not evidence of performance on real naturally generated chats.',
    'There are 200 exchanges in total, but only 25 per owner/session scope; this is not evidence of 200-turn recall inside one session or Main LLM memory limits.',
    'No Main LLM is used. Gold labels grade source retrieval, temporal validity, isolation, and persistence, not generated answers.',
    'Provider requests are prefetched and shared; operation latency excludes provider latency, which is reported separately.',
    'The product supplies exact correction IDs; upstream receives only native conflict_behavior=supersede. Correction rows compare different API capabilities.',
    'Upstream historical recall returns an unranked lexical subject timeline. Historical hit/temporal checks are shown, while rank@5 metrics are N/A.',
    'Upstream source inspection relies on externally retained fixture IDs. Native history, source erase, transcript rebuild, and transcript-only failure recovery are N/A.',
    'Provider tokens are unknown unless the service supplies usage. No price or Main LLM token savings are inferred.',
    'The persistent request ledger prevents automatic retry of an attempted uncached batch, including failed requests.',
  ], ingestion: [], transcriptAudit: [], operations: [], queries: [],
};
const expectedSources = new Map(exchanges.flatMap(turn => ['user', 'assistant'].map((role, index) =>
  [`${turn.ownerId}/${turn.sessionId}/${turn.turnId}:${role}`, { ...turn, role, text: turn[role],
    sequence: exchanges.filter(t => t.ownerId === turn.ownerId && t.sessionId === turn.sessionId
      && t.recordedAt < turn.recordedAt).length * 2 + index + 1 }])));
const na = reason => ({ status: 'N/A', reason });
const status = (pass, details = {}) => ({ status: pass ? 'pass' : 'fail', ...details });
const calls = side => pool.logical[side].document + pool.logical[side].query;
function grade(test, result, embeddingCalls) {
  const evidence = auditEvidence(test, result.sources, expectedSources), { actual } = evidence;
  const relevantRetrieved = actual.filter(id => test.relevant.includes(id)).length;
  const noError = test.requireError ? Boolean(result.error) : !result.error;
  return status(evidence.evidenceCorrect && noError, {
    ...evidence, expected: test.expected,
    top1Expected: test.expected.length && result.rankingAvailable ? test.expected.includes(actual[0]) : null,
    recallAt5: test.expected.length && result.rankingAvailable ? test.expected.filter(id => actual.slice(0, 5).includes(id)).length / test.expected.length : null,
    returnedRelevantPrecision: test.expected.length && result.rankingAvailable ? relevantRetrieved / (actual.length || 1) : null,
    noMemoryCorrect: test.expected.length === 0 && !test.requireError ? actual.length === 0 : null,
    latencyMs: Math.round(result.latencyMs * 100) / 100, embeddingCalls, error: result.error,
    ...(result.nativeTimelineUnranked ? { nativeTimelineUnranked: true } : {}),
    ...(result.trace ? { trace: result.trace } : {}),
  });
}
async function evaluate(test, adapter, side) {
  const before = calls(side), result = await adapter.recall(test);
  return grade(test, result, calls(side) - before);
}
const adapters = await createAdapters(stateDir, entries,
  { product: pool.providerFor('product'), upstream: pool.providerFor('upstream') });
try {
  for (const turn of exchanges) {
    const row = { ownerId: turn.ownerId, sessionId: turn.sessionId, turnId: turn.turnId };
    for (const side of ['upstream', 'product']) {
      const before = calls(side), started = performance.now();
      try {
        const result = await adapters[side].ingest(turn);
        row[side] = { status: result.failed?.length ? 'fail' : 'pass', failed: result.failed ?? [],
          embeddingCalls: calls(side) - before, latencyMs: Math.round((performance.now() - started) * 100) / 100 };
      } catch { row[side] = { status: 'fail', error: 'ingestion failure', embeddingCalls: calls(side) - before }; }
    }
    report.ingestion.push(row);
  }
  await Promise.all([adapters.product.restart(), adapters.upstream.restart()]);
  const scopes = [...new Set(exchanges.map(turn => `${turn.ownerId}/${turn.sessionId}`))];
  for (const scoped of scopes) {
    const [ownerId, sessionId] = scoped.split('/'), history = await adapters.product.history(ownerId, sessionId);
    const expected = [...expectedSources.entries()].filter(([key]) => key.startsWith(`${scoped}/`));
    const pRows = expected.map(([key, gold]) => {
      const source = history.find(item => item.sourceId === `${gold.turnId}:${gold.role}`);
      return { key, pass: Boolean(source && source.exactText === gold.text && source.role === gold.role
        && source.turnId === gold.turnId && source.sequence === gold.sequence
        && source.recordedAt === gold.recordedAt && source.sessionId === gold.sessionId
        && source.storedOwnership?.tenant_id === 'blind-synthetic'
        && source.storedOwnership?.user_id === JSON.stringify([ownerId, sessionId])
        && source.storedOwnership?.session_id === sessionId && source.storedOwnership?.source_id === `${gold.turnId}:${gold.role}`) };
    });
    const uRows = [];
    for (const [key, gold] of expected) {
      const source = await adapters.upstream.explain(ownerId, sessionId, `${gold.turnId}:${gold.role}`);
      const audit = source ? auditSource(source, expectedSources, gold)
        : { key, exactText: false, derivedText: false, nativeProvenanceCorrect: false, storedScopeCorrect: false };
      uRows.push({ ...audit, sequence: source?.sequence === gold.sequence });
    }
    report.transcriptAudit.push({ scope: scoped,
      product: status(history.length === expected.length && pRows.every(row => row.pass), { sources: history.length, rows: pRows }),
      upstreamExactSourceInspection: status(uRows.every(row => row.exactText && row.derivedText && row.role && row.turnId
        && row.recordedAt && row.sequence && row.storedScopeCorrect && row.nativeProvenanceCorrect),
        { usesExternallyRetainedFixtureIds: true, rows: uRows }),
      upstreamNativeHistory: na('No native authoritative transcript enumeration API') });
  }
  for (const test of queries.filter(q => q.phase === 'base')) {
    report.queries.push({ ...test, upstream: await evaluate(test, adapters.upstream, 'upstream'),
      product: await evaluate(test, adapters.product, 'product') });
  }
  for (const test of queries.filter(q => q.phase === 'erase')) {
    const erased = await adapters.product.erase(test.ownerId, test.sessionId, test.eraseSourceId);
    report.operations.push({ type: 'erase', queryId: test.id, product: status(erased.erased), upstream: na('No native source erase API') });
    report.queries.push({ ...test, upstream: na('No native source erase and correction reversion API'),
      product: await evaluate(test, adapters.product, 'product') });
  }
  await Promise.all([adapters.product.restart(), adapters.upstream.restart()]);
  for (const test of queries.filter(q => q.phase === 'restart')) {
    report.queries.push({ ...test, upstream: await evaluate(test, adapters.upstream, 'upstream'),
      product: await evaluate(test, adapters.product, 'product') });
  }
  for (const test of queries.filter(q => q.phase === 'rebuild')) {
    const before = await adapters.product.history(test.ownerId, test.sessionId), started = performance.now();
    const rebuilt = await adapters.product.rebuild(test.ownerId, test.sessionId);
    const after = await adapters.product.history(test.ownerId, test.sessionId);
    const sameTranscript = JSON.stringify(before.map(s => [s.sourceId, s.exactText, s.sequence, s.recordedAt]))
      === JSON.stringify(after.map(s => [s.sourceId, s.exactText, s.sequence, s.recordedAt]));
    const erasedAbsent = (test.forbidden ?? []).every(id => !after.some(source => source.sourceId === id));
    report.operations.push({ type: 'rebuild', queryId: test.id,
      product: status(rebuilt.failed === 0 && sameTranscript && erasedAbsent, { ...rebuilt, sameTranscript, erasedAbsent,
        latencyMs: Math.round((performance.now() - started) * 100) / 100 }),
      upstream: na('No native rebuild from authoritative completed transcript API') });
    report.queries.push({ ...test, upstream: na('No native transcript rebuild API'), product: await evaluate(test, adapters.product, 'product') });
  }
} finally { await Promise.all([adapters.product.close(), adapters.upstream.close()]); }

// Failure injection affects a fresh database, reuses the exact preplanned vectors after recovery,
// and never sends a second provider request. No external replay is supplied to upstream.
const failureDir = join(stateDir, 'failure'); mkdirSync(failureDir);
let outage = true;
const injected = side => {
  const base = pool.providerFor(side);
  return { ...base, embed: async (text, context) => { if (outage) throw new Error('Injected embedding outage'); return base.embed(text, context); } };
};
const failure = await createAdapters(failureDir, entries, { product: injected('product'), upstream: injected('upstream') });
try {
  const test = queries.find(q => q.phase === 'failure');
  const turn = exchanges.find(t => t.ownerId === test.ownerId && t.sessionId === test.sessionId && t.turnId === test.failureTurnId);
  let upstreamFailed = false;
  try { await failure.upstream.ingest(turn); } catch { upstreamFailed = true; }
  const saved = await failure.product.ingest(turn), history = await failure.product.history(turn.ownerId, turn.sessionId);
  report.operations.push({ type: 'embedding outage', product: status(saved.failed.length === 2 && history.length === 2
    && history[0].exactText === turn.user && history[1].exactText === turn.assistant, { preservedExactMessages: history.length }),
    upstreamNativeTranscript: na('No native transcript persistence independent of embedding/indexing'),
    upstreamIngest: status(upstreamFailed, { propagatedInjectedOutage: upstreamFailed }) });
  report.queries.push({ ...test, upstream: await evaluate(test, failure.upstream, 'upstream'),
    product: await evaluate(test, failure.product, 'product') });
  outage = false;
  await Promise.all([failure.product.restart(), failure.upstream.restart()]);
  const recovered = await failure.product.rebuild(turn.ownerId, turn.sessionId);
  report.operations.push({ type: 'failure recovery', product: status(recovered.failed === 0 && recovered.indexed === 2, recovered),
    upstream: na('No native authoritative transcript recovery; external fixture replay deliberately not supplied') });
  const recoveryQuery = queries.find(q => q.phase === 'recovery');
  report.queries.push({ ...recoveryQuery,
    upstream: na('No native recovery from completed transcript after failed ingestion'),
    product: await evaluate(recoveryQuery, failure.product, 'product') });
} finally { await Promise.all([failure.product.close(), failure.upstream.close()]); }

const mean = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10000) / 10000 : null;
const percentile = (values, p) => values.length ? values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
const summarize = rows => Object.fromEntries(['upstream', 'product'].map(side => {
  const results = rows.map(row => row[side]), measured = results.filter(row => row.status !== 'N/A');
  const latency = measured.map(row => row.latencyMs).filter(Number.isFinite);
  return [side, { cases: results.length, pass: measured.filter(row => row.status === 'pass').length,
    fail: measured.filter(row => row.status === 'fail').length, notApplicable: results.length - measured.length,
    recallAt5: mean(measured.map(row => row.recallAt5).filter(Number.isFinite)),
    returnedRelevantPrecision: mean(measured.map(row => row.returnedRelevantPrecision).filter(Number.isFinite)),
    noMemoryCorrectRate: mean(measured.map(row => row.noMemoryCorrect).filter(value => typeof value === 'boolean').map(Number)),
    latencyMsP50: percentile([...latency], 0.5), latencyMsP95: percentile([...latency], 0.95) }];
}));
report.finishedAt = new Date().toISOString();
report.embeddings.physicalPromptTokens = pool.physical.every(row => row.promptTokens !== null)
  ? pool.physical.reduce((n, row) => n + row.promptTokens, 0) : null;
report.embeddings.reusedOriginalPromptTokens = pool.reused.every(row => row.promptTokens !== null)
  ? pool.reused.reduce((n, row) => n + row.promptTokens, 0) : null;
report.summary = smoke ? { retrievalQuality: 'N/A: smoke hashes verify harness mechanics only',
  checkedQueries: report.queries.length,
  transcriptIntegrityPassed: report.transcriptAudit.every(row => row.product.status === 'pass'),
  productControlOperationsPassed: report.operations.every(row => !row.product || row.product.status === 'pass') }
  : { overall: summarize(report.queries), categories: Object.fromEntries([...new Set(queries.map(q => q.category))]
    .map(category => [category, summarize(report.queries.filter(row => row.category === category))])) };
report.sourceIntegritySummary = Object.fromEntries(['upstream', 'product'].map(side => {
  const audits = report.queries.flatMap(row => row[side].sourceAudit ?? []);
  return [side, { returnedSources: audits.length, exactTextAndDerivedTextCorrect: audits.filter(row => row.exactText && row.derivedText).length,
    storedScopeCorrect: audits.filter(row => row.storedScopeCorrect).length,
    nativeProvenanceCorrect: audits.filter(row => row.nativeProvenanceCorrect).length,
    traceUsesPerSourceId: audits.filter(row => row.traceUsesPerSourceId).length,
    traceUsesPerSourceIdMeaning: 'Capability difference; upstream native scoped-owner trace is valid when ref, time, and metadata match',
    ...(smoke ? { qualityInterpretation: 'N/A: smoke retrieval selection is not evaluated as real-model quality' } : {}) }];
}));
writeFileSync(join(outDir, 'report.json'), json(report));
console.log(json({ report: `benchmarks-product/blind/results/${runId}/report.json`, summary: report.summary,
  newPhysicalRequests: pool.physical.length, reusedBatches: pool.reused.length, manifestSha256: manifest.manifestSha256 }));
if (smoke && (!report.summary.transcriptIntegrityPassed || !report.summary.productControlOperationsPassed || report.queries.length !== 50)) process.exitCode = 1;
