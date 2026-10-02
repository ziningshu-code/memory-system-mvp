# Upstream LongMemory comparison harness

This harness compares the local product with the unmodified LongMemory core at commit
`9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`. It compiles that exact source from
the sibling `upstream-longmemory-audit` checkout into ignored local output; it does
not use the product's modified vendor copy as an upstream substitute. Run the
product's ordinary build first so `build-product` reflects the current working tree.
Set `LONGMEMORY_UPSTREAM_DIR` to a clean clone checked out at that exact revision
to reproduce this outside the development workspace. No private application is
needed. The first saved live comparison and subsequent cached-vector calibration are
reported separately in [REAL-RESULTS.md](REAL-RESULTS.md); the earlier
deterministic harness check remains in [OFFLINE-RESULTS.md](OFFLINE-RESULTS.md).

`node benchmarks-product/run.mjs --prepare` validates the upstream commit, compiles
it, and counts the fixture with **zero embedding calls**. `--smoke` exercises the
entire harness with a deterministic local vector solely to check execution and
source relationships. Its retrieval scores, false recall, and speed are **not**
real-model evidence. Results go to ignored `benchmarks-product/results/<run>/report.json`.

The live mode is configured for `nvidia/nemotron-3-embed-1b` at 2048 dimensions.
It prefetches 108 distinct document strings and 16 query strings in at most eight
batched NVIDIA requests, with at least 2.1 seconds between request starts. Both
systems then receive the same normalized vectors from memory. The harness makes no
generative-model calls, retries, or unplanned embedding calls. The live JSON report
records physical request counts, observed prompt tokens if supplied, provider
latency, per-side logical embedding calls, and engine-operation latency. It does
not calculate a monetary amount from unverified pricing. Credentials are never
written to the cache or report; the local report can include synthetic test
queries and source IDs. Plaintext inputs are not written to the vector cache. Successful normalized
vector batches are atomically saved in ignored `.vector-cache/` files named by a
digest of the model, endpoint, purpose, and exact input strings. A rerun verifies
and reuses matching batches before making any new request. The report separates
new physical requests and their usage from reused batches and their original
usage. Missing provider usage is recorded as unknown.

The baseline corpus has 50 exchanges and 100 visible messages across two sessions.
Each system receives the same exact strings, IDs, roles, timestamps, and session
scope. Upstream receives the same metadata as the product for a fair source check.
Its `explain(id)` can recover exact raw node text after restart when those IDs are
retained externally; this is reported separately from a native transcript history
API. For corrections, upstream receives its native `conflict_behavior=supersede`,
while the product receives its explicit `supersedesSourceId`. Upstream lacks native
source erasure and transcript-based rebuild, so those rows are marked N/A. The
correction results compare each API's supported behavior, not algorithms given
identical correction hints. The
report distinguishes node-ID-to-text fidelity from `source_trace.source_id`
attribution, and tests surviving assistant echoes separately from user-source
supersession.

The first eight-batch provider run failed at a local Git trust check before
writing a report; that runner did not cache vectors. The repaired runner checks
Git and imports first and saves each successful batch. A second bounded run
completed and produced the real comparison in
[REAL-RESULTS.md](REAL-RESULTS.md). Later analyses reused those vectors without
additional provider requests. Before the first authorized attempt, historical
cache coverage was **0/108** exact document inputs and **0/16** exact query inputs.
