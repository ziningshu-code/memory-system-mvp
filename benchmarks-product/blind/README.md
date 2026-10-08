# Retrieval benchmark

[Results](RESULTS.md) · [Raw report](FINAL-RESULTS.json) · [Dataset](dataset.json) · [Settings](config.json)

## Data and settings

The test contains 200 authored synthetic exchanges, 400 messages and 50 labeled queries. Four owners share eight separate owner/session scopes, with 25 exchanges per scope. It is not a 200-turn test inside one chat, and no chat model generates answers.

The topics include pottery, cycling, theatre, birdwatching, a community pantry, astronomy, quilting and kayaking. Queries cover direct lookup, paraphrases, Chinese, English, mixed language, distractors, empty memory, session isolation, explicit corrections, historical recall, deletion, restart, rebuild and embedding failures.

Both implementations receive the same text, source IDs, roles, timestamps and cached real vectors. The embedding model is NVIDIA `nvidia/nemotron-3-embed-1b`, with 2048 dimensions. Product settings are semantic threshold 0.35, up to five sources and an estimated 4096-token evidence budget.

Dataset, labels, settings, runtime and harness hashes were recorded in [manifest.json](manifest.json) before the real run. They were not tuned after seeing the results. Changed test inputs require a separate benchmark version.

## What is measured

- Whether the expected user message appears among the returned sources.
- Whether the returned text exactly matches the saved source.
- Relevant sources as a fraction of all returned sources; paired assistant replies also count as relevant.
- Empty-memory rejection and actual stored owner/session isolation.
- Current and historical corrections, deletion, restart, rebuild and recovery.
- Local operation latency, embedding requests and reported embedding input tokens.

The expected user source must be found; retrieving only an assistant echo does not satisfy that check. Scope checks inspect stored ownership, not just caller-provided IDs. Historical checks use recorded timestamps and correction chains. Returned-source precision is not fixed-denominator precision@5.

The baseline is unmodified LongMemory at `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`. It uses native strict recall and `conflict_behavior=supersede` for corrections. The product uses explicit `supersedesSourceId`, so correction hints differ. Upstream historical recall returns an unranked lexical timeline. Native transcript enumeration, source erase and transcript rebuild are unsupported and marked N/A. Inspecting upstream text with retained fixture IDs does not imply a native history API.

## Reproduce offline checks

From the repository root, install dependencies and provide a clean upstream checkout:

```powershell
npm ci
git clone -c core.autocrlf=true https://github.com/CaviraOSS/LongMemory.git ../upstream-longmemory-audit
git -C ../upstream-longmemory-audit checkout 9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5
$env:LONGMEMORY_UPSTREAM_DIR = (Resolve-Path ../upstream-longmemory-audit).Path
node scripts/align-benchmark-line-endings.mjs
node benchmarks-product/blind/run.mjs --check
node benchmarks-product/blind/run.mjs --smoke
```

In Windows PowerShell, use `npm.cmd` if needed. The alignment helper accepts only line-ending differences and preserves the frozen hashes. `--check` tests request planning and caching with mocked transport. `--smoke` checks the full pipeline with synthetic vectors. Neither mode measures real embedding quality or calls an external API. Saved checks are in [OFFLINE-CHECKS.json](OFFLINE-CHECKS.json) and [OFFLINE-SMOKE.json](OFFLINE-SMOKE.json).

## Real embedding run

The completed real run is recorded in [FINAL-RESULTS.json](FINAL-RESULTS.json). To use the live runner, set `NVIDIA_API_KEY` privately in the process, then run:

```powershell
node benchmarks-product/blind/run.mjs --live --max-calls=29
```

The frozen plan has 399 unique document inputs and 44 query inputs: 28 requests in batches of at most 16. The persistent ledger caps attempts at 29; failed attempts count and there are no automatic retries. Request starts are at least 2.1 seconds apart. Successful validated batches are cached by model, endpoint, purpose and text. Do not reset the ledger to exceed the cap. Both implementations use those same cached vectors.

## Reports and limits

Local reports are written under `results/<mode>-<time>/report.json`. API keys, private chats and personal filesystem paths are excluded from public reports. Databases, vector caches, build output and request ledgers are ignored.

Local latency excludes prefetched provider time. Missing provider usage is unknown. The benchmark does not infer monetary cost, chat-token savings or generated-answer accuracy. Earlier 50-exchange results were calibration data. These synthetic results do not establish performance on all real conversations.
