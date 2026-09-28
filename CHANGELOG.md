# Changelog

## 0.3.0 — experimental

- Add `createTopicMemory`: immutable originals, batched new-record indexing, short directory selection only when requested, and exact evidence paging.
- Group immutable segments into short Topic Family indexes. Find candidates using local keywords and optional cached card vectors; use bounded recency/frequency/length ranking. Long selected families can open at a matching middle original or return bounded first/latest comparison windows, without losing full archive paging. Large redundant span lists are omitted from evidence pages. Legacy custom workers can retain the segment-only protocol.
- Resolve family links with exact source excerpts and conflict checks; allow optional one-hop retrieval of related families within the existing selection budget. These checks do not certify the model's semantic choices.
- Add opt-in JSON output constraints and lossless folding of extra short keyword labels. Preserve failed model outputs; program validation remains required.
- Add Codex capture hooks, MCP search/open tools, a local installer, and a Claude Code adapter. Claude Code is not live-validated.
- Change the default command from the 0.2 setup website to native configuration/status commands. Exclude the old gateway and demo examples from the package; preserve the old SDK API.
- Handle transient Windows file locks and resolve installed Codex MCP paths automatically.
- Record a small real-model comparison. Both topic retrieval and simple keyword search answered 6/6 historical questions; all-stage token use was higher for topic retrieval. No savings or broad compatibility claim.
- Keep package publication manually triggered; a source merge does not automatically publish to npm.

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
