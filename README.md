# Memory System MVP — Generation 2

A local Node.js conversation-memory SDK **built on and extending a modified [LongMemory core](https://github.com/CaviraOSS/LongMemory/tree/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5)**. It preserves exact user/assistant exchanges, finds relevant older sources, and returns their original wording with source IDs. Your application continues to use its own chat model.

Generation 2 adds transcript-first persistence, explicit corrections, grounded recall, rebuildable indexes and a small application-facing API. It makes **zero additional generative memory-model calls**. A real embedding provider is required; external embedding requests can consume tokens and send conversation text to that provider.

## Install and start

Node.js **22 or 24**, with a working `better-sqlite3` native binary/build toolchain. This release is prepared locally and **has not been published**. Install the prepared artifact:

```sh
npm install ./memory-system-mvp-0.5.0-beta.1.tgz
```

After npm publication, installation will be `npm install memory-system-mvp@0.5.0-beta.1`.

```js
import { createMemory } from 'memory-system-mvp';

const memory = createMemory({
  embedding: {
    kind: 'openai',
    baseUrl: 'https://your-embedding-provider.example/v1',
    model: 'your-embedding-model',
    apiKey: process.env.EMBED_API_KEY,
    dimension: 1024, // the actual dimension of your model
  },
});

await memory.remember({
  sessionId: 'my-chat', turnId: 'turn-1',
  user: 'My appointment is on Tuesday at 09:15.',
  assistant: 'Understood: Tuesday at 09:15.',
});
const recalled = await memory.recall({ sessionId: 'my-chat', query: 'When is my appointment?' });
console.log(recalled.context); // exact historical evidence, not a generated answer
await memory.close();
```

For a full chat request, use the [generic OpenAI-compatible example](examples-product/openai-compatible-chat.mjs). Configure independent chat and embedding endpoints using [.env.example](.env.example), then run `node --env-file=.env examples-product/openai-compatible-chat.mjs "When is my appointment?"` from a built checkout. The example stores only visible speech and continues the chat when memory fails. No private application code is needed.

## How it works

```text
Visible conversation
  → authoritative exact transcript
  → LongMemory-derived nodes / embeddings / temporal state
  → semantic recall
  → source resolution
  → exact grounded evidence within a budget
```

Exact conversation is authoritative. Embeddings, nodes and relationships are derived search state and can be rebuilt. Both live in a local SQLite database, by default `~/.memory-system-mvp/memory.sqlite`. The SDK does not use a hosted memory backend.

The public surface is `createMemory`, `remember`, `recall`, `history`, `rebuild`, `erase`, and `close`. `recall` exposes ranked/rejected/omitted candidates and exact source ranges. Hosts can pass recent `excludeTurnIds` to avoid duplicate evidence. Evidence is bounded using LongMemory's multilingual token estimate, **not the Main LLM's exact tokenizer**. Oversized sources yield marked exact prefix excerpts, which may omit a relevant detail near the end.

Use `supersedesSourceId` for an explicit replacement of an older completed turn. The SDK does not infer arbitrary contradictions. `asOf` queries inspect remaining history at a recorded time. `erase` logically removes the whole paired turn and repairs correction chains; it is not forensic removal from SQLite pages or backups. See [SDK usage](docs/sdk.md) and [privacy](docs/privacy.md).

## Project evolution

**Generation 1** was an independently designed topic-oriented conversational memory system: a Topic Worker produced short topic indexes, a Selector picked candidates, and selected topics expanded back to original conversation. Later lexical/vector/proxy experiments exposed cost, boundary, reliability and integration limitations.

**Generation 2** evolved from those requirements and lessons, but its runtime was rebuilt using a modified LongMemory core. It is **not the V1 runtime with LongMemory underneath**. The project-specific work is exact transcript persistence, conversation/source modeling, explicit corrections, recovery and application integration.

The genuine V1 snapshot is preserved at local tag `legacy-v1` (pending tag publication), commit `f0c1991e443a8c1870c9e8c5a72166c6108c44a4`. [Generation 1 history](docs/generation-1.md) and [project evolution](docs/project-evolution.md) explain the distinction. Obsolete runtime code is excluded from this generation's package.

## Validation

The [final frozen validation](https://github.com/ziningshu-code/memory-system-mvp/tree/main/benchmarks-product/blind) uses 200 authored synthetic exchanges, 400 messages, eight owner/session scopes and 50 labeled queries. Each scope contains 25 exchanges. Real NVIDIA embeddings and configuration were frozen before evaluation, with no tuning after results.

On the same 35 ranked positive queries, exact user-source recall within five results was **33/35 for this product and 21/35 for pinned upstream**. Both preserved all 400 original messages and had zero observed scope leakage. The product abstained on all four no-memory queries; upstream returned irrelevant, in-scope neighbors. The product passed 48/50 total checks, including lifecycle tests; its two misses were Chinese-history/English-query retrieval. These totals are **not Main LLM answer accuracy**, proof of 200-turn recall in one session, or a general superiority claim. Native grounding defaults and correction hints differ between the APIs. See [category results and raw data](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/RESULTS.md). These repository links become available when this local release is published.

The [earlier 50-turn comparison](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/REAL-RESULTS.md) is a calibration record. Its improved threshold was evaluated on the same data and is not a blind result. Deterministic SDK and integration tests use explicitly supplied test embeddings; these check behavior, not real semantic quality.

## Upstream relationship and limitations

`src/product/` is the project's conversational integration layer. `src/longmemory/` includes modified and unmodified LongMemory source pinned to `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`. See [attribution](ATTRIBUTION.md), [notices](NOTICE) and the [upstream Apache-2.0 license](UPSTREAM-LONGMEMORY-LICENSE). Mem0 was evaluated but is not included in the runtime.

This beta is a **Node SDK**, with no bundled transparent proxy, browser SDK or setup page. Search remains local and linear in session size. Recall can miss sources or admit distractors, and thresholds are model/data dependent. Embeddings are required; a chat-compatible endpoint may not support them. Rebuilds can re-embed sources and incur provider cost. Use stable tenant/owner/session/turn IDs; isolation is application scoping, not an authentication system. Applications must handle their own Main LLM calls and retain valid chat responses when memory fails.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run smoke:consumer
npm pack
```

CI is configured for Node 22/24 on Windows/Linux; local validation does not substitute for future CI results. No workflow publishes automatically. Release notes are in [docs/release-notes.md](docs/release-notes.md). [中文说明](README.zh-CN.md).
