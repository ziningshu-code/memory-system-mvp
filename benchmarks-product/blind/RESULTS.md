# Frozen independent synthetic benchmark results

The sole real-embedding run completed on 2026-10-02. The product passed **48/50** pre-labeled query cases. Unmodified upstream passed **22/43 applicable cases**, with **7 N/A** for native features it does not provide. These totals include different feature coverage and should not be presented as a pure ranking comparison.

The unchanged public raw report is [FINAL-RESULTS.json](FINAL-RESULTS.json), copied byte for byte from `results/live-2026-10-02T12-53-59-894Z/report.json`. Its SHA256 is `2d77d76cead96643e3b06b792e343a530fcc001556c99e71eb5c8a499a5655bb`. The pre-live [manifest](manifest.json) SHA256 remains `ffdaa1c16fc5f19da9b3267c85817348e772139a70f742cb59a914ce0f42878e`. No dataset, label, threshold, runtime, or harness was tuned after the result. Diagnosis below reads the saved report, database, and already cached real vectors; it makes no additional provider request.

## Comparable query denominators

| Measurement | Product | Unmodified upstream |
| --- | ---: | ---: |
| Gold user source found among up to five results, shared ranked positive queries | 33/35 (94.29%) | 21/35 (60.00%) |
| Full evidence checks passed, same shared ranked positive queries | 33/35 (94.29%) | 19/35 (54.29%) |
| Mean relevant precision among returned sources, same 35 queries | 77.14% | 21.14% |
| Correct abstention on the four empty-memory queries | 4/4 | 0/4 |
| Gold user source found, all product positive queries including supported product features | 43/45 (95.56%) | N/A: different coverage and historical output |
| Mean relevant precision among returned sources, all 45 product positives | 79.26% | N/A: different coverage and historical output |

The shared ranked set is q01–q30, q35/q37/q39, and q45/q46. It excludes four empty-memory queries, three unranked upstream historical timelines, four erase queries, two rebuild queries, and outage/recovery cases. Historical timeline hit and temporal checks are still reported separately below.

Each positive query labels an exact **user** source. Its paired assistant message also counts as relevant when computing returned-source precision. That precision is the per-query ratio of relevant returned sources to all returned sources, averaged over positive queries; empty output contributes zero. It is not conventional precision@5 with a fixed denominator. A gold hit can still fail the full case if stale, future, wrong-scope, altered, or incorrectly attributed evidence accompanies it. This explains upstream’s 21 gold hits but 19 full passes on the shared set.

## Categories

| Category | Queries | Product passes | Upstream passes |
| --- | ---: | ---: | ---: |
| Direct English | 7 | 7/7 | 2/7 |
| English paraphrase | 5 | 5/5 | 2/5 |
| Chinese paraphrase | 4 | 4/4 | 4/4 |
| Mixed language | 6 | 6/6 | 6/6 |
| English source → Chinese query | 3 | 3/3 | 0/3 |
| Chinese source → English query | 3 | 1/3 | 2/3 |
| Positive owner-scope queries with distractors | 2 | 2/2 | 1/2 |
| Unrecorded facts, English and Chinese | 2 | 2/2 | 0/2 |
| Session-scope empty-memory query | 1 | 1/1 | 0/1 |
| Owner-scope empty-memory query | 1 | 1/1 | 0/1 |
| Current explicit correction chain | 3 | 3/3 | 0/3 |
| Historical explicit correction chain | 3 | 3/3 | 2/3 |
| Erase and correction reversion | 4 | 4/4 | N/A |
| Recall after restart | 2 | 2/2 | 2/2 |
| Recall after transcript rebuild, including erasure | 2 | 2/2 | N/A |
| Injected outage: expected error and no evidence | 1 | 1/1 | 1/1 |
| Recovery solely from saved transcript | 1 | 1/1 | N/A |
| **Total** | **50** | **48/50** | **22/43 applicable; 7 N/A** |

The four abstention cases are q31–q34. Upstream returned five irrelevant sources from the **requested scope** for each. These are false-positive relevance/abstention results, not security leaks. Actual stored owner/session leakage was **zero for both systems** across all returned evidence. The outage query pass checks error behavior; upstream native transcript preservation remains N/A and is not established by that pass.

## Two product misses

**q15:** English query “What have I packed for the birdwatching lunch?” expected Chinese user source `我给午餐准备了豆腐饭团和黄瓜。` and paired assistant `你的午餐是豆腐饭团和黄瓜。`. Neither appeared in the product’s 24 ranked candidates. The product instead returned five unrelated, correctly scoped birdwatching sources; upstream also missed the expected user record. Read-only cosine calculations from the original real vectors give **0.302768** for the user and **0.278007** for the assistant, both below the frozen 0.35 semantic threshold. The trace establishes a candidate-coverage miss; the vector scores also show weak cross-language matching for this pair. No alternative threshold or retrieval configuration was evaluated.

**q22:** English query “Where can I find the red flashlight?” expected Chinese user source `红色手电筒放在望远镜包的外侧口袋。` and paired assistant `红色手电筒在望远镜包的外侧口袋。`. The user and assistant ranked fourth and fifth, with semantic scores **0.317942** and **0.311420** and lexical scores **0**. The product’s unchanged 0.35 semantic / 0.8 lexical relevance gate rejected both and returned no evidence. Upstream returned them and passed. This is an observed cross-language false negative from the product’s relevance gate, not a persistence or ownership failure. Composite rank scores near 0.388 are different from the semantic similarity used by that gate.

Both expected records were indexed, survived restart, and passed exact text, stored scope, and native provenance checks. Database inspection confirms `requires_grounding=false` for these records in both systems. Thus grounding exclusion does not explain these two misses. The third Chinese-source/English-query case, q07 about gathering at the red footbridge, passed in both systems. q21 is a separate direct-English observing-notebook query and passed.

## Persistence, scope, and provenance

Both systems successfully ingested all **200 completed exchanges**. After restart, all **400 exact message records** passed role, turn, sequence, timestamp, and source checks in all eight scopes. Product history enumerates its authoritative transcript; upstream inspection uses externally retained fixture IDs with `explain()` and does not demonstrate native transcript enumeration.

Across query outputs, exact returned and derived text, actual stored scope, and each system’s native provenance contract passed for **118/118 product sources** and **211/211 upstream sources**. Scope checks read SQL ownership, node metadata, and product transcript ownership rather than trusting caller-qualified labels. Product traces use per-source IDs for 118/118 returned sources. Upstream uses scoped-owner trace IDs for 211/211; those are valid native provenance when the source reference, timestamp, and metadata source ID agree. The per-source trace difference is a capability distinction, not a corruption score.

All four erase operations passed. Both rebuilds preserved their transcripts and excluded erased sources: 50 sources indexed for q47 and 46 surviving sources for q48, with zero failed derivations. During the injected outage, the product retained both exact messages and later recovered/indexed both without external replay. Baseline erase, transcript rebuild, and transcript-only recovery are N/A.

## Embedding work and local timings

| Real provider work | Requests | Exact unique inputs | Reported input tokens |
| --- | ---: | ---: | ---: |
| Documents | 25 | 399 | 6,728 |
| Queries | 3 | 44 | 613 |
| **Total** | **28** | **443** | **7,341** |

The sole run used 28 physical requests under the authorized cap of 29, with no reused batches on that initial run. Exact duplicate messages and repeated queries share vectors; both systems consume the same real prefetched NVIDIA vectors. The batch latencies sum to 288.083 seconds; batch median is 10.105 seconds and p95 is 17.443 seconds. These are observed provider timings, not an end-to-end product latency claim.

The shared pool recorded **687 document + 49 query logical provider invocations** for the product and **399 document + 39 query invocations** for upstream. Product counts include erase/rebuild/recovery work. They are cache-served logical invocations rather than additional billable requests, and do not establish general steady-state cost. Monetary cost and Main LLM token savings were not calculated.

Measured local recall uses already prefetched vectors and excludes provider network time and the separate ownership/provenance audit. Across all applicable query paths, product median/p95 is **2.80/22.68 ms** (50 cases) and upstream **0.71/4.26 ms** (43 cases). On the same 35 ranked positive queries, including the two reopen-after-restart calls, product median/p95 is **2.94/147.08 ms** and upstream **0.72/82.72 ms**. Restart queries themselves took 147.08–157.78 ms for the product and 82.72–89.68 ms for upstream. The two product transcript rebuild operations took 354.48 and 323.11 ms. These small local measurements do not establish production throughput or cold network latency.

## Interpretation limits

This is a manually authored synthetic holdout: **200 total exchanges, but only 25 completed exchanges in each of eight owner/session scopes**. It does not establish 200-turn retrieval inside a single session, real-user performance, Main LLM context limits, or generated-answer quality. No Main LLM participated.

The baseline is the unmodified pinned revision with native grounding defaults. The product uses the existing upstream `contract: { requires_grounding: false }` ingestion option for conversation utterances, treating the exact saved chat as evidence of what was said rather than certifying external truth. It also adds transcript persistence, exact correction hints, temporal/source validation, and a calibrated relevance gate. Upstream receives native heuristic `conflict_behavior=supersede` rather than those exact correction IDs. Historical upstream output is an unranked lexical timeline. These capability and policy differences contribute to the result: the figures do **not** demonstrate a new ranking algorithm outperforming upstream under identical policies. The two observed Chinese-to-English misses remain documented without tuning.
