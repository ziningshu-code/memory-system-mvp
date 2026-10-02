import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';
import { allInputs, exchanges, queries } from './dataset.mjs';
import { here } from './build.mjs';
import { validateDataset, verifyFreeze, json } from './freeze.mjs';
import { createRealPool, createSmokePool } from './embedding.mjs';
import { auditEvidence } from './audit.mjs';

export async function runChecks(manifest) {
  const corpus = validateDataset();
  assert.equal(manifest.manifestSha256, verifyFreeze().manifestSha256);
  assert.equal(corpus.exchanges, 200); assert.equal(corpus.queries, 50);
  assert.equal(manifest.embeddingPlan.plannedRequests, 28);
  assert.equal(manifest.embeddingPlan.uniqueDocumentInputs, 399);
  assert.equal(manifest.embeddingPlan.uniqueQueryInputs, 44);
  assert.equal(new Set(exchanges.map(turn => turn.ownerId)).size, 4);
  assert(queries.some(q => q.asOf)); assert(queries.some(q => q.phase === 'erase'));
  assert(queries.some(q => q.phase === 'rebuild')); assert(queries.some(q => q.phase === 'failure'));
  const sameTextGold = { ownerId: 'owner-amber', sessionId: 'studio', turnId: 'same', role: 'user', text: 'Identical synthetic note.', recordedAt: 100 };
  const sameIdGold = new Map([
    ['owner-amber/studio/same:user', sameTextGold],
    ['owner-cobalt/studio/same:user', { ...sameTextGold, ownerId: 'owner-cobalt' }],
    ['owner-amber/studio/later:user', { ...sameTextGold, turnId: 'later', recordedAt: 200, supersedesSourceId: 'same:user' }],
    ['owner-amber/studio/later:assistant', { ...sameTextGold, turnId: 'later', role: 'assistant', recordedAt: 200,
      supersedesSourceId: 'same:user' }],
  ]);
  const scopeTest = { ownerId: 'owner-amber', sessionId: 'studio', expected: ['owner-amber/studio/same:user'],
    relevant: ['owner-amber/studio/same:user'], forbiddenScopes: ['owner-cobalt/studio'] };
  const exactSource = { system: 'upstream', key: 'owner-amber/studio/same:user', id: 'same:user',
    text: sameTextGold.text, derivedText: sameTextGold.text, role: 'user', turnId: 'same', recordedAt: 100,
    nodeUserId: JSON.stringify(['owner-amber', 'studio']), nodeConversationId: 'studio', nodeSourceId: 'same:user',
    nodeStorageOwnership: { tenant_id: 'blind-synthetic', user_id: JSON.stringify(['owner-amber', 'studio']), node_id: 'same:user' },
    metadataSourceId: 'same:user', sourceTraceId: JSON.stringify(['owner-amber', 'studio']),
    sourceTraceRef: 'conversation:studio:same:user', sourceTraceAt: 100 };
  const correctAudit = auditEvidence(scopeTest, [exactSource], sameIdGold);
  assert(correctAudit.evidenceCorrect); assert(correctAudit.nativeProvenanceIntegrity);
  assert.equal(correctAudit.sourceAudit[0].traceUsesPerSourceId, false); // Valid upstream contract, not corruption.
  const normalized = { ...exactSource, nodeUserId: exactSource.nodeUserId.replaceAll('"', '\\"'),
    sourceTraceId: exactSource.nodeUserId.replaceAll('"', '\\"') };
  assert(auditEvidence(scopeTest, [normalized], sameIdGold).evidenceCorrect);
  const wrongScope = { ...exactSource, nodeUserId: JSON.stringify(['owner-cobalt', 'studio']),
    nodeStorageOwnership: { tenant_id: 'blind-synthetic', user_id: JSON.stringify(['owner-cobalt', 'studio']), node_id: 'same:user' },
    sourceTraceId: JSON.stringify(['owner-cobalt', 'studio']) };
  const wrongAudit = auditEvidence(scopeTest, [wrongScope], sameIdGold);
  assert.equal(wrongAudit.evidenceCorrect, false); assert.equal(wrongAudit.storedScopeIntegrity, false);
  assert.deepEqual(wrongAudit.forbiddenScopeSources, ['owner-cobalt/studio/same:user']);
  assert(wrongAudit.nativeProvenanceIntegrity); // Its provenance is valid; its owner is forbidden.
  const wrongProduct = { ...wrongScope, system: 'product', sourceTraceId: 'same:user',
    transcriptOwnership: { tenant_id: 'blind-synthetic', user_id: JSON.stringify(['owner-cobalt', 'studio']),
      session_id: 'studio', source_id: 'same:user', derived_node_id: 'same:user' } };
  assert.equal(auditEvidence(scopeTest, [wrongProduct], sameIdGold).evidenceCorrect, false);
  const futureAssistant = { ...exactSource, id: 'later:assistant', role: 'assistant', turnId: 'later',
    recordedAt: 200, nodeSourceId: 'later:assistant', metadataSourceId: 'later:assistant',
    nodeStorageOwnership: { tenant_id: 'blind-synthetic', user_id: JSON.stringify(['owner-amber', 'studio']), node_id: 'later:assistant' },
    sourceTraceRef: 'conversation:studio:later:assistant', sourceTraceAt: 200 };
  const historical = auditEvidence({ ...scopeTest, asOf: 150, forbidden: ['later:user'] }, [exactSource, futureAssistant], sameIdGold);
  assert.equal(historical.evidenceCorrect, false); assert.equal(historical.temporalViolations.length, 1);
  assert.deepEqual(historical.staleSources, ['owner-amber/studio/later:assistant']);
  const obsolete = auditEvidence({ ...scopeTest, asOf: 250 }, [exactSource], sameIdGold);
  assert.equal(obsolete.evidenceCorrect, false); assert.equal(obsolete.temporalViolations[0].reason, 'superseded at asOf');
  const smoke = createSmokePool();
  assert.equal(smoke.physical.length, 0);
  await assert.rejects(smoke.providerFor('product').embed('unplanned text', { purpose: 'query' }), /Unplanned/);
  const local = join(here, 'results'); mkdirSync(local, { recursive: true });
  const out = mkdtempSync(join(local, 'check-')), state = join(out, 'state'); mkdirSync(state);
  const cacheDir = join(state, 'mock-vector-cache'), ledgerPath = join(state, 'mock-ledger.json');
  let mockedRequests = 0;
  // These deliberately nonsemantic vectors test only transport, budget guards, and cache shape.
  // They never enter a retrieval evaluation and are not saved as real-model results.
  const fetcher = async (url, options) => {
    mockedRequests++;
    assert.equal(url, 'https://integrate.api.nvidia.com/v1/embeddings'); assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.model); assert.equal(body.encoding_format, 'float'); assert.equal(body.truncate, 'NONE');
    assert(['query', 'passage'].includes(body.input_type)); assert(body.input.length <= 16);
    return { ok: true, json: async () => ({ usage: { prompt_tokens: body.input.length },
      data: body.input.map((_, index) => ({ index, embedding: Array.from({ length: config.dimension }, (_, i) => i === 0 ? 1 : 0) })) }) };
  };
  const mockOptions = { apiKey: 'mock-not-a-key', cacheDir, ledgerPath, fetcher, wait: async () => {} };
  const first = await createRealPool(manifest, mockOptions);
  assert.equal(mockedRequests, 28); assert.equal(first.physical.length, 28);
  assert.equal(first.uniqueInputs, 443);
  const p = await first.providerFor('product').embed(allInputs.document[0], { purpose: 'document' });
  const u = await first.providerFor('upstream').embed(allInputs.document[0], { purpose: 'document' });
  assert.deepEqual(p, u);
  p[0] = 999; assert.equal((await first.providerFor('product').embed(allInputs.document[0], { purpose: 'document' }))[0], 1);
  await assert.rejects(first.providerFor('upstream').embed('unplanned exact input'), /Unplanned/);
  const cached = await createRealPool(manifest, { ...mockOptions, apiKey: undefined });
  assert.equal(mockedRequests, 28); assert.equal(cached.physical.length, 0); assert.equal(cached.reused.length, 28);
  const failureState = join(state, 'failure'); mkdirSync(failureState);
  let failures = 0;
  const failureOptions = { ...mockOptions, cacheDir: join(failureState, 'cache'), ledgerPath: join(failureState, 'ledger.json'),
    fetcher: async () => { failures++; return { ok: false, status: 429 }; } };
  await assert.rejects(createRealPool(manifest, failureOptions), /HTTP 429/);
  assert.equal(failures, 1);
  await assert.rejects(createRealPool(manifest, failureOptions), /cannot be retried/);
  assert.equal(failures, 1);
  const consumed = readFileSync(failureOptions.ledgerPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(consumed.length, 2); assert.equal(consumed[1].status, 'attempted');
  const cappedState = join(state, 'capped'); mkdirSync(cappedState);
  const cappedLedger = join(cappedState, 'ledger.json');
  writeFileSync(cappedLedger, [{ version: 1, manifestSha256: manifest.manifestSha256 },
    ...Array.from({ length: 29 }, (_, index) => ({ inputSha256: `already-consumed-${index}` }))]
    .map(row => JSON.stringify(row)).join('\n') + '\n');
  let capCalls = 0;
  await assert.rejects(createRealPool(manifest, { ...mockOptions, cacheDir: join(cappedState, 'cache'), ledgerPath: cappedLedger,
    fetcher: async () => { capCalls++; throw new Error('must never call'); } }), /cap reached/);
  assert.equal(capCalls, 0);
  const partialLedger = join(cappedState, 'partial.json');
  writeFileSync(partialLedger, JSON.stringify({ version: 1, manifestSha256: manifest.manifestSha256 }) + '\n{"inputSha');
  await assert.rejects(createRealPool(manifest, { ...mockOptions, cacheDir: join(cappedState, 'partial-cache'), ledgerPath: partialLedger,
    fetcher: async () => { capCalls++; throw new Error('must never call'); } }), /Partial request journal/);
  assert.equal(capCalls, 0);
  const wrong = { ...manifest, embeddingPlan: { ...manifest.embeddingPlan, plannedRequests: 27 } };
  await assert.rejects(createRealPool(wrong, mockOptions), /plan differs/);
  const result = { mode: 'offline harness checks only', liveProviderCalls: 0, mockedTransportCalls: 29,
    passed: ['200 completed exchanges / 50 labels / 4 owners / 8 scoped sessions', 'fixed hashes verified',
      '399 document + 44 query exact inputs produce 28 planned batches under cap 29',
      'same vectors shared between both adapters', 'unplanned embeddings refused',
      'valid cache reused with zero new calls', 'failed attempt consumed and not retried',
      'exhausted persistent cap refuses before transport', 'partial request journal refuses further calls', 'changed embedding plan refused'],
    evidenceAuditChecks: ['same ID/text/time from forbidden owner fails using stored ownership, despite forged caller-qualified key',
      'product transcript ownership checked independently', 'valid upstream scoped-owner provenance accepted without per-source trace',
      'future assistant fails asOf and paired-role forbidden checks', 'superseded source fails temporal visibility'],
    retrievalQuality: 'N/A; mock transport vectors are not evaluated for semantic quality', manifestSha256: manifest.manifestSha256 };
  writeFileSync(join(out, 'report.json'), json(result));
  return result;
}
