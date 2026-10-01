# Real embedding comparison, 2026-10-01

This is a **fixed 50-exchange synthetic conversation fixture using real NVIDIA
embeddings**, not a claim about production-scale answer accuracy. The unmodified
upstream core was LongMemory commit `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`.
The product and upstream received the same 100 visible messages, source IDs,
roles, timestamps, session scopes, and cached embedding vectors. There were no
generative-model or Main LLM calls.

The first saved live run used the product's prior `0.45` acceptance setting:
`results/live-2026-10-01T09-18-21-786Z/report.json`. It found a concrete
short-correction-query failure. The subsequent `0.35` run reused the **same
real vectors without another provider request**:
`results/live-2026-10-01T14-09-51-954Z/report.json`. Those machine-readable
reports are local and ignored by Git; run the harness to reproduce them.

| Check | Upstream | Product at 0.45 | Product at 0.35 | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Exact user/assistant text, role, order, session, time after restart | 100/100 | 100/100 | 100/100 | Upstream needs externally retained IDs for `explain()`; it has no native transcript listing API. |
| English, Chinese, mixed, cross-language paraphrase source found | 4/4 | 4/4 | 4/4 | Both found these four targets. |
| Session-isolated target found | 2/2 | 2/2 | 2/2 | Both stayed within the requested session. |
| Original no-memory negatives correctly return nothing | 0/2 | 2/2 | 2/2 | Upstream returned nearest unrelated items. |
| Current/historical correction, including erasure | 2/4 applicable; 3 N/A | 1/7 | 7/7 | `0.45` rejected relevant original text at semantic 0.37–0.44; `0.35` admitted it. The corrected result is **in-sample calibration**, not a blind holdout. |
| Obsolete same-turn assistant echo absent | 0/1; 2 N/A | 3/3 | 3/3 | Product correction/erase covers both visible roles. |
| Derived state rebuilt from exact transcript | N/A | 1/1 | 1/1 | Product recovery worked after restart. |
| Exact source survives injected embedding failure, then repairs | 0/2 | 2/2 | 2/2 | Upstream lacked a separately committed transcript for this path. |
| Provenance attribution of returned candidates | 1/8 | 8/8 | 8/8 | Seven rows inspect provenance of returned candidates, **not** whether the expected target was found. Upstream node IDs/text were exact even when `source_trace.source_id` pointed to the scoped owner. |

After observing the threshold failure, four additional no-memory query/session
pairs were checked with already-cached vectors. At `0.35`, the product returned
no memory for **4/4** and upstream for **0/4**. These are post-hoc stress checks,
not independent validation of the calibrated threshold. More real-world
negative cases are needed before generalizing this setting to other data or
embedding models. Other providers retain the configurable conservative default.

The successful provider run made **8 batched embedding requests** for 108
distinct document strings and 16 distinct query strings, with **2,128 input
tokens reported by NVIDIA**. One earlier authorized run also completed eight
requests but failed at a local Git preflight before recording its usage or
vectors; its provider cost is unmeasured. Later replays used eight cached
batches and made zero provider requests. Monetary cost was not calculated
because provider billing/pricing was not independently verified. The fixed
fixture's 50-turn ingest had local median/p95 times of 11/30 ms upstream and
13/28 ms product. These exclude provider network time because both systems
reused the same prefetched vectors. The product's one 96-message derived rebuild
took about 0.69 seconds. These small local timings do not establish a speed
advantage; product query handling was often slower because it resolves exact
transcript rows after ranking.

A replay after the app-specific `excludeTurnIds` addition reused all eight
cached batches with **zero new embedding requests** and preserved the category
results above (`results/live-2026-10-01T14-53-03-761Z/report.json`). That
parameter was absent from the comparison calls, so this checks only for an
unintended default-path regression. Across all benchmark operations, the
report counts 106 document / 15 query logical embedding invocations upstream
and 212 document / 23 query invocations in the product. These totals include
the product-only rebuild and additional supported correction/recovery queries;
they are **not a matched per-chat cost comparison**. An uncached rebuild can
require paid re-embedding of authoritative sources.

The correction comparison uses upstream's native heuristic
`conflict_behavior=supersede` for user messages versus the product's explicit
source-ID correction for both roles. It measures the supported API behaviors,
not algorithms given identical correction hints. Erase/rebuild operations
absent from upstream are marked N/A rather than failures. The fixture is too
small to claim general superiority, and no Main LLM final-answer evaluation
was run.
