# Upstream attribution

This product includes adapted source from [CaviraOSS/LongMemory](https://github.com/CaviraOSS/LongMemory), revision `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5` (2026-09-20), under the Apache License 2.0 license. The complete upstream license and notices are in `UPSTREAM-LONGMEMORY-LICENSE`. Its imported source is under `src/longmemory/`.

The following imported files are modified compared with that revision:

- `src/longmemory/stores/sqlite/migrations.ts`: adds a dedicated exact-conversation source table inside the same SQLite database.
- `src/longmemory/core/engine/perception_parser.ts` and `src/longmemory/core/engine/ingest_engine.ts`: connect chat-derived nodes to exact source IDs and permit explicit same-conversation supersession without classifying chat as an external fact.
- `src/longmemory/core/embeddings/utility.ts`: rejects wrong-size or zero embedding vectors instead of resizing them.
- `src/longmemory/core/embeddings/providers.ts`: retains the injectable AWS client path but removes an undeclared automatic AWS SDK import from this small package.

These changes are not part of the original LongMemory project. New product integration code, including transcript-first persistence and the public SDK, is under `src/product/`.

The comparison also examined Mem0; no Mem0 source code is included in this version.
