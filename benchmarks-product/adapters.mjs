import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { createMemory } from '../build-product/product/index.js';
import { SqliteStore } from '../build-product/longmemory/stores/sqlite/sqlite_store.js';

const scopeKey = (sessionId) => JSON.stringify(['benchmark-owner', sessionId]);
const sourceIds = (turn) => [`${turn.turnId}:user`, `${turn.turnId}:assistant`];

export function productAdapter(dir, provider, minSemanticSimilarity = 0.45) {
  const dbPath = join(dir, 'product.sqlite');
  let memory = createMemory({ dbPath, tenantId: 'benchmark', ownerId: 'benchmark-owner',
    embedding: { kind: 'custom', id: provider.name, dimension: provider.dimension, embed: provider.embed },
    minSemanticSimilarity, maxEvidenceTokens: 4096 });
  return {
    dbPath,
    async ingest(turn) { return memory.remember(turn); },
    async recall(sessionId, query, options = {}) {
      const started = performance.now();
      const raw = await memory.recall({ sessionId, query, limit: 5, maxEvidenceTokens: 4096, ...options });
      const latencyMs = performance.now() - started;
      // Audit LongMemory's actual stored provenance separately from the SDK's
      // transcript-resolved source ID. This read is outside measured recall time.
      const store = new SqliteStore(dbPath, { tenant_id: 'benchmark', user_id: scopeKey(sessionId),
        readonly: true, file_must_exist: true, startup_integrity_check: false });
      try {
        return { latencyMs, error: raw.trace.error ?? null,
          sources: raw.sources.map((source) => {
            const node = store.load_node(source.sourceId);
            return { id: source.sourceId, text: source.text,
              role: source.role, turnId: source.turnId, recordedAt: source.recordedAt,
              sourceTraceId: node?.provenance.source_trace[0]?.source_id ?? null,
              derivedText: node?.content.original_text ?? node?.content.raw ?? null,
              score: source.score, excerpted: source.exactRange.end < source.exactRange.total };
          }), trace: raw.trace };
      } finally { store.close(); }
    },
    async history(sessionId) { return memory.history(sessionId); },
    async rebuild(sessionId) { return memory.rebuild(sessionId); },
    async erase(sessionId, sourceId) { return memory.erase({ sessionId, sourceId }); },
    async restart() {
      await memory.close();
      memory = createMemory({ dbPath, tenantId: 'benchmark', ownerId: 'benchmark-owner',
        embedding: { kind: 'custom', id: provider.name, dimension: provider.dimension, embed: provider.embed },
        minSemanticSimilarity, maxEvidenceTokens: 4096 });
    },
    async close() { await memory.close(); },
  };
}

export function upstreamAdapter(dir, create_memory, provider) {
  const dbPath = join(dir, 'upstream.sqlite');
  const sessions = new Map();
  const sequences = new Map();
  const engineFor = (sessionId) => {
    if (!sessions.has(sessionId)) sessions.set(sessionId, create_memory({
      store: 'sqlite', db_path: dbPath, tenant_id: 'benchmark', user_id: scopeKey(sessionId),
      default_world: 'conversation', embedding_provider: provider,
      embedding_dimension: provider.dimension, enable_cold_log: false,
      enable_consolidation: false, enable_translation: false,
    }));
    return sessions.get(sessionId);
  };
  const close = async () => {
    await Promise.all([...sessions.values()].map((engine) => engine.close()));
    sessions.clear();
  };
  return {
    dbPath,
    async ingest(turn, { nativeCorrection = false } = {}) {
      const engine = engineFor(turn.sessionId);
      const results = [];
      const baseSequence = sequences.get(turn.sessionId) ?? 0;
      for (const [index, role] of ['user', 'assistant'].entries()) {
        const text = turn[role];
        const id = sourceIds(turn)[index];
        results.push(await engine.ingest({ id, user_id: scopeKey(turn.sessionId),
          text, speaker: role, conversation_id: turn.sessionId,
          at: turn.recordedAt, observed_at: turn.recordedAt,
          ...(turn.validFrom !== undefined ? { valid_from: turn.validFrom } : {}),
          source_ref: `conversation:${turn.sessionId}:${id}`,
          conflict_behavior: nativeCorrection && role === 'user' ? 'supersede' : 'none',
          metadata: { source_id: id, turn_id: turn.turnId, sequence: baseSequence + index + 1 },
        }));
      }
      sequences.set(turn.sessionId, baseSequence + 2);
      return { sourceIds: sourceIds(turn), results };
    },
    async explain(sessionId, sourceId) { return engineFor(sessionId).explain(sourceId); },
    async recall(sessionId, query, options = {}) {
      const started = performance.now();
      const raw = await engineFor(sessionId).recall({ text: query, mode: 'strict',
        k: 5, token_budget: 4096, min_confidence: 0, ...options });
      return { latencyMs: performance.now() - started, error: null,
        sources: raw.items.map((item) => ({ id: item.node.id,
          text: item.node.content.original_text ?? item.node.content.raw,
          role: item.node.metadata.speaker ?? null,
          turnId: item.node.metadata.turn_id ?? null,
          recordedAt: item.node.temporal.recorded_at,
          sourceTraceId: item.node.provenance.source_trace[0]?.source_id ?? null,
          derivedText: item.node.content.original_text ?? item.node.content.raw,
          score: item.score, excerpted: false })), trace: raw.trace };
    },
    async historical(sessionId, recordedTime) {
      return engineFor(sessionId).recall({ text: '', mode: 'historical', recorded_time: recordedTime });
    },
    async restart() { await close(); },
    close,
  };
}
