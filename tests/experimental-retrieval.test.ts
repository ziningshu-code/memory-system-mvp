import test from 'node:test';
import assert from 'node:assert/strict';
import {createRetrievalIndex, rawVectorFor, type CanonicalExchange, type CanonicalTopic} from '../src/index.js';

function row(sequence: number, userText: string, assistantText = 'Acknowledged.', time = 1_700_000_000_000): CanonicalExchange {
  return {id: `s${sequence}`, sequence, userText, assistantText, userSentAt: time + sequence * 60_000,
    assistantCompletedAt: time + sequence * 60_000 + 100, status: 'completed', failureReason: null, source: 'live'};
}

function topic(topicId: string, startSequence: number, endSequence: number, retrievalTerms: string[]): CanonicalTopic {
  return {topicId, status: 'finalized', labelTerms: [], retrievalTerms,
    spans: [{startSequence, endSequence}], startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, source: 'topic_worker_v2'};
}

test('B retrieves exact distant originals without Worker, topics, vectors or model calls', async () => {
  const rows = [row(1, 'Tokyo hotel Maple Ueno cost 14000 yen', 'Please save the exact amount 😀'),
    ...Array.from({length: 120}, (_, i) => row(i + 2, `Unrelated garden note ${i}.`))];
  const index = await createRetrievalIndex({exchanges: rows});
  const result = await index.retrieve({query: 'What was the Maple Ueno hotel cost?', mode: 'B', budget: 2400,
    expandLocalContext: false});
  const found = result.evidence.flatMap(s => s.records).find(r => r.sourceId === 's1');
  assert.deepEqual(found, {sequence: 1, sourceId: 's1', userSentAt: rows[0].userSentAt,
    assistantCompletedAt: rows[0].assistantCompletedAt, user: rows[0].userText, assistant: rows[0].assistantText});
  assert.equal(result.trace.queryEmbeddingCalls, 0);
  assert.equal(result.trace.vectorStatus, 'disabled');
  assert.ok(result.trace.evidenceUnits <= 2400);
  assert.equal(result.trace.evidenceUnits, Buffer.byteLength(result.evidenceText));
});

test('independent hits remain separate spans and selected adjacent hits merge', async () => {
  const rows = [row(1, 'Cedar travel departure receipt'), row(2, 'Cedar travel departure seat'),
    row(3, 'Unrelated lunch'), row(4, 'Maple travel return receipt')];
  const index = await createRetrievalIndex({exchanges: rows});
  const result = await index.retrieve({query: 'Cedar Maple travel receipt', mode: 'B', budget: 3000,
    expandLocalContext: false});
  assert.deepEqual(result.evidence.map(s => [s.startSequence, s.endSequence]), [[1, 2], [4, 4]]);
  assert.deepEqual(result.trace.selectedSourceIds, ['s1', 's2', 's4']);
});

test('one shared budget records relevant originals that could not be opened', async () => {
  const rows = Array.from({length: 7}, (_, i) => row(i + 1, `Marigold itinerary detail ${i} 😀`.repeat(8)));
  const index = await createRetrievalIndex({exchanges: rows});
  const result = await index.retrieve({query: 'Marigold itinerary detail', mode: 'B', budget: 900,
    expandLocalContext: false});
  assert.ok(result.evidence.length > 0);
  assert.ok(result.trace.evidenceUnits <= 900);
  assert.ok(result.trace.omittedCount > 0);
  assert.ok(result.trace.omittedRanked.every(hit => hit.reason === 'budget'));
});

test('C validates vector model, dimensions and source text, then falls back to lexical', async () => {
  const rows = [row(1, 'The lighthouse is beside the pier'), row(2, 'Aster budget 17000')];
  const valid = await rawVectorFor(rows[0], 'provider/model/2', [1, 0]);
  const stale = {...await rawVectorFor(rows[1], 'provider/model/2', [0, 1]), textSha256: 'stale'};
  const wrongDimensions = {...valid, dimensions: 3};
  const index = await createRetrievalIndex({exchanges: rows, vectors: [valid, stale, wrongDimensions]});
  const semantic = await index.retrieve({query: 'Where is the beacon?', mode: 'C', budget: 2000,
    queryVector: {embedderId: 'provider/model/2', vector: [1, 0]}, expandLocalContext: false});
  assert.equal(semantic.trace.vectorStatus, 'ready');
  assert.deepEqual(semantic.trace.selectedSourceIds, ['s1']);
  assert.equal(semantic.trace.rejectedRawVectors, 2);
  const fallback = await index.retrieve({query: 'Aster budget', mode: 'C', budget: 2000,
    queryVector: {embedderId: 'wrong-model', vector: [1, 0]}, expandLocalContext: false});
  assert.equal(fallback.trace.vectorStatus, 'unavailable');
  assert.ok(fallback.trace.selectedSourceIds.includes('s2'));
});

test('mixed dimensions under one embedding model cannot enter the same raw index', async () => {
  const rows = [row(1, 'Cedar project'), row(2, 'Maple project')];
  const first = await rawVectorFor(rows[0], 'provider/model', [1, 0]);
  const changed = await rawVectorFor(rows[1], 'provider/model', [0, 1, 0]);
  const index = await createRetrievalIndex({exchanges: rows, vectors: [first, changed]});
  const result = await index.retrieve({query: 'Maple', mode: 'C', budget: 1000,
    queryVector: {embedderId: 'provider/model', vector: [0, 1, 0]}});
  assert.equal(result.trace.validRawVectors, 1);
  assert.equal(result.trace.rejectedRawVectors, 1);
  assert.equal(result.trace.vectorStatus, 'unavailable');
  assert.deepEqual(result.trace.selectedSourceIds, ['s2']);
});

test('D uses a topic only as a pointer to canonical text, while B works without it', async () => {
  const rows = [row(1, 'Booking code ZX9837, amount 14900.'), row(2, 'I watered the plants.')];
  const cards = [topic('hotel-card', 1, 1, ['Ueno hotel itinerary'])];
  const index = await createRetrievalIndex({exchanges: rows, topics: cards});
  const b = await index.retrieve({query: 'Ueno hotel itinerary', mode: 'B', budget: 2000,
    expandLocalContext: false});
  const d = await index.retrieve({query: 'Ueno hotel itinerary', mode: 'D', budget: 2000,
    expandLocalContext: false});
  assert.deepEqual(b.trace.selectedSourceIds, []);
  assert.deepEqual(d.trace.selectedSourceIds, ['s1']);
  assert.equal(d.evidence[0].records[0].user, rows[0].userText);
  assert.equal(d.evidenceText.includes('Ueno hotel itinerary'), false);
});

test('a corrupt oversized topic span cannot make index construction walk an unbounded range', async () => {
  const rows = [row(1, 'Safe canonical orchid record')];
  const corrupt = topic('corrupt', 1, Number.MAX_SAFE_INTEGER, ['orchid']);
  const index = await createRetrievalIndex({exchanges: rows, topics: [corrupt]});
  const result = await index.retrieve({query: 'orchid', mode: 'D', budget: 2000});
  assert.deepEqual(result.trace.selectedSourceIds, ['s1']);
});

test('B returns no evidence for a query with no lexical match', async () => {
  const index = await createRetrievalIndex({exchanges: [row(1, 'Paper cranes are folded.')],
    topics: [topic('wrong-card', 1, 1, ['Neptune submarine'])]});
  const result = await index.retrieve({query: 'silver comet', mode: 'B', budget: 1000});
  assert.deepEqual(result.evidence, []);
  assert.equal(result.evidenceText, '[]');
});

test('a generic Chinese possessive cannot create a false lexical match', async () => {
  const index = await createRetrievalIndex({exchanges: [row(1, '我的狗 Milo 护照已寄出')]});
  const result = await index.retrieve({query: '我的血型是什么？', mode: 'B', budget: 1000});
  assert.deepEqual(result.trace.selectedSourceIds, []);
});

test('invalid candidate caps fail instead of silently returning no evidence', async () => {
  const index = await createRetrievalIndex({exchanges: [row(1, 'Cedar booking')]});
  await assert.rejects(index.retrieve({query: 'Cedar', mode: 'B', budget: 1000,
    maxCandidates: Number.NaN}), /Invalid retrieval mode or candidate limit/);
});

test('a reference query can include only temporally continuous context', async () => {
  const rows = [row(1, 'The budget is 13000.'), row(2, 'We changed that itinerary to 14000.'),
    row(3, 'We went to a museum.', 'Fine.', 1_700_100_000_000)];
  const index = await createRetrievalIndex({exchanges: rows});
  const result = await index.retrieve({query: 'What was that itinerary?', mode: 'B', budget: 3000});
  assert.ok(result.trace.selectedSourceIds.includes('s1'));
  assert.ok(result.trace.selectedSourceIds.includes('s2'));
  assert.equal(result.trace.selectedSourceIds.includes('s3'), false);
});
