# Local harness validation, 2026-10-01

This is an **offline harness check with deterministic local vectors**, not the
requested real-model benchmark. The full machine-readable result is in the ignored
local run `results/smoke-2026-10-01T09-02-51-685Z/report.json`. It used the exact
upstream LongMemory source at `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5` and
product commit `7e0c815ed30730f030a465c9ba2038be969a5830`. No embedding or
generative provider request was made.

| Structural case | Upstream | Product | Reading |
| --- | ---: | ---: | --- |
| Exact user/assistant text, role, order, session, timestamp after restart | 100/100 | 100/100 | Upstream was queried with externally retained source IDs and supplied metadata; it has no native transcript listing API. |
| Current/historical user-source correction | 2/4; 3 N/A | 7/7 | Upstream used native conflict behavior; source erasure is N/A. |
| Obsolete assistant echo absent after correction/erase | 0/1; 2 N/A | 3/3 | The product passed after correction was extended to the prior completed turn. |
| Derived state rebuilt from saved transcript | N/A | 1/1 | Product retained all 96 primary-session source texts and recovered the direct target query. |
| Exact source survives injected embedding failure | 0/1 | 1/1 | Upstream ingest failed before its first node persisted; product saved both visible messages. |
| Recovery after that failure | 0/1 | 1/1 | Product rebuilt and retrieved the original hiking-boots source after provider recovery. |
| Session isolation | 2/2 | 2/2 | Synthetic-vector result; useful only as a scope check. |

The correction scores compare upstream's native heuristic `conflict_behavior`
with the product's explicit `supersedesSourceId` linkage of a completed turn.
They measure the supported API behaviors, not ranking under identical
correction hints.

The source-grounding probe inspected stored graph provenance as well as returned
source IDs and text. Its seven attribution-only rows passed 0/7 upstream and 7/7
product. The eighth row tested direct target retrieval and passed on both sides.
Upstream returned exact node text under its node ID, but its provenance
`source_trace.source_id` identified the scoped owner rather than the original
message in the failed rows. The set of retrieved candidates depends
on the embedding model, so these counts are not a real-model source-attribution
rate. Semantic paraphrase, no-memory false recall, and latency results in the JSON
are likewise **not evidence of real-model quality or speed**.

The live harness is bounded to eight batched NVIDIA embedding requests for 108
document strings and 16 query strings. Automatic approval review rejected that
initial external run before any request was sent. Its stated reason was that sending
benchmark conversation content with a local credential to NVIDIA posed
unacceptable risk, and it asserted the user had not authorized the payload and
destination. An audit of existing local real-model records found **0/108** exact
document vectors and **0/16** exact query vectors, so an offline replay with the
requested model was not possible at that time. A later authorized attempt completed
all eight embedding batches but failed on a local Git trust check before writing a
comparison report; that runner had no batch cache. The offline smoke run reported
here used zero provider calls and zero provider tokens. Monetary cost was not
calculated.
