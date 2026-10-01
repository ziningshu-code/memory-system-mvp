import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { create_memory, type long_memory } from '../longmemory/core/create_memory.js';
import {
  nvidia_embedding_provider,
  ollama_embedding_provider,
  openai_embedding_provider,
} from '../longmemory/core/embeddings/providers.js';
import { normalize_embedding_vector } from '../longmemory/core/embeddings/utility.js';
import type {
  configured_embedding_provider,
  embedding_context,
  embedding_provider_config,
} from '../longmemory/core/embeddings/types.js';
import { count_tokens } from '../longmemory/core/recall/context_builder.js';
import type { StrictRecallResult } from '../longmemory/core/recall/strict_recall.js';
import type { HistoricalRecallResult } from '../longmemory/core/recall/historical_recall.js';
import type { AssociativeRecallResult } from '../longmemory/core/recall/associative_recall.js';
import { TranscriptStore, type ConversationSource } from './transcript_store.js';

export type EmbeddingConfig =
  | { kind: 'openai'; baseUrl: string; model: string; apiKey?: string; dimension: number }
  | { kind: 'nvidia'; baseUrl?: string; model: string; apiKey: string; dimension: number }
  | { kind: 'ollama'; baseUrl?: string; model: string; dimension: number }
  | { kind: 'custom'; id: string; dimension: number; embed: (text: string, context: embedding_context) => Promise<number[]> };

export type MemoryConfig = {
  dbPath?: string;
  tenantId?: string;
  ownerId?: string;
  embedding: EmbeddingConfig;
  maxEvidenceTokens?: number;
  minSemanticSimilarity?: number;
};

export type RememberInput = {
  sessionId: string;
  user: string;
  assistant: string;
  turnId?: string;
  recordedAt?: number;
  /** The new completed exchange explicitly replaces the older source's exchange. */
  supersedesSourceId?: string;
  /** An evidence-backed validity date, never inferred by the SDK. */
  validFrom?: number;
};

export type RecallInput = {
  sessionId: string;
  query: string;
  limit?: number;
  maxEvidenceTokens?: number;
  /** What the memory system had recorded at this time. */
  asOf?: number;
  /** Only sources explicitly given validFrom can satisfy this filter. */
  validAt?: number;
};

export type RecalledSource = {
  sourceId: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  recordedAt: number;
  validFrom: number | null;
  score: number;
  exactRange: { start: number; end: number; total: number };
};

export type RecallResult = {
  context: string;
  sources: RecalledSource[];
  trace: {
    candidates: number;
    ranked: Array<{ sourceId: string; score: number; semantic: number | null; lexical: number | null }>;
    rejected: Array<{ sourceId: string; reason: string }>;
    omitted: Array<{ sourceId: string; reason: string }>;
    tokensUsed: number;
    budget: number;
    mode: 'strict' | 'historical';
    error?: string;
  };
};

type SessionState = { transcript: TranscriptStore; engine: long_memory; sessionId: string };

const defaultDbPath = () => join(homedir(), '.memory-system-mvp', 'memory.sqlite');

function providerFromConfig(config: EmbeddingConfig): { provider: configured_embedding_provider; fingerprint: string } {
  if (!Number.isSafeInteger(config.dimension) || config.dimension < 1) throw new Error('embedding.dimension must be a positive integer');
  if (config.kind !== 'custom' && !config.model?.trim()) throw new Error('embedding.model is required');
  if (config.kind === 'openai' && !config.baseUrl?.trim()) throw new Error('embedding.baseUrl is required for OpenAI-compatible embeddings');
  const identity = config.kind === 'custom'
    ? { kind: config.kind, id: config.id, dimension: config.dimension }
    : { kind: config.kind, model: config.model, baseUrl: config.baseUrl ?? '', dimension: config.dimension };
  const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const common: embedding_provider_config = {
    provider: config.kind === 'custom' ? 'local' : config.kind,
    fallback: [], tier: 'deep', dimension: config.dimension,
    timeout_ms: 20_000, max_retries: 1, retry_base_ms: 250,
    openai_base_url: 'https://api.openai.com/v1', openai_model: '',
    gemini_base_url: '', gemini_model: '', gemini_inputs_per_minute: 0,
    ollama_url: 'http://127.0.0.1:11434', ollama_model: '',
    aws_model: '', siray_base_url: '', siray_model: '', local_model: '',
  };
  let upstream: configured_embedding_provider;
  if (config.kind === 'openai') {
    upstream = new openai_embedding_provider({ ...common, openai_base_url: config.baseUrl,
      openai_model: config.model, openai_api_key: config.apiKey ?? 'local' }, {});
  } else if (config.kind === 'nvidia') {
    upstream = new nvidia_embedding_provider({ ...common, nvidia_base_url: config.baseUrl,
      nvidia_model: config.model, nvidia_api_key: config.apiKey }, {});
  } else if (config.kind === 'ollama') {
    upstream = new ollama_embedding_provider({ ...common,
      ollama_url: config.baseUrl ?? common.ollama_url, ollama_model: config.model }, {});
  } else {
    if (!config.id.trim()) throw new Error('custom embedding.id is required');
    upstream = { name: config.id, dimension: config.dimension, embed: config.embed };
  }
  // Enforce one real, declared embedding space. Never use upstream's synthetic fallback.
  const provider: configured_embedding_provider = {
    name: upstream.name,
    dimension: config.dimension,
    embed: async (text, context) => normalize_embedding_vector(await upstream.embed(text, context), config.dimension),
  };
  return { provider, fingerprint };
}

function sourceVisibleAt(source: ConversationSource, asOf?: number, validAt?: number): boolean {
  if (source.deletedAt !== null) return false;
  if (asOf === undefined) {
    if (source.supersededAt !== null) return false;
  } else if (source.recordedAt > asOf || (source.supersededAt !== null && source.supersededAt <= asOf)) {
    return false;
  }
  if (validAt !== undefined && (source.validFrom === null || source.validFrom > validAt)) return false;
  return true;
}

function excerptForBudget(source: ConversationSource, score: number, existing: string, budget: number): { text: string; source: RecalledSource } | null {
  const total = [...source.exactText].length;
  const marker = (end: number) => `[memory source=${source.sourceId} role=${source.role} recorded=${new Date(source.recordedAt).toISOString()} chars=0..${end}/${total}]\n`;
  const combined = (text: string) => existing ? `${existing}\n\n${text}` : text;
  if (count_tokens(combined(marker(0))) >= budget) return null;
  let low = 0;
  let high = total;
  const chars = [...source.exactText];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (count_tokens(combined(marker(mid) + chars.slice(0, mid).join(''))) <= budget) low = mid;
    else high = mid - 1;
  }
  if (low === 0) return null;
  return {
    text: `${marker(low)}${chars.slice(0, low).join('')}`,
    source: {
      sourceId: source.sourceId, turnId: source.turnId, role: source.role,
      text: chars.slice(0, low).join(''), recordedAt: source.recordedAt,
      validFrom: source.validFrom, score,
      exactRange: { start: 0, end: low, total },
    },
  };
}

/** Small application-facing SDK. LongMemory owns derived state in the same SQLite file. */
export function createMemory(config: MemoryConfig) {
  if (!config?.embedding) throw new Error('A real embedding provider is required');
  const { provider, fingerprint } = providerFromConfig(config.embedding);
  const dbPath = config.dbPath ?? defaultDbPath();
  if (dbPath === ':memory:') throw new Error('Persistent dbPath is required for exact transcript recovery');
  mkdirSync(dirname(dbPath), { recursive: true });
  const tenantId = config.tenantId ?? 'local';
  const ownerId = config.ownerId ?? 'default';
  if (!tenantId || !ownerId) throw new Error('tenantId and ownerId must be non-empty');
  const defaultBudget = config.maxEvidenceTokens ?? 512;
  // A fixed real-embedding fixture put relevant short correction sources at
  // 0.37-0.44 and unrelated candidates below 0.14 for this NVIDIA model.
  // Keep this model-specific and configurable; other providers retain the
  // conservative default until their own positive/negative cases are tested.
  const minimumSimilarity = config.minSemanticSimilarity
    ?? (config.embedding.kind === 'nvidia' && config.embedding.model === 'nvidia/nemotron-3-embed-1b' ? 0.35 : 0.62);
  if (!Number.isSafeInteger(defaultBudget) || defaultBudget < 0) throw new Error('maxEvidenceTokens must be non-negative');
  if (!Number.isFinite(minimumSimilarity) || minimumSimilarity < 0 || minimumSimilarity > 1) throw new Error('minSemanticSimilarity must be between 0 and 1');
  const sessions = new Map<string, SessionState>();
  const queues = new Map<string, Promise<unknown>>();
  let closed = false;

  const scopeKey = (sessionId: string) => JSON.stringify([ownerId, sessionId]);
  const openEngine = (sessionId: string): long_memory => create_memory({
    store: 'sqlite', db_path: dbPath, tenant_id: tenantId, user_id: scopeKey(sessionId),
    default_world: 'conversation', embedding_provider: provider,
    embedding_dimension: provider.dimension, enable_cold_log: false,
    enable_consolidation: false, enable_translation: false,
  });

  const derive = async (state: SessionState, source: ConversationSource): Promise<boolean> => {
    if (source.deletedAt !== null || !source.exactText) return false;
    try {
      const supersededNode = source.supersedesSourceId
        ? (await state.engine.explain(source.supersedesSourceId)).node
        : null;
      const result = await state.engine.ingest({
        id: source.sourceId, user_id: scopeKey(source.sessionId),
        text: source.exactText, speaker: source.role,
        conversation_id: source.sessionId,
        at: source.recordedAt, observed_at: source.recordedAt,
        ...(source.validFrom !== null ? { valid_from: source.validFrom } : {}),
        ...(supersededNode ? { supersedes_source_id: source.supersedesSourceId! } : {}),
        source_ref: `conversation:${source.sessionId}:${source.sourceId}`,
        conflict_behavior: 'none',
        metadata: { turn_id: source.turnId, source_id: source.sourceId, sequence: source.sequence },
      });
      state.transcript.markIndexed(source.sourceId, fingerprint, result.node.id);
      return true;
    } catch {
      state.transcript.markFailed(source.sourceId);
      return false;
    }
  };

  const rebuildDerived = async (state: SessionState): Promise<{ indexed: number; failed: number }> => {
    await state.engine.close();
    try {
      state.transcript.clearDerived();
    } finally {
      state.engine = openEngine(state.sessionId);
    }
    let indexed = 0;
    let failed = 0;
    for (const source of state.transcript.listDerivable(state.sessionId)) {
      if (await derive(state, source)) indexed++;
      else failed++;
    }
    return { indexed, failed };
  };

  const openState = async (sessionId: string): Promise<SessionState> => {
    if (!sessionId || typeof sessionId !== 'string') throw new Error('sessionId is required');
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const transcript = new TranscriptStore(dbPath, tenantId, scopeKey(sessionId));
    if (transcript.needsIndexRebuild(sessionId, fingerprint)) {
      transcript.clearDerived();
    }
    let engine: long_memory;
    try {
      engine = openEngine(sessionId);
    } catch (error) {
      transcript.close();
      throw error;
    }
    const state: SessionState = { transcript, engine, sessionId };
    sessions.set(sessionId, state);
    const sourcesAtOpen = transcript.listDerivable(sessionId);
    const recovered = new Set<string>();
    for (const source of sourcesAtOpen) {
      if (source.derivationStatus !== 'indexed' && await derive(state, source)) {
        recovered.add(source.sourceId);
      }
    }
    // A previously indexed correction could not link to its predecessor while
    // that predecessor's embedding was unavailable. Repair that graph once the
    // predecessor recovers; a persistent outage does not trigger a rebuild.
    if (recovered.size && sourcesAtOpen.some((source) => source.derivationStatus === 'indexed'
      && source.supersedesSourceId && recovered.has(source.supersedesSourceId))) {
      await rebuildDerived(state);
    }
    return state;
  };

  const run = <T>(sessionId: string, operation: (state: SessionState) => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('memory SDK is closed'));
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => operation(await openState(sessionId)));
    queues.set(sessionId, task.then(() => undefined, () => undefined));
    return task;
  };

  return {
    remember(input: RememberInput) {
      return run(input.sessionId, async (state) => {
        const turnId = input.turnId ?? randomUUID();
        const recordedAt = input.recordedAt ?? Date.now();
        const pair = state.transcript.recordExchange({ ...input, turnId, recordedAt,
          recordedAtExplicit: input.recordedAt !== undefined });
        const indexed: string[] = [];
        const failed: string[] = [];
        for (const source of pair) {
          if (source.derivationStatus === 'indexed' && source.embeddingFingerprint === fingerprint) {
            indexed.push(source.sourceId);
          } else if (await derive(state, source)) indexed.push(source.sourceId);
          else failed.push(source.sourceId);
        }
        return { turnId, sourceIds: pair.map((source) => source.sourceId), indexed, failed };
      });
    },

    recall(input: RecallInput): Promise<RecallResult> {
      return run(input.sessionId, async (state) => {
        const budget = input.maxEvidenceTokens ?? defaultBudget;
        const limit = input.limit ?? 5;
        if (!Number.isSafeInteger(budget) || budget < 0 || !Number.isSafeInteger(limit) || limit < 0) {
          throw new Error('limit and maxEvidenceTokens must be non-negative integers');
        }
        if (input.asOf !== undefined && !Number.isSafeInteger(input.asOf)) throw new Error('asOf must be a millisecond timestamp');
        if (input.validAt !== undefined && !Number.isSafeInteger(input.validAt)) throw new Error('validAt must be a millisecond timestamp');
        const trace: RecallResult['trace'] = {
          candidates: 0, ranked: [], rejected: [], omitted: [], tokensUsed: 0, budget,
          mode: input.asOf === undefined && input.validAt === undefined ? 'strict' : 'historical',
        };
        if (!input.query?.trim() || budget === 0 || limit === 0) return { context: '', sources: [], trace };
        let ranked: Array<{ sourceId: string; score: number; semantic?: number; lexical?: number }>;
        try {
          if (trace.mode === 'historical') {
            // LongMemory's historical subject filter is lexical. Use its
            // semantic/associative ranker for candidates, then intersect with
            // its own bitemporal view so paraphrases can find old sources.
            const [semantic, temporal] = await Promise.all([
              state.engine.recall({ text: input.query, mode: 'associative', k: Math.max(64, limit * 8),
                token_budget: Number.MAX_SAFE_INTEGER, min_confidence: 0 }) as Promise<AssociativeRecallResult>,
              state.engine.recall({ text: '', mode: 'historical', recorded_time: input.asOf,
                valid_time: input.validAt }) as Promise<HistoricalRecallResult>,
            ]);
            const recorded = input.asOf === undefined ? null
              : new Set(temporal.timeline.agent_belief_at_time.map((node) => node.id));
            const valid = input.validAt === undefined ? null
              : new Set(temporal.timeline.world_truth_at_time.map((node) => node.id));
            ranked = semantic.items
              .filter((item) => (!recorded || recorded.has(item.node.id)) && (!valid || valid.has(item.node.id)))
              .map((item) => ({ sourceId: item.node.id, score: item.score,
                semantic: item.breakdown.vector, lexical: item.breakdown.lexical }));
          } else {
            const result = await state.engine.recall({ text: input.query, mode: 'strict', k: Math.max(24, limit * 4),
              token_budget: Number.MAX_SAFE_INTEGER, min_confidence: 0 }) as StrictRecallResult;
            ranked = result.items.map((item) => ({
              sourceId: item.node.id, score: item.score,
              semantic: item.breakdown.semantic_similarity,
              lexical: item.breakdown.lexical_score,
            }));
          }
        } catch (error) {
          trace.error = error instanceof Error ? error.message : String(error);
          return { context: '', sources: [], trace };
        }
        trace.candidates = ranked.length;
        trace.ranked = ranked.map((candidate) => ({ sourceId: candidate.sourceId, score: candidate.score,
          semantic: candidate.semantic ?? null, lexical: candidate.lexical ?? null }));
        const sources: RecalledSource[] = [];
        const blocks: string[] = [];
        const seen = new Set<string>();
        for (const candidate of ranked) {
          if (seen.has(candidate.sourceId)) continue;
          seen.add(candidate.sourceId);
          if (sources.length >= limit) {
            trace.omitted.push({ sourceId: candidate.sourceId, reason: 'result limit' });
            continue;
          }
          const source = state.transcript.getSource(candidate.sourceId);
          if (!source || source.sessionId !== input.sessionId || !sourceVisibleAt(source, input.asOf, input.validAt)) {
            trace.rejected.push({ sourceId: candidate.sourceId, reason: 'source unavailable at requested time' });
            continue;
          }
          if ((candidate.semantic ?? 0) < minimumSimilarity
            && (candidate.lexical ?? 0) < 0.8) {
            trace.rejected.push({ sourceId: candidate.sourceId, reason: 'insufficient semantic and lexical relevance' });
            continue;
          }
          const excerpt = excerptForBudget(source, candidate.score, blocks.join('\n\n'), budget);
          if (!excerpt) {
            trace.omitted.push({ sourceId: candidate.sourceId, reason: 'evidence budget' });
            continue;
          }
          sources.push(excerpt.source);
          blocks.push(excerpt.text);
          trace.tokensUsed = count_tokens(blocks.join('\n\n'));
          if (excerpt.source.exactRange.end < excerpt.source.exactRange.total) {
            trace.omitted.push({ sourceId: candidate.sourceId, reason: 'source excerpted to fit evidence budget' });
          }
        }
        return { context: blocks.join('\n\n'), sources, trace };
      });
    },

    history(sessionId: string) {
      return run(sessionId, async (state) => state.transcript.listSession(sessionId));
    },

    rebuild(sessionId: string) {
      return run(sessionId, rebuildDerived);
    },

    erase(input: { sessionId: string; sourceId: string }) {
      return run(input.sessionId, async (state) => {
        await state.engine.close();
        let erased = false;
        try {
          erased = state.transcript.eraseSource(input.sourceId, Date.now());
        } finally {
          // A rejected erase rolls back its transaction; reopen the previous
          // derived state rather than leaving this session with a closed engine.
          state.engine = openEngine(input.sessionId);
        }
        if (erased) {
          for (const source of state.transcript.listDerivable(input.sessionId)) await derive(state, source);
        }
        return { erased };
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(queues.values());
      for (const state of sessions.values()) {
        await state.engine.close();
        state.transcript.close();
      }
      sessions.clear();
    },
  };
}

export type Memory = ReturnType<typeof createMemory>;
