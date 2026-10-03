# Generation 2 release audit — 2026-10-02

This is the historical audit of `memory-system-mvp@0.5.0-beta.1`, completed on 2026-10-02. Its original artifact sizes, hashes, test counts and benchmark results are retained below; they do not describe the upcoming `memory-system-v2@0.5.0-beta.2` package. Generation numbers describe architecture, not npm major versions.

**Publication update — 2026-10-03:** [v0.5.0-beta.1](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.1) is public at `d5a8781afe7beba6f45df2d7010a216fe57fd940`, with the inspected artifact below. GitHub publication and the Node 22/24 Windows/Linux CI matrix completed. No npm publication occurred. Beta.2 is a separate naming/onboarding preparation, with no release tag; see [current release notes](release-notes.md).

## 1. Generation 1 historical status

Generation 1 was a genuine independently designed topic-oriented memory implementation. Its experimental 0.3 work was not publicly released as a finished product. Later raw lexical/vector and proxy work was research rather than evidence that every advertised use case worked.

## 2. Historical preservation

Public tag `legacy-v1` and branch `legacy/generation-1` retain the earlier plugin at `33b90322c0747943766c3477ccce10753cb554d7`. The separate public tag `research-v1-0.3` retains the later research checkpoint at `f0c1991e443a8c1870c9e8c5a72166c6108c44a4`. Local tag `checkpoint/pre-generation2-release-e913dcb` retains the pre-cleanup V2 state. No historical commits were rewritten. The research checkpoint is not an ancestor of the V2 work branch. Old runtime, demos and topic configuration UI are excluded from the beta.1 package.

## 3. Generation 1 architecture

Topic Worker generated short topic indexes; Memory Selector chose likely topics; selected ranges reopened the exact original conversation. Later experiments investigated topic families, independent raw retrieval, deterministic fusion and application/proxy adapters. [Generation 1 history](generation-1.md) distinguishes these stages.

## 4. Limitations motivating the change

Generative indexing/selection added calls and token cost. Topic boundaries varied across models; short cards could omit retrieval cues. Original-text recovery did not guarantee that the correct source would first be selected. Provider timeouts complicated evaluation. Small synthetic tests did not demonstrate superiority over a model's full available context. Continuing to add layers risked further complexity without proven retrieval gains.

## 5. Generation 2 architecture

Visible paired exchange → exact authoritative transcript in local SQLite → LongMemory-derived nodes, embeddings and temporal relationships → semantic recall → exact-source resolution → bounded evidence for the host application's normal chat model. Original text is committed before embedding; failed derived indexing is repairable. The current shipped surface is a Node SDK, not a bundled proxy or setup page.

## 6. Relationship between the generations

V2 evolves V1's requirements, experiments and lessons. It replaces the runtime rather than placing LongMemory under the original Topic Worker system. V1 results do not establish V2 quality, and V2 results do not retroactively validate V1.

## 7. Relationship to LongMemory

V2 is built on and extends a modified LongMemory core. LongMemory owns the underlying embedding, semantic retrieval, derived graph, temporal and SQLite mechanisms. Project code supplies conversational lifecycle and exact-source behavior. This is a targeted product adaptation, not a new semantic-ranking algorithm or a complete upstream rearchitecture. No Mem0 runtime is included.

## 8. Pinned upstream

`CaviraOSS/LongMemory` revision `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`. The comparison builds a separate unmodified checkout, not the product's vendor copy. All 157 imported core/stores files are accounted for: 152 unchanged at the audited source checkpoint, five adapted.

## 9. Modified upstream files

| File under `src/longmemory/` | Adaptation |
| --- | --- |
| `stores/sqlite/migrations.ts` | Exact-conversation source table. |
| `core/engine/perception_parser.ts` | Explicit superseded-source input. |
| `core/engine/ingest_engine.ts` | Conversational source provenance and scoped explicit correction edges. |
| `core/embeddings/utility.ts` | Reject dimension mismatch and zero vectors. |
| `core/embeddings/providers.ts` | Retain injectable AWS client; remove undeclared automatic AWS dependency. |

All five retain upstream copyright and prominently identify modifications. Release cleanup added notices, not additional upstream behavioral changes. [ATTRIBUTION](../ATTRIBUTION.md) explains the license split.

## 10. Project-specific modules

`src/product/index.ts` exposes `createMemory`, `remember`, `recall`, `history`, `rebuild`, `erase`, `close`; manages embedding identity, source resolution, evidence budget, explicit corrections and recovery. `src/product/transcript_store.ts` owns authoritative conversational records. The generic example, SDK tests, benchmark harness, packaging and documentation are project additions. A fresh-install defect was fixed before the blind run by passing upstream's existing `requires_grounding: false` option for conversation utterances and versioning derived state; this records what was said without asserting external truth.

## 11. Final blind methodology

One independent, manually authored synthetic holdout: 200 completed exchanges, 400 messages, four owners, eight owner/session scopes, 50 pre-labeled queries; 25 exchanges per scope. Frozen NVIDIA `nvidia/nemotron-3-embed-1b`, 2048 dimensions, semantic gate 0.35, up to five sources, estimated evidence budget 4096 tokens. Source, harness, data and configuration are hashed before the sole live run. No Main LLM participates; no post-result tuning or new paid run was performed.

Manifest SHA256: `ffdaa1c16fc5f19da9b3267c85817348e772139a70f742cb59a914ce0f42878e`. Raw report SHA256: `2d77d76cead96643e3b06b792e343a530fcc001556c99e71eb5c8a499a5655bb`. See [methodology](../benchmarks-product/blind/README.md), [results](../benchmarks-product/blind/RESULTS.md) and [machine-readable report](../benchmarks-product/blind/FINAL-RESULTS.json).

## 12. Final results

| Measurement | Product | Pinned upstream |
| --- | ---: | ---: |
| Exact gold user source found, 35 shared ranked positive queries | 33/35 | 21/35 |
| Full evidence checks, those same queries | 33/35 | 19/35 |
| Mean relevant fraction of returned sources, those same queries | 77.14% | 21.14% |
| Correct no-memory abstention | 4/4 | 0/4 |
| Exact persisted message inspections | 400/400 | 400/400 |
| Exact returned text, stored scope and native provenance | 118/118 | 211/211 |
| Observed scope leakage | 0 | 0 |

Product passes 48/50 total query checks, including lifecycle cases. Upstream passes 22/43 applicable cases, with seven unsupported product operations N/A; those totals are not a like-for-like ranking score. Product current/historical corrections, erase/reversion, restart, rebuild and failure recovery pass. Four no-memory upstream failures return irrelevant sources inside the correct scope rather than leaking other scopes. Real provider work is 28 requests and 7,341 reported input tokens. No monetary cost or Main LLM token savings is inferred. Local timing excludes prefetched embedding network time; see the category report for timings and logical cache invocation counts.

## 13. Benchmark limitations

This is synthetic authored data, not 200 successive model conversations in one session. It does not measure generated-answer quality, a model's context limits, real-user performance, or universal superiority. Upstream native grounding defaults and heuristic corrections differ from product conversational contracts and exact correction hints. Three shared ranked positives involve those correction hints; excluding them leaves 30/32 product versus 19/32 upstream source hits. Earlier 50-turn data was used for calibration and is explicitly not independent validation. The two unchanged failures are q15 (birdwatching lunch, absent from the 24 candidate pool) and q22 (red flashlight, relevant Chinese sources ranked fourth/fifth but below 0.35). This demonstrates a real cross-language recall/rejection tradeoff.

## 14. SDK tests

TypeScript check passes; 23/23 deterministic SDK/example tests pass. Coverage includes exact restart persistence, recent-context exclusion, isolation, source corrections and paired echoes, erase/reversion chains, prefix evidence ranges, embedding failure, identity rebuild, concurrent saves within one instance and recovery of missing/incompletely recorded derived nodes. Explicit test embeddings validate behavior, not real semantic quality.

## 15. Real application integration

The SDK is installed in a separate private AI chat application's actual server work copy. Its 85/85 tests and server build pass against this beta. Visible speech is saved separately from internal injected evidence; recent turns are excluded and memory failure preserves valid chat responses. No paid Main LLM calls were used for these tests. Private source, patches, credentials and application identifiers are not redistributed. Existing app history is not automatically backfilled; hosts must reconcile a crash between their own history commit and SDK save.

## 16. Fresh installation

Passed from a clean export of the approved Git tree, with no old build or workspace dependency. Validation installs the packed artifact in an independent temporary consumer, performs strict TypeScript compilation without `skipLibCheck`, and exercises import, native SQLite, initialization, remember/recall, restart, history, rebuild, erase and close. Missing embedding configuration errors clearly; a local HTTP 401 fixture retains original speech and returns a trace error, with no synthetic production fallback. The exported SDK also passes all 23 tests and typecheck. Frozen offline checks verify all 509 source/harness inputs after LF/CRLF-only restoration, with zero external calls. The original working directory's Windows generated-file occupation did not affect the clean export or shipped artifact. Local validation used Node 24; after publication, [all four Node 22/24 Windows/Linux CI jobs passed](https://github.com/ziningshu-code/memory-system-mvp/actions/runs/37090351167).

## 17. Package audit

The exact tested artifact is `memory-system-mvp-0.5.0-beta.1.tgz`: **336 files, 241,970 compressed bytes, 1,167,259 unpacked bytes**. Independent audit confirms every entry byte-matches the clean exported build, public example/documentation and licenses. All 441 relative imports resolve internally. It excludes old V1 runtime, private integration, source credentials, databases, vector caches, benchmark runners/results and temporary files. The public `.env.example` contains placeholders only; 107 source maps have no personal absolute paths or embedded source.

SHA256: `906e666a14214779cb8ef1b7f41f47b38533e614683831ed6c5b674416ac3a08`.

npm integrity: `sha512-O93+nhKcg7Dt1b6CMUxK4D/IzQGFg5M6G7DPzwad/3K6/vWkKx+bsJZY752n3iaCBBsD4nJ+s7CVAGFub2tldQ==`.

## 18. Secrets and privacy

Full pre-release history audit covers 48 reachable commits and 427 unique text blobs, plus the final intended tree and synthetic report. No confirmed credentials, personal absolute paths, real-user chats, private app identifiers or patches were found. Historical key-like sentinel fixtures were reviewed as synthetic. Final report queries and IDs match the synthetic dataset. External embedding providers receive conversation/query text; local-first persistence does not mean all computation stays offline. Erase is logical deletion, not forensic wiping of SQLite pages or backups.

## 19. License audit

Project additions remain MIT; imported source remains Apache-2.0. Package metadata declares `MIT AND Apache-2.0`. Both licenses, the exact upstream license including its NOTICE, standalone NOTICE and attribution are included. Modified files retain required original notices and identify project changes. No copyright over upstream source or official LongMemory affiliation is claimed.

## 20. Documentation

At the beta.1 audit, English/Chinese README first described the SDK, installation and minimal example, then architecture, evolution, validation and limits. SDK/privacy/history/evolution/release notes were updated. Threshold calibration and the final holdout were separated. The configured Node 22/24 Windows/Linux CI jobs subsequently passed after publication. Automatic npm publishing is removed. Current onboarding is being revised separately for Memory System V2 beta.2.

## 21. Package identity

`memory-system-mvp@0.5.0-beta.1`: Generation 2 architecture, pre-1.0 beta semantic version. The name does not imply upstream affiliation. Registry metadata lookup did not find an existing public package; this does not establish future publish rights or name reservation.

## 22. GitHub release structure

The public default branch contains V2. Public `legacy-v1` preserves the earlier plugin, `research-v1-0.3` preserves the later research, and `v0.5.0-beta.1` preserves the audited release at `d5a8781afe7beba6f45df2d7010a216fe57fd940`. Release notes distinguish project additions, upstream reuse, V1 lessons and known limits. These tags and the beta.1 release artifact are unchanged by the beta.2 naming/onboarding work.

## 23. Known limitations

Node 22/24 and working `better-sqlite3` native support are required. Embeddings are mandatory; chat compatibility alone does not provide them. No bundled proxy, setup page or browser SDK. Recall can miss sources/admit distractors, including the two frozen cross-language failures. Search scales linearly with scoped records. Evidence budgets are estimates; oversized exact prefix excerpts may omit relevant trailing detail. Explicit corrections do not infer every contradiction. Scope IDs are not authentication. Use one SDK writer instance per database; cross-process writes are not supported as a general service. Rebuild can re-embed text and incur cost. No automatic V1 data migration, forensic erasure, historical backfill or shared transaction with a host application's own history store is provided.

## 24. Publication status

GitHub publication completed on 2026-10-03: the repository is public, the published beta.1 commit is `d5a8781afe7beba6f45df2d7010a216fe57fd940`, and both historical releases plus the beta.1 artifact are available. No npm publication occurred. The upcoming `memory-system-v2@0.5.0-beta.2` has no release tag and is not published to npm. Its documentation changes do not rewrite the beta.1 release or artifact.

## 25. Release decision

**Historical decision: ready to publish beta.1; GitHub publication subsequently completed.** SDK, private-app, fresh-consumer, frozen benchmark, privacy/package and attribution gates passed. The public `v0.5.0-beta.1` tag remains fixed at the audited release. Known retrieval misses are disclosed limitations, not concealed passing cases. Readiness means that documented beta was installable, tested and accurately attributed; it does not promise perfect retrieval or guarantee GitHub attention. This audit is not a new beta.2 validation report.
