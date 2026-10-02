# Frozen independent synthetic benchmark

This is a new holdout corpus, authored before evaluating it. It contains 200 completed user/assistant exchanges (400 visible messages), four synthetic owners, eight owner/session scopes, and 50 pre-labeled queries. The scenarios are pottery, cycling, community theatre, birdwatching, a community pantry, astronomy, quilting, and kayaking. The conversations are manually authored natural synthetic exchanges, not real naturally generated chats. No Main LLM is used, and the benchmark does not evaluate generated answers.

Each owner/session scope contains 25 completed exchanges. The total of 200 therefore does not establish recall across 200 turns inside one session or measure Main LLM memory limits.

The frozen configuration is NVIDIA `nvidia/nemotron-3-embed-1b`, 2048 dimensions, product `minSemanticSimilarity=0.35`, five returned sources, and a 4096-token evidence budget. The source tree, configuration, labels, harness modules, and full exact input plan are hashed in `manifest.json` before evaluation. `dataset.json` and `config.json` are public synthetic snapshots. Existing frozen files cannot be overwritten by the runner. Any changed fixture, runtime, or settings require a new benchmark version rather than tuning this holdout after results.

Query coverage includes direct and paraphrased English, Chinese, mixed language, both cross-language directions, nearby distractors, owner/session isolation, no memory, current and historical explicit correction chains, erase reversion, restart, rebuild, and embedding failure/recovery. Exact source/role/time/sequence audits inspect all 400 messages after a restart. Returned source text, derived node text, and actual stored provenance are checked separately. Gold user sources define recall; their paired assistant messages count as relevant for precision. This avoids counting an assistant echo as retrieval of the exact user record.

`returnedRelevantPrecision` divides relevant returned sources by all returned sources; it is not conventional precision@5 with a fixed denominator. Ownership checks read actual node SQL tenant/user/ID fields, node metadata `user_id` and `conversation_id`, and product transcript tenant/user/session/source fields; caller-qualified IDs cannot establish isolation. SQL scope is authoritative and the native metadata sanitizer’s escaped-quote representation is accepted when it resolves to that same scope. Ambiguous persisted ownership fails closed. Forbidden scopes are checked directly. Historical grading checks every returned source against its recorded time and the fixture’s supersession chain at `asOf`; forbidden turn labels cover both user and assistant roles. Upstream’s native provenance `source_trace.source_id` is the scoped user in its native metadata representation, while the product uses the exact source ID. Both contracts are valid when their trace reference, timestamp, and metadata source ID match. `traceUsesPerSourceId` reports that capability difference separately from provenance correctness.

The baseline is unmodified LongMemory commit `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`. Both systems receive the same strings, roles, scoped IDs, times, and shared real vectors. The baseline uses its native strict retrieval and, for correction messages, `conflict_behavior=supersede`; it receives no product-specific source-ID field. Those different correction hints are disclosed per manifest. Native baseline historical recall is an unranked lexical timeline, so rank metrics are N/A for its historical rows. Baseline native transcript enumeration, source erase, rebuild from the transcript, and recovery solely from a saved transcript are N/A, not failures. Exact baseline source inspection uses externally retained synthetic fixture IDs with `explain()` and does not imply native history support.

From the repository root, after dependencies are installed:

```powershell
# Provide an unmodified upstream checkout (the sibling default also works).
git clone -c core.autocrlf=true https://github.com/CaviraOSS/LongMemory.git ../upstream-longmemory-audit
git -C ../upstream-longmemory-audit checkout 9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5
$env:LONGMEMORY_UPSTREAM_DIR = (Resolve-Path ../upstream-longmemory-audit).Path

node scripts/align-benchmark-line-endings.mjs
node benchmarks-product/blind/run.mjs --check
node benchmarks-product/blind/run.mjs --smoke
```

The committed snapshots are already frozen. `.gitattributes` preserves their LF bytes; the alignment helper restores only LF/CRLF differences in hashed source files and refuses any substantive change. It makes no network request and retains the original hashes. `--prepare` is for a new independent benchmark version, not for replacing this holdout. `--check` uses mocked transport only to verify exact input planning, request bounds, failure consumption, and cache reuse. `--smoke` builds both local runtimes, runs the full pipeline with explicitly marked token hashes, and verifies transcript and control-operation mechanics. Its retrieval outcomes and latency are not real embedding quality results. Neither offline mode calls an external model or API. Builds, database state, caches, and request ledgers stay inside this benchmark folder.

After explicit authorization for real embedding requests, set `NVIDIA_API_KEY` in the current process without printing it, then run:

```powershell
node benchmarks-product/blind/run.mjs --live --max-calls=29
```

The exact unique plan contains **399 document inputs plus 44 query inputs**. At the existing verified 16-input NVIDIA request shape, it needs **28 physical requests**: 24 document batches of 16 plus one of 15, and two query batches of 16 plus one of 12. The hard cap is 29 attempts across the persistent ledger for this frozen manifest. Each exact `(purpose,text)` is embedded once and cached; repeated erase/recovery queries reuse their identical vectors. Both adapters then use the same prefetched vectors. Batches start at least 2.1 seconds apart, responses are validated and normalized, and successful batches are atomically cached. No retries are automatic. A failed uncached batch consumes its attempt and cannot be retried under this frozen authorization. Do not delete the ledger to work around the cap.

Reports are `results/<mode>-<time>/report.json`. Public reports contain synthetic source IDs, source checks, latency, provider-reported usage (or null), request counts, configuration, and manifest hashes; no keys, absolute filesystem paths, real owner IDs, or private chats. Local operation latency excludes prefetched provider time. Monetary cost and Main LLM token savings are not inferred. Database files, vector caches, build output, and request ledgers are ignored; only synthetic snapshots, manifests, and public JSON reports should be shared.

The final offline checks and full smoke report are also saved as `OFFLINE-CHECKS.json` and `OFFLINE-SMOKE.json`, explicitly marked as harness validation with no real embedding quality claims.

The product base checkpoint is the fixed provenance value `e913dcba8dc6ea8117962b2adadd0c0f832ff9e4`. Current runtime files are verified by their exact hashes; a later release commit containing the same runtime does not invalidate the freeze. Pre-live review strengthened stored ownership, native provenance, and temporal grading and corrected the precision metric name. Its prior freeze is preserved in `preflight-freeze/evidence-review/`. Dataset, labels, thresholds, and runtime were unchanged, and no live result was inspected or tuned.

The first offline preflight exposed a Windows path-spelling error in the benchmark’s schema-copy destination and stopped before ingestion or retrieval. Its original freeze snapshots are preserved in `preflight-freeze/schema-copy/`. After that repair the full offline smoke passed. Repeated mocked transport checks then exposed an intermittent Windows file-replacement error in the request ledger. Its freeze is preserved in `preflight-freeze/ledger-replacement/`; the ledger now appends and fsyncs immutable attempt records, and a partial record refuses further requests. These harness repairs did not change the dataset, labels, thresholds, or runtime and made no live requests.
