# Project evolution

Memory System V2 combines an adapted LongMemory core with a conversation SDK in `src/product/`. The earlier Topic Memory plugin and later research remain available through separate public tags. The generations represent different implementations, not interchangeable package versions or one continuous set of benchmark results.

## Source checkpoints

| Stage | Exact commit | Reference and meaning |
| --- | --- | --- |
| Public Generation 1 plugin | `33b90322c0747943766c3477ccce10753cb554d7` | [legacy-v1 release](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/legacy-v1) and `legacy/generation-1` branch; the 0.2 topic SDK and local plugin. |
| Generation 1 research | `f0c1991e443a8c1870c9e8c5a72166c6108c44a4` | [research-v1-0.3 tag](https://github.com/ziningshu-code/memory-system-mvp/tree/research-v1-0.3); experimental 0.3 Topic Memory, families, native adapters, and alternative retrieval engines. Not an npm release. |
| Transcript-only prototype | `3debf037ad34c4dd04073d24599228998dc35c20` | `work/local-transcript-memory`; exact-transcript persistence, semantic/lexical retrieval, and a local compatible proxy. It examined upstream projects as references without importing their source. |
| Initial Generation 2 implementation | `2f3305554942beb71235bd419e6bf27f8896b810` | Imports LongMemory core/stores and introduces the conversation SDK. |
| Generation 2 before release cleanup | `e913dcba8dc6ea8117962b2adadd0c0f832ff9e4` | `checkpoint/pre-generation2-release-e913dcb`; correction/recovery fixes, real embedding comparison, acceptance calibration, and recent-turn exclusion. This checkpoint precedes the final documentation and cleanup. |
| Public Generation 2 beta.1 | `d5a8781afe7beba6f45df2d7010a216fe57fd940` | [v0.5.0-beta.1 release](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.1); GitHub artifact named `memory-system-mvp-0.5.0-beta.1.tgz`. No npm publication. |

The public `legacy-v1`, `research-v1-0.3`, and `v0.5.0-beta.1` tags preserve these distinct snapshots. Other checkpoint and work-branch names in the table describe local development history. The Generation 2 branch started from the earlier plugin baseline; it does not contain the later Generation 1 research checkpoint as an ancestor.

The next package is prepared as `memory-system-v2@0.5.0-beta.2`, with the display name Memory System V2. This naming and onboarding update does not replace the beta.1 tag or artifact. Beta.2 has no release tag and has not been published to npm.

## What changed in Generation 2

Generation 1 used model-generated topic cards and families to locate immutable originals. A separate prototype then tried direct exact-transcript retrieval. Generation 2 uses LongMemory's durable graph, embeddings, recall, temporal, and SQLite machinery, with an application-facing wrapper that makes completed conversation text authoritative.

The wrapper saves both visible roles before attempting derived nodes or embeddings, resolves retrieved node candidates back to exact conversation sources, separates sessions, supports explicit source corrections and logical turn erasure, and rebuilds derived state from retained sources. It exposes a bounded evidence result for the calling application's normal chat model. Hosts can supply recent turns separately and exclude their IDs from older recalled evidence; the private application integration validates that lifecycle. The generic example demonstrates a single current text request.

This product therefore includes modified upstream source. It should not be described as an unmodified LongMemory distribution, or as a package that only took architectural inspiration from LongMemory. [Attribution](../ATTRIBUTION.md) identifies the imported revision, exact modified files, and license split.

## Upstream and evaluation

The imported baseline is [CaviraOSS/LongMemory](https://github.com/CaviraOSS/LongMemory) commit `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`, dated 2026-09-20. At the pre-release checkpoint, all 157 upstream files under `src/core/` and `src/stores/` are represented under `src/longmemory/`; 152 retain identical Git blobs and five contain documented product adaptations.

The comparison harness compiles the pinned upstream core from a separate checkout and verifies both its revision and the absence of local changes to its core/stores. The real embedding comparison used a fixed synthetic conversation fixture and shared cached NVIDIA vectors. It tested exact-source persistence, recall, isolation, correction, erasure, provenance, and recovery. It made no generative-model or main-model final-answer calls. The NVIDIA acceptance adjustment was calibrated on that fixture, so it is not a blind holdout result or a universal similarity threshold.

See the repository's [earlier real embedding results](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/REAL-RESULTS.md) and offline records for calibration accounting. The final independent holdout contains 200 authored exchanges across eight scopes, 400 messages and 50 queries. Parameters were frozen before the sole real run. Product passes 48/50 checks, with two cross-language retrieval misses; shared ranked exact-user Recall@5 is 33/35 versus 21/35 upstream. Both retain all 400 original messages. [Final category results](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/RESULTS.md) disclose policy differences, costs and limits. Missing upstream erase/rebuild APIs are N/A. Source integrity and supported operations remain separate from final-answer quality. The beta.2 naming update makes no new benchmark claim.

[Generation 1](./generation-1.md) documents its implemented experiments and their own evidence. The current product's benchmark results do not retroactively validate Generation 1, and the older Topic Memory results do not establish Generation 2 performance.
