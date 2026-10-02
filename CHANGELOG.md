# Changelog

## 0.5.0-beta.1 — Generation 2 (prepared locally, not published)

- Replace the earlier Topic Memory runtime with an attributed, modified LongMemory core. Generation 2 carries forward the product requirements and lessons of Generation 1, not its runtime implementation.
- Add exact paired conversation persistence before embeddings, source-grounded recall, stable session/turn/source identifiers, explicit correction chains, logical turn erasure, rebuild/recovery, and recent-turn exclusion.
- Expose `createMemory`, `remember`, `recall`, `history`, `rebuild`, `erase`, and `close` for Node applications. No extra generative memory-model call is required; a real embedding provider is required.
- Fix ordinary factual utterances being incorrectly excluded by an external-grounding requirement. Conversation provenance establishes what was said, not whether it is externally true. Existing development indexes rebuild for the new derived contract version.
- Preserve V1 at local `legacy-v1`, clean obsolete runtime/demo/UI files from the current tree, identify all upstream modifications, and validate a clean consumer installation.
- Run a new frozen synthetic holdout with real embeddings; retain earlier threshold-calibration evidence separately. See the benchmark report for actual results and limitations.

The following entries document earlier Generation 1 releases; their runtime is available through history rather than the current package.

## 0.2.0

- Add a local plugin launcher (`npx topic-memory` / GitHub ZIP `start.cmd`) and a single-page setup, real chat, session selector and live comparison. Users provide their own endpoint and key; no `.env` is required.
- Add loopback-only text Chat Completions gateway with local authentication, per-session URLs, serialized requests and buffered SSE compatibility. Unsupported multimodal/tool/structured-output requests fail explicitly.
- Add durable atomic file storage via `topic-memory/node`, restart recovery and a single-process data-directory lock.
- Fix interleaved topic indexing losing earlier open-topic spans. Reject spans crossing unavailable records and count actual completed exchanges for finalization. Skip unchanged accepted indexing input.
- Redact provider errors and add an SDK request timeout.
- Add repeat-ingestion real-model diagnostics with raw answers and all provider calls; no model quality claim without live evidence.
- Node.js 20.6+ is now required for the plugin and package. Browser SDK entry remains free of Node filesystem imports.

## 0.1.1

- Make npm installation the primary entry point and refresh English and Chinese onboarding.
- Add a browser walkthrough using real SDK retrieval with explicitly scripted model responses.
- Add an executable live-model chat example with recent-context injection and a seeded conversation.
- Add transparent scripted checks and a real-model comparison harness with raw answers, failures, latency and reported token usage.
- Keep theoretical capacity calculations separate from measured claims.
- Fix fresh-consumer validation on Windows and include runnable examples in the package.
- Add first-use feedback and a small user-testing guide.

The SDK's core retrieval algorithm is unchanged. No real-model performance improvement is claimed by this release.
