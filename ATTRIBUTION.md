# Upstream attribution and modifications

Generation 2 includes source from [CaviraOSS/LongMemory](https://github.com/CaviraOSS/LongMemory), revision `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5` (2026-09-20), licensed under Apache License 2.0. The complete upstream license, copyright attribution, and embedded NOTICE are preserved unchanged in [UPSTREAM-LONGMEMORY-LICENSE](./UPSTREAM-LONGMEMORY-LICENSE).

Upstream `src/core/` and `src/stores/` are included under `src/longmemory/`. The following files have project-specific changes:

| Modified file | Product adaptation |
| --- | --- |
| `src/longmemory/stores/sqlite/migrations.ts` | Adds an exact-conversation source table in the same SQLite database so original text can be committed before derived indexing. |
| `src/longmemory/core/engine/perception_parser.ts` | Adds an explicit `supersedes_source_id` input for source-linked corrections. |
| `src/longmemory/core/engine/ingest_engine.ts` | Uses chat event IDs for exact-source provenance and creates explicit same-owner, same-conversation supersession edges without treating chat as an externally grounded fact. |
| `src/longmemory/core/embeddings/utility.ts` | Rejects wrong-size and zero embedding vectors instead of silently resizing them. |
| `src/longmemory/core/embeddings/providers.ts` | Retains an injected AWS client path and removes an undeclared automatic AWS SDK import. AWS is not an exposed provider of the conversation SDK. |

These adaptations were made by the memory-system-mvp project and are not changes from the original LongMemory authors. Upstream copyright and attribution headers remain in the imported files. New integration code, including authoritative transcript persistence and the public SDK, is under `src/product/`.

Original project code is licensed under the [MIT License](./LICENSE). Imported LongMemory material remains subject to Apache License 2.0; the combined package declares `MIT AND Apache-2.0`. Redistributed source and package artifacts include both license files and this attribution document. Apache License 2.0 section 4 requires distributing the license, marking modified files, retaining applicable source notices, and reproducing applicable NOTICE attribution. The preserved upstream license includes this NOTICE:

> LongMemory: Durable Memory Engine for AI Systems
>
> Copyright 2026 CaviraOSS and nullure
>
> This product includes software developed by CaviraOSS, nullure, and contributors.
>
> For more information, visit: https://github.com/CaviraOSS/LongMemory
