import {TextBudget, type TokenCounter} from './budget.js';
import {segmentText, validVector, type MemoryEmbedding} from './families.js';
import {LexicalIndex, terms, timeFilter} from './retrieval.js';
import type {CanonicalExchange, CanonicalTopic} from './types.js';

/** Experimental paths. None of these paths changes the native plugin's default recall. */
export type RetrievalArm = 'B' | 'C' | 'D';

export interface RawVector {
  schemaVersion: 1;
  sourceId: string;
  embedderId: string;
  dimensions: number;
  textSha256: string;
  vector: number[];
}

export interface RetrievalIndexInput {
  exchanges: CanonicalExchange[];
  topics?: CanonicalTopic[];
  vectors?: RawVector[];
  embedding?: MemoryEmbedding;
  tokenCounter?: TokenCounter;
}

export interface RetrievalRequest {
  query: string;
  mode: RetrievalArm;
  budget: number;
  now?: number;
  /** A precomputed query vector permits identical C/D queries without duplicate API calls. */
  queryVector?: {embedderId: string; vector: number[]};
  /** A contiguous neighbour is included only for an explicit reference or continuation cue. */
  expandLocalContext?: boolean;
  maxCandidates?: number;
}

export interface OriginalRecord {
  sequence: number;
  sourceId: string;
  userSentAt: number;
  assistantCompletedAt: number | null;
  user: string;
  assistant: string;
}

export interface EvidenceSpan {
  startSequence: number;
  endSequence: number;
  records: OriginalRecord[];
}

export interface RetrievalCandidate {
  sourceId: string;
  sequence: number;
  score: number;
  signals: Array<'raw-lexical' | 'raw-vector' | 'topic-card' | 'local-continuity'>;
}

export interface RetrievalResult {
  evidence: EvidenceSpan[];
  /** This exact JSON string is the evidence payload counted against budget. */
  evidenceText: string;
  trace: {
    mode: RetrievalArm;
    budgetUnit: 'tokens' | 'utf8-bytes';
    budgetLimit: number;
    evidenceUnits: number;
    selectedSourceIds: string[];
    rankedCandidates: RetrievalCandidate[];
    omittedRanked: Array<RetrievalCandidate & {reason: 'budget' | 'candidate-limit'}>;
    omittedCount: number;
    vectorStatus: 'disabled' | 'ready' | 'missing-query' | 'unavailable';
    validRawVectors: number;
    rejectedRawVectors: number;
    queryEmbeddingCalls: number;
    temporalFilter: string | null;
    retrievalMs: number;
  };
}

export interface RetrievalIndex {
  readonly indexingMs: number;
  readonly sourceCount: number;
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}

export function rawEmbeddingText(row: CanonicalExchange): string {
  return JSON.stringify({user: row.userText, assistant: row.assistantText});
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Use the same canonical text when persisting a raw vector sidecar. */
export async function rawVectorFor(row: CanonicalExchange, embedderId: string, vector: number[]): Promise<RawVector> {
  if (!embedderId.trim() || !validVector(vector)) throw new Error('Invalid raw embedding');
  return {schemaVersion: 1, sourceId: row.id, embedderId, dimensions: vector.length,
    textSha256: await sha256(rawEmbeddingText(row)), vector: [...vector]};
}

function original(row: CanonicalExchange): OriginalRecord {
  return {sequence: row.sequence, sourceId: row.id, userSentAt: row.userSentAt,
    assistantCompletedAt: row.assistantCompletedAt, user: row.userText, assistant: row.assistantText};
}

function evidenceOf(rows: CanonicalExchange[]): EvidenceSpan[] {
  const ordered = [...rows].sort((a, b) => a.sequence - b.sequence);
  const spans: EvidenceSpan[] = [];
  for (const row of ordered) {
    const last = spans.at(-1);
    if (last && last.endSequence + 1 === row.sequence) {
      last.endSequence = row.sequence;
      last.records.push(original(row));
    } else spans.push({startSequence: row.sequence, endSequence: row.sequence, records: [original(row)]});
  }
  return spans;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, lengthA = 0, lengthB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; lengthA += a[i] * a[i]; lengthB += b[i] * b[i];
  }
  return dot / Math.sqrt(lengthA * lengthB);
}

function referenceCue(text: string): boolean {
  return /\b(it|that|those|they|them|he|she|his|her|its|this|same|above|before|after|then)\b|它|那个|这个|他们|她|他|前面|后面|接着|刚才/u.test(text);
}

const genericPossessives = new Set(['我的', '你的', '他的', '她的', '它的', '我们的', '你们的', '他们的']);
function lexicalQuery(query: string): string {
  return terms(query).filter(term => !genericPossessives.has(term)).join(' ');
}

function continuous(a: CanonicalExchange, b: CanonicalExchange): boolean {
  const gap = b.userSentAt - (a.assistantCompletedAt ?? a.userSentAt);
  return b.sequence === a.sequence + 1 && gap >= 0 && gap <= 30 * 60_000;
}

class TranscriptRetrievalIndex implements RetrievalIndex {
  readonly indexingMs: number;
  readonly sourceCount: number;
  private readonly rows: CanonicalExchange[];
  private readonly byId: Map<string, CanonicalExchange>;
  private readonly bySequence: Map<number, CanonicalExchange>;
  private readonly lexical: LexicalIndex;
  private readonly topics: CanonicalTopic[];
  private readonly cardLexical: LexicalIndex;
  private readonly topicSources: Map<string, CanonicalExchange[]>;
  private readonly rawVectors: Map<string, RawVector>;
  private readonly rejectedRawVectors: number;
  private readonly embedding?: MemoryEmbedding;
  private readonly budget: TextBudget;

  constructor(input: RetrievalIndexInput, validVectors: RawVector[], rejectedVectors: number, indexingStart: number) {
    this.rows = input.exchanges.filter(r => r.status === 'completed').sort((a, b) => a.sequence - b.sequence);
    this.sourceCount = this.rows.length;
    this.byId = new Map(this.rows.map(r => [r.id, r]));
    this.bySequence = new Map(this.rows.map(r => [r.sequence, r]));
    if (this.byId.size !== this.rows.length || this.bySequence.size !== this.rows.length)
      throw new Error('Canonical transcript has duplicate source IDs or sequences');
    this.lexical = new LexicalIndex(this.rows.map(r => ({id: r.id, text: r.userText + ' ' + r.assistantText})));
    this.topics = input.topics ?? [];
    this.cardLexical = new LexicalIndex(this.topics.map(t => ({id: t.topicId, text: segmentText(t)})));
    this.topicSources = new Map(this.topics.map(t => {
      // Traverse the bounded canonical rows, not untrusted numeric span ranges.
      return [t.topicId, this.rows.filter(row => t.spans.some(span =>
        row.sequence >= span.startSequence && row.sequence <= span.endSequence))] as const;
    }));
    this.rawVectors = new Map(validVectors.map(v => [v.sourceId, v]));
    this.rejectedRawVectors = rejectedVectors;
    this.embedding = input.embedding;
    this.budget = new TextBudget(input.tokenCounter);
    this.indexingMs = performance.now() - indexingStart;
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const started = performance.now();
    if (!request.query.trim() || !Number.isSafeInteger(request.budget) || request.budget < 2)
      throw new Error('A non-empty query and evidence budget of at least 2 are required');
    if (!['B', 'C', 'D'].includes(request.mode) ||
      (request.maxCandidates !== undefined &&
        (!Number.isSafeInteger(request.maxCandidates) || request.maxCandidates < 1)))
      throw new Error('Invalid retrieval mode or candidate limit');
    const temporal = timeFilter(request.query, request.now ?? Date.now());
    const sparseQuery = lexicalQuery(request.query);
    const eligible = this.rows.filter(row => temporal?.start === undefined ||
      (row.userSentAt >= temporal.start && row.userSentAt < (temporal.end ?? Infinity)));
    const eligibleIds = new Set(eligible.map(r => r.id));
    const rawHits = this.lexical.search(sparseQuery, this.rows.length).filter(h => eligibleIds.has(h.id));
    const lexicalRank = new Map(rawHits.map((h, i) => [h.id, i + 1]));
    const lexicalScore = new Map(rawHits.map(h => [h.id, h.score]));

    let vectorStatus: RetrievalResult['trace']['vectorStatus'] = request.mode === 'B' ? 'disabled' : 'missing-query';
    let queryEmbeddingCalls = 0;
    let vector: number[] | undefined;
    let embedderId: string | undefined;
    if (request.mode !== 'B' && this.rawVectors.size) {
      if (request.queryVector) {
        ({vector, embedderId} = request.queryVector);
      } else if (this.embedding) {
        try {
          queryEmbeddingCalls++;
          const output = await this.embedding.embed([request.query], 'query');
          vector = output[0]; embedderId = this.embedding.id;
          if (output.length !== 1) throw new Error('Embedding provider returned the wrong number of query vectors');
        } catch { vectorStatus = 'unavailable'; }
      }
      if (vector && validVector(vector) && embedderId &&
        [...this.rawVectors.values()].some(v => v.embedderId === embedderId && v.vector.length === vector!.length))
        vectorStatus = 'ready';
      else if (vectorStatus !== 'unavailable') vectorStatus = 'unavailable';
    } else if (request.mode !== 'B' && !this.rawVectors.size) vectorStatus = 'unavailable';

    const denseRank = new Map<string, number>();
    if (vectorStatus === 'ready') {
      const dense = eligible.flatMap(row => {
        const saved = this.rawVectors.get(row.id);
        if (!saved || saved.embedderId !== embedderId || saved.vector.length !== vector!.length) return [];
        const score = cosine(saved.vector, vector!);
        return score > 0 ? [{id: row.id, score}] : [];
      }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      dense.forEach((h, i) => denseRank.set(h.id, i + 1));
    }

    const topicScore = new Map<string, number>();
    if (request.mode === 'D') {
      const cards = this.cardLexical.search(sparseQuery, this.topics.length);
      for (let cardRank = 0; cardRank < cards.length; cardRank++) {
        const sources = (this.topicSources.get(cards[cardRank].id) ?? []).filter(r => eligibleIds.has(r.id));
        if (!sources.length) continue;
        const intent = temporal?.order;
        sources.sort((a, b) => (lexicalScore.get(b.id) ?? 0) - (lexicalScore.get(a.id) ?? 0) ||
          (denseRank.get(a.id) ?? Infinity) - (denseRank.get(b.id) ?? Infinity) ||
          (intent === 'last' ? b.sequence - a.sequence : a.sequence - b.sequence));
        const contribution = 0.5 / (60 + cardRank + 1) / Math.sqrt(sources.length);
        for (const source of sources) topicScore.set(source.id, (topicScore.get(source.id) ?? 0) + contribution);
      }
    }

    const scored = new Map<string, RetrievalCandidate>();
    const add = (id: string, signal: RetrievalCandidate['signals'][number], amount: number) => {
      const row = this.byId.get(id);
      if (!row || !eligibleIds.has(id)) return;
      const found = scored.get(id) ?? {sourceId: id, sequence: row.sequence, score: 0, signals: []};
      found.score += amount;
      if (!found.signals.includes(signal)) found.signals.push(signal);
      scored.set(id, found);
    };
    for (const [id, rank] of lexicalRank) add(id, 'raw-lexical', request.mode === 'B' ? lexicalScore.get(id)! : 1 / (60 + rank));
    if (request.mode !== 'B') for (const [id, rank] of denseRank) add(id, 'raw-vector', 1 / (60 + rank));
    if (request.mode === 'D') for (const [id, score] of topicScore) add(id, 'topic-card', score);
    const ranked = [...scored.values()].sort((a, b) => b.score - a.score ||
      (temporal?.order === 'last' ? b.sequence - a.sequence : a.sequence - b.sequence));

    // Open a bounded set of high-ranked sources instead of automatically filling a large budget
    // with every weak match. The shared byte/token budget remains the hard upper bound.
    const cap = Math.max(1, Math.min(request.maxCandidates ?? 12, this.rows.length));
    const selected = new Map<string, CanonicalExchange>();
    const omitted: RetrievalResult['trace']['omittedRanked'] = [];
    const tryAdd = (candidate: RetrievalCandidate, reasonIfOmitted: 'budget' | 'candidate-limit') => {
      if (selected.has(candidate.sourceId)) return;
      const row = this.byId.get(candidate.sourceId)!;
      if (reasonIfOmitted === 'candidate-limit') {
        omitted.push({...candidate, reason: 'candidate-limit'}); return;
      }
      const proposed = evidenceOf([...selected.values(), row]);
      if (this.budget.count(JSON.stringify(proposed)) <= request.budget) selected.set(row.id, row);
      else omitted.push({...candidate, reason: 'budget'});
    };
    ranked.forEach((candidate, i) => tryAdd(candidate, i < cap ? 'budget' : 'candidate-limit'));

    if (request.expandLocalContext !== false && referenceCue(request.query)) {
      for (const hit of ranked.slice(0, cap)) {
        if (!selected.has(hit.sourceId)) continue;
        const row = this.byId.get(hit.sourceId)!;
        for (const neighbour of [this.bySequence.get(row.sequence - 1), this.bySequence.get(row.sequence + 1)]) {
          if (!neighbour || !eligibleIds.has(neighbour.id) || selected.has(neighbour.id)) continue;
          if (!continuous(neighbour.sequence < row.sequence ? neighbour : row,
            neighbour.sequence < row.sequence ? row : neighbour)) continue;
          tryAdd({sourceId: neighbour.id, sequence: neighbour.sequence, score: hit.score * 0.25,
            signals: ['local-continuity']}, 'budget');
        }
      }
    }

    const evidence = evidenceOf([...selected.values()]);
    const evidenceText = JSON.stringify(evidence);
    const trulyOmitted = omitted.filter(hit => !selected.has(hit.sourceId));
    return {evidence, evidenceText, trace: {
      mode: request.mode, budgetUnit: this.budget.unit, budgetLimit: request.budget,
      evidenceUnits: this.budget.count(evidenceText), selectedSourceIds: evidence.flatMap(s => s.records.map(r => r.sourceId)),
      rankedCandidates: ranked.slice(0, 128), omittedRanked: trulyOmitted.slice(0, 128), omittedCount: trulyOmitted.length,
      vectorStatus, validRawVectors: this.rawVectors.size, rejectedRawVectors: this.rejectedRawVectors,
      queryEmbeddingCalls, temporalFilter: temporal?.label ?? null, retrievalMs: performance.now() - started,
    }};
  }
}

export async function createRetrievalIndex(input: RetrievalIndexInput): Promise<RetrievalIndex> {
  const started = performance.now();
  const rows = input.exchanges.filter(r => r.status === 'completed');
  const byId = new Map(rows.map(row => [row.id, row]));
  const valid: RawVector[] = [];
  const dimensionsByEmbedder = new Map<string, number>();
  let rejected = 0;
  for (const item of input.vectors ?? []) {
    const row = byId.get(item.sourceId);
    if (!row || item.schemaVersion !== 1 || !item.embedderId?.trim() ||
      !validVector(item.vector) || item.dimensions !== item.vector.length ||
      item.textSha256 !== await sha256(rawEmbeddingText(row))) { rejected++; continue; }
    const knownDimensions = dimensionsByEmbedder.get(item.embedderId);
    if (knownDimensions !== undefined && knownDimensions !== item.dimensions) { rejected++; continue; }
    dimensionsByEmbedder.set(item.embedderId, item.dimensions);
    valid.push(item);
  }
  return new TranscriptRetrievalIndex(input, valid, rejected, started);
}
