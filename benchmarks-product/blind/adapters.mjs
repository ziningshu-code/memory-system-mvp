import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.mjs';
import { actualSourceKey } from './audit.mjs';

export async function createAdapters(dir, entries, providers) {
  const [{ createMemory }, { SqliteStore }, { create_memory }] = await Promise.all([
    import(pathToFileURL(entries.productEntry).href), import(pathToFileURL(entries.storeEntry).href),
    import(pathToFileURL(entries.upstreamEntry).href),
  ]);
  const scope = (ownerId, sessionId) => JSON.stringify([ownerId, sessionId]);
  const productDb = join(dir, 'product.sqlite'), upstreamDb = join(dir, 'upstream.sqlite');
  const memories = new Map(), engines = new Map(), sequences = new Map();
  const productFor = ownerId => {
    if (!memories.has(ownerId)) memories.set(ownerId, createMemory({ dbPath: productDb, tenantId: 'blind-synthetic', ownerId,
      embedding: { kind: 'custom', id: providers.product.name, dimension: providers.product.dimension, embed: providers.product.embed },
      minSemanticSimilarity: config.minSemanticSimilarity, maxEvidenceTokens: config.maxEvidenceTokens }));
    return memories.get(ownerId);
  };
  const upstreamFor = (ownerId, sessionId) => {
    const scoped = scope(ownerId, sessionId);
    if (!engines.has(scoped)) engines.set(scoped, create_memory({ store: 'sqlite', db_path: upstreamDb,
      tenant_id: 'blind-synthetic', user_id: scoped, default_world: 'conversation', embedding_provider: providers.upstream,
      embedding_dimension: providers.upstream.dimension, enable_cold_log: false, enable_consolidation: false, enable_translation: false }));
    return engines.get(scoped);
  };
  const nodeStorageOwnership = (store, node) => {
    if (!node) return null;
    const matches = store.database.prepare(`SELECT tenant_id, user_id, node_id FROM hydro_nodes
      WHERE tenant_id=? AND node_id=? AND json_extract(node_json, '$.metadata.user_id')=?
        AND json_extract(node_json, '$.metadata.conversation_id')=?`).all('blind-synthetic', node.id,
      node.metadata.user_id ?? null, node.metadata.conversation_id ?? null);
    return matches.length === 1 ? matches[0] : null; // Ambiguous ownership fails closed.
  };
  const nodeSource = (node, ownerId, sessionId, score = null) => {
    const store = new SqliteStore(upstreamDb, { tenant_id: 'blind-synthetic', user_id: scope(ownerId, sessionId),
      readonly: true, file_must_exist: true, startup_integrity_check: false });
    let storedOwnership;
    try { storedOwnership = nodeStorageOwnership(store, node); } finally { store.close(); }
    const source = { system: 'upstream', id: node.id,
    text: node.content.original_text ?? node.content.raw, derivedText: node.content.original_text ?? node.content.raw,
    role: node.metadata.speaker ?? null, turnId: node.metadata.turn_id ?? null, sequence: node.metadata.sequence ?? null,
    recordedAt: node.temporal.recorded_at, sourceTraceId: node.provenance.source_trace[0]?.source_id ?? null,
    sourceTraceRef: node.provenance.source_trace[0]?.ref ?? null, sourceTraceAt: node.provenance.source_trace[0]?.at ?? null,
    metadataSourceId: node.metadata.source_id ?? null, nodeUserId: node.metadata.user_id ?? null,
    nodeConversationId: node.metadata.conversation_id ?? null, nodeSourceId: node.id,
    nodeStorageOwnership: storedOwnership,
    score, excerpted: false,
    };
    return { ...source, key: actualSourceKey(source) };
  };
  const transcriptOwnership = (store, sourceId) => store.database.prepare(`SELECT tenant_id, user_id, session_id, source_id, derived_node_id
    FROM conversation_sources WHERE tenant_id=? AND user_id=? AND source_id=?`).get(store.tenant_id, store.user_id, sourceId) ?? null;
  const product = {
    async ingest({ ownerId, ...turn }) { return productFor(ownerId).remember(turn); },
    async history(ownerId, sessionId) {
      const history = await productFor(ownerId).history(sessionId);
      const store = new SqliteStore(productDb, { tenant_id: 'blind-synthetic', user_id: scope(ownerId, sessionId),
        readonly: true, file_must_exist: true, startup_integrity_check: false });
      try { return history.map(source => ({ ...source, storedOwnership: transcriptOwnership(store, source.sourceId) })); }
      finally { store.close(); }
    },
    async erase(ownerId, sessionId, sourceId) { return productFor(ownerId).erase({ sessionId, sourceId }); },
    async rebuild(ownerId, sessionId) { return productFor(ownerId).rebuild(sessionId); },
    async recall({ ownerId, sessionId, query, asOf }) {
      const started = performance.now();
      const raw = await productFor(ownerId).recall({ sessionId, query, limit: config.limit,
        maxEvidenceTokens: config.maxEvidenceTokens, ...(asOf === undefined ? {} : { asOf }) });
      const latencyMs = performance.now() - started;
      const store = new SqliteStore(productDb, { tenant_id: 'blind-synthetic', user_id: scope(ownerId, sessionId),
        readonly: true, file_must_exist: true, startup_integrity_check: false });
      try {
        return { latencyMs, error: raw.trace.error ? 'embedding or recall failure' : null, rankingAvailable: true,
          sources: raw.sources.map(source => {
            const node = store.load_node(source.sourceId);
            const audited = { system: 'product', id: source.sourceId, text: source.text,
              derivedText: node?.content.original_text ?? node?.content.raw ?? null,
              role: source.role, turnId: source.turnId, recordedAt: source.recordedAt,
              sourceTraceId: node?.provenance.source_trace[0]?.source_id ?? null,
              sourceTraceRef: node?.provenance.source_trace[0]?.ref ?? null, sourceTraceAt: node?.provenance.source_trace[0]?.at ?? null,
              metadataSourceId: node?.metadata.source_id ?? null, nodeUserId: node?.metadata.user_id ?? null,
              nodeConversationId: node?.metadata.conversation_id ?? null, nodeSourceId: node?.id ?? null,
              nodeStorageOwnership: nodeStorageOwnership(store, node),
              transcriptOwnership: transcriptOwnership(store, source.sourceId),
              score: source.score, excerpted: source.exactRange.end < source.exactRange.total };
            return { ...audited, key: actualSourceKey(audited) };
          }),
          trace: { candidates: raw.trace.candidates, tokensUsed: raw.trace.tokensUsed,
            rejected: raw.trace.rejected.map(item => ({ sourceId: item.sourceId, reason: item.reason })),
            ranked: raw.trace.ranked },
        };
      } finally { store.close(); }
    },
    async restart() { await this.close(); },
    async close() { await Promise.all([...memories.values()].map(memory => memory.close())); memories.clear(); },
  };
  const upstream = {
    async ingest(turn) {
      const engine = upstreamFor(turn.ownerId, turn.sessionId), scoped = scope(turn.ownerId, turn.sessionId);
      const base = sequences.get(scoped) ?? 0;
      const results = [];
      for (const [index, role] of ['user', 'assistant'].entries()) {
        results.push(await engine.ingest({ id: `${turn.turnId}:${role}`, text: turn[role], speaker: role,
          user_id: scoped, conversation_id: turn.sessionId, at: turn.recordedAt, observed_at: turn.recordedAt,
          source_ref: `conversation:${turn.sessionId}:${turn.turnId}:${role}`,
          conflict_behavior: turn.supersedesSourceId && role === 'user' ? 'supersede' : 'none',
          metadata: { source_id: `${turn.turnId}:${role}`, turn_id: turn.turnId, sequence: base + index + 1 } }));
      }
      sequences.set(scoped, base + 2);
      return { results };
    },
    async explain(ownerId, sessionId, sourceId) {
      const raw = await upstreamFor(ownerId, sessionId).explain(sourceId);
      return raw.node ? nodeSource(raw.node, ownerId, sessionId) : null;
    },
    async recall({ ownerId, sessionId, query, asOf }) {
      const started = performance.now();
      try {
        const raw = await upstreamFor(ownerId, sessionId).recall({ text: query,
          mode: asOf === undefined ? config.upstreamMode : 'historical',
          ...(asOf === undefined ? {} : { recorded_time: asOf }),
          k: config.limit, token_budget: config.maxEvidenceTokens, min_confidence: config.upstreamMinConfidence });
        const latencyMs = performance.now() - started; // Stored-scope audit is outside measured native recall.
        const sources = asOf === undefined ? raw.items.map(item => nodeSource(item.node, ownerId, sessionId, item.score))
          : raw.timeline.agent_belief_at_time.map(node => nodeSource(node, ownerId, sessionId));
        return { latencyMs, sources, error: null, rankingAvailable: asOf === undefined,
          nativeTimelineUnranked: asOf !== undefined };
      } catch {
        return { latencyMs: performance.now() - started, sources: [], error: 'embedding or recall failure', rankingAvailable: true };
      }
    },
    async restart() { await this.close(); },
    async close() { await Promise.all([...engines.values()].map(engine => engine.close())); engines.clear(); },
  };
  return { product, upstream };
}
