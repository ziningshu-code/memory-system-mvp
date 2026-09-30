import { SqliteStore } from '../longmemory/stores/sqlite/sqlite_store.js';

export type SourceRole = 'user' | 'assistant';

export type ConversationSource = {
  sessionId: string;
  sourceId: string;
  turnId: string;
  sequence: number;
  role: SourceRole;
  exactText: string;
  recordedAt: number;
  validFrom: number | null;
  supersedesSourceId: string | null;
  supersededBy: string | null;
  supersededAt: number | null;
  deletedAt: number | null;
  derivationStatus: 'pending' | 'indexed' | 'failed';
  derivedNodeId: string | null;
  embeddingFingerprint: string | null;
};

type SourceRow = {
  session_id: string;
  source_id: string;
  turn_id: string;
  sequence: number;
  role: SourceRole;
  exact_text: string;
  recorded_at: number;
  valid_from: number | null;
  supersedes_source_id: string | null;
  superseded_by: string | null;
  superseded_at: number | null;
  deleted_at: number | null;
  derivation_status: ConversationSource['derivationStatus'];
  derived_node_id: string | null;
  embedding_fingerprint: string | null;
};

const fromRow = (row: SourceRow): ConversationSource => ({
  sessionId: row.session_id,
  sourceId: row.source_id,
  turnId: row.turn_id,
  sequence: row.sequence,
  role: row.role,
  exactText: row.exact_text,
  recordedAt: row.recorded_at,
  validFrom: row.valid_from,
  supersedesSourceId: row.supersedes_source_id,
  supersededBy: row.superseded_by,
  supersededAt: row.superseded_at,
  deletedAt: row.deleted_at,
  derivationStatus: row.derivation_status,
  derivedNodeId: row.derived_node_id,
  embeddingFingerprint: row.embedding_fingerprint,
});

/** Exact chat sources in the same scoped SQLite file as LongMemory's derived graph. */
export class TranscriptStore {
  readonly upstream: SqliteStore;

  constructor(dbPath: string, tenantId: string, scopedUserId: string) {
    this.upstream = new SqliteStore(dbPath, { tenant_id: tenantId, user_id: scopedUserId });
  }

  private get scope(): [string, string] {
    return [this.upstream.tenant_id, this.upstream.user_id];
  }

  recordExchange(input: {
    sessionId: string;
    turnId: string;
    user: string;
    assistant: string;
    recordedAt: number;
    validFrom?: number;
    supersedesSourceId?: string;
  }): [ConversationSource, ConversationSource] {
    if (!input.sessionId || !input.turnId) throw new Error('sessionId and turnId are required');
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.turnId)) throw new Error('turnId must contain only letters, digits, dot, underscore, colon, or hyphen');
    if (typeof input.user !== 'string' || typeof input.assistant !== 'string') throw new Error('conversation text must be strings');
    if (!Number.isSafeInteger(input.recordedAt) || input.recordedAt < 0) throw new Error('recordedAt must be a millisecond timestamp');
    if (input.validFrom !== undefined && !Number.isSafeInteger(input.validFrom)) throw new Error('validFrom must be a millisecond timestamp');

    return this.upstream.transaction(() => {
      const [tenant, owner] = this.scope;
      const existing = this.upstream.database.prepare(`SELECT * FROM conversation_sources
        WHERE tenant_id = ? AND user_id = ? AND session_id = ? AND turn_id = ? ORDER BY sequence`)
        .all(tenant, owner, input.sessionId, input.turnId) as SourceRow[];
      if (existing.length) {
        if (existing.length !== 2 || existing[0].role !== 'user' || existing[1].role !== 'assistant'
          || existing[0].exact_text !== input.user || existing[1].exact_text !== input.assistant) {
          throw new Error('turnId already exists with different conversation text');
        }
        return [fromRow(existing[0]), fromRow(existing[1])];
      }
      const next = (this.upstream.database.prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS next
        FROM conversation_sources WHERE tenant_id = ? AND user_id = ? AND session_id = ?`)
        .get(tenant, owner, input.sessionId) as { next: number }).next;
      const sourceIds = [`${input.turnId}:user`, `${input.turnId}:assistant`];
      const insert = this.upstream.database.prepare(`INSERT INTO conversation_sources
        (tenant_id, user_id, session_id, source_id, turn_id, sequence, role, exact_text, recorded_at, valid_from, supersedes_source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insert.run(tenant, owner, input.sessionId, sourceIds[0], input.turnId, next, 'user', input.user,
        input.recordedAt, input.validFrom ?? null, input.supersedesSourceId ?? null);
      insert.run(tenant, owner, input.sessionId, sourceIds[1], input.turnId, next + 1, 'assistant', input.assistant,
        input.recordedAt, input.validFrom ?? null, null);
      if (input.supersedesSourceId) {
        const old = this.getSource(input.supersedesSourceId);
        if (!old || old.sessionId !== input.sessionId || old.recordedAt > input.recordedAt) {
          throw new Error('superseded source must be an earlier source in the same session');
        }
        const changed = this.upstream.database.prepare(`UPDATE conversation_sources
          SET superseded_by = ?, superseded_at = ?
          WHERE tenant_id = ? AND user_id = ? AND session_id = ? AND source_id = ?
            AND deleted_at IS NULL AND superseded_at IS NULL`)
          .run(sourceIds[0], input.recordedAt, tenant, owner, input.sessionId, input.supersedesSourceId).changes;
        if (changed !== 1) throw new Error('supersedesSourceId is missing, deleted, or already superseded');
      }
      return [this.getSource(sourceIds[0])!, this.getSource(sourceIds[1])!];
    });
  }

  getSource(sourceId: string): ConversationSource | null {
    const row = this.upstream.database.prepare(`SELECT * FROM conversation_sources
      WHERE tenant_id = ? AND user_id = ? AND source_id = ?`)
      .get(...this.scope, sourceId) as SourceRow | undefined;
    return row ? fromRow(row) : null;
  }

  listSession(sessionId: string): ConversationSource[] {
    return (this.upstream.database.prepare(`SELECT * FROM conversation_sources
      WHERE tenant_id = ? AND user_id = ? AND session_id = ? ORDER BY sequence`)
      .all(...this.scope, sessionId) as SourceRow[]).map(fromRow);
  }

  listTurn(sessionId: string, turnId: string): ConversationSource[] {
    return (this.upstream.database.prepare(`SELECT * FROM conversation_sources
      WHERE tenant_id = ? AND user_id = ? AND session_id = ? AND turn_id = ? ORDER BY sequence`)
      .all(...this.scope, sessionId, turnId) as SourceRow[]).map(fromRow);
  }

  listDerivable(sessionId: string): ConversationSource[] {
    return this.listSession(sessionId).filter((source) => source.deletedAt === null && source.exactText.length > 0);
  }

  needsIndexRebuild(sessionId: string, fingerprint: string): boolean {
    const row = this.upstream.database.prepare(`SELECT COUNT(*) AS count
      FROM conversation_sources AS source
      LEFT JOIN hydro_nodes AS node
        ON node.tenant_id = source.tenant_id AND node.user_id = source.user_id
        AND node.node_id = source.source_id
      WHERE source.tenant_id = ? AND source.user_id = ? AND source.session_id = ?
        AND ((source.derivation_status = 'indexed'
              AND (source.embedding_fingerprint IS NOT ? OR node.node_id IS NULL))
          OR (source.derivation_status != 'indexed' AND node.node_id IS NOT NULL))`)
      .get(...this.scope, sessionId, fingerprint) as { count: number };
    return row.count > 0;
  }

  markIndexed(sourceId: string, fingerprint: string, nodeId: string): void {
    this.upstream.database.prepare(`UPDATE conversation_sources
      SET derivation_status = 'indexed', derived_node_id = ?, embedding_fingerprint = ?
      WHERE tenant_id = ? AND user_id = ? AND source_id = ? AND deleted_at IS NULL`)
      .run(nodeId, fingerprint, ...this.scope, sourceId);
  }

  markFailed(sourceId: string): void {
    this.upstream.database.prepare(`UPDATE conversation_sources SET derivation_status = 'failed'
      WHERE tenant_id = ? AND user_id = ? AND source_id = ? AND deleted_at IS NULL`)
      .run(...this.scope, sourceId);
  }

  /** Remove only derived state; exact transcript rows remain authoritative. */
  clearDerived(): void {
    this.upstream.transaction(() => this.clearDerivedInTransaction());
  }

  private clearDerivedInTransaction(): void {
    const tables = [
      'entity_aliases', 'world_node_refs', 'world_edge_refs', 'memory_contracts',
      'hydro_edges', 'hydro_nodes', 'entities', 'worlds', 'contradictions',
      'grounded_facts', 'audit_log', 'sketch_operations', 'sketch_states', 'cold_logs',
    ];
    for (const table of tables) {
      this.upstream.database.prepare(`DELETE FROM ${table} WHERE tenant_id = ? AND user_id = ?`)
        .run(...this.scope);
    }
    this.upstream.database.prepare(`UPDATE conversation_sources
      SET derivation_status = 'pending', derived_node_id = NULL, embedding_fingerprint = NULL
      WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL`).run(...this.scope);
  }

  /** Erase visible text and all derived copies in one transaction. */
  eraseSource(sourceId: string, deletedAt: number): boolean {
    return this.upstream.transaction(() => {
      const changed = this.upstream.database.prepare(`UPDATE conversation_sources
        SET exact_text = '', deleted_at = ?, derivation_status = 'pending',
          derived_node_id = NULL, embedding_fingerprint = NULL
        WHERE tenant_id = ? AND user_id = ? AND source_id = ? AND deleted_at IS NULL`)
        .run(deletedAt, ...this.scope, sourceId).changes;
      if (changed) this.clearDerivedInTransaction();
      return changed === 1;
    });
  }

  close(): void {
    this.upstream.close();
  }
}
