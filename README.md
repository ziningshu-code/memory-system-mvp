# Topic Memory

[简体中文](./README.zh-CN.md) · [Detailed integration guide](./docs/USAGE.md)

A standalone TypeScript SDK that adds long-term topic memory to an existing LLM application.

It stores a canonical conversation history, periodically groups older completed exchanges into recoverable topics, selects relevant topics before your next reply, and returns a `memoryContext` string for your own Main LLM.

**Memory LLM** → runs the Topic Worker and Memory Selector.  
**Your Main LLM** → still generates the user-facing reply. The SDK does not own or call it.

## Install

This repository is currently published as source code. Clone it or install from a packed tarball generated with `npm pack`.

```bash
npm install
npm run build
npm pack
```

## Environment

For the included OpenAI-compatible adapter:

```bash
MEMORY_LLM_BASE_URL=https://your-openai-compatible-endpoint.example/v1
MEMORY_LLM_API_KEY=replace-me
MEMORY_LLM_MODEL=your-memory-model
```

Do not place a paid provider key in a public browser bundle. Use a backend or trusted proxy when needed.

## 5-minute Quick Start

```ts
import {
  createMemory,
  createOpenAICompatibleMemoryLlm,
  InMemoryStorage,
} from 'topic-memory';

const memoryLlm = createOpenAICompatibleMemoryLlm({
  baseUrl: process.env.MEMORY_LLM_BASE_URL!,
  apiKey: process.env.MEMORY_LLM_API_KEY,
  model: process.env.MEMORY_LLM_MODEL!,
});

const memory = createMemory({
  storage: new InMemoryStorage(),
  llm: memoryLlm,
});

const pending = await memory.begin(userMessage);
const retrieved = await memory.retrieve({ userMessage });

// Replace this with your existing Main LLM call.
const assistantReply = await myOwnMainLlm({
  userMessage,
  memoryContext: retrieved.memoryContext,
});

await memory.completeExchange({
  exchangeId: pending.id,
  assistantText: assistantReply,
});

await memory.maybeRunTopicWorker();
```

For a complete existing-app integration pattern, failure handling, persistence choices, and prompt injection examples, see [docs/USAGE.md](./docs/USAGE.md).

## Integration timing

```text
User message
→ memory.begin()
→ memory.retrieve()
→ Your Main LLM
→ memory.completeExchange()
→ memory.maybeRunTopicWorker()
```

If your Main LLM request fails, call `memory.failExchange(...)` instead of `completeExchange(...)`.

## Six-exchange behavior

Topic Worker does not run until at least **6 completed exchanges** exist. Before that:

- `recentContext` is still available.
- `memoryContext` may be empty.
- This is expected behavior, not an installation failure.

## How it works

The v0.1 pipeline is based on the stable Memory MVP behavior extracted from the original application baseline `desktop-tutorial@a70d767`:

1. **Canonical Transcript** stores pending, completed, and failed exchanges as the source of truth.
2. **Recent Context** uses the latest 5 completed live exchanges.
3. **Topic Worker** runs after the 6-completed-exchange gate, validates strict JSON, preserves finalized topics, and only reprocesses the active tail after the latest finalized span.
4. **Topic Directory** exposes lightweight topic metadata to the selector.
5. **Memory Selector** chooses at most 3 topic IDs and decides whether time metadata is needed.
6. **Opened Topic Packets** restore exact transcript spans from Canonical Transcript.
7. **`memoryContext`** is returned to your host application for optional injection into your Main LLM prompt.

Selector failure safely degrades to empty long-term memory and does not block your Main LLM.

## Public API

```ts
createMemory
MemoryEngine
InMemoryStorage
IndexedDbMemoryStorage
createOpenAICompatibleMemoryLlm
```

Main engine methods:

```ts
begin
beginExchange
completeExchange
failExchange
maybeRunTopicWorker
retrieve
listExchanges
listTopics
getLatestTopicWorkerRun
clear
```

`retrieve()` returns:

```ts
{
  recentContext,
  topicDirectory,
  selectedTopicIds,
  openedTopicPackets,
  memoryContext,
  needsTimeMetadata,
  trace,
}
```

## Provider

`createOpenAICompatibleMemoryLlm()` calls:

```text
<baseUrl>/chat/completions
```

It sends `model`, system/user messages, `temperature`, `top_p`, and `max_tokens`, and reads `choices[0].message.content`.

This describes protocol compatibility only. It is not a claim of official certification by any specific provider.

## Storage

Use `InMemoryStorage` for Node examples and tests.

Use `IndexedDbMemoryStorage` in browser environments:

```ts
const memory = createMemory({
  storage: new IndexedDbMemoryStorage(),
  llm: memoryLlm,
});
```

You can implement the exported `MemoryStorage` interface for another persistence layer.

## Advanced configuration

Use separate models for Topic Worker and Selector:

```ts
const memory = createMemory({
  storage,
  topicWorker,
  selector,
});
```

For normal use, `createMemory({ storage, llm })` reuses one Memory LLM for both roles.

## Failure handling

- Main LLM failure: call `failExchange`.
- Topic Worker provider/parse failure: recorded in the latest worker run; existing topics are not replaced.
- Topic Worker validation rejection: invalid topics are rejected.
- Selector failure: `memoryContext` becomes empty and retrieval returns a trace error.

## Troubleshooting

**Topic Worker does not run**  
Confirm there are at least 6 completed exchanges in the active tail.

**`memoryContext` is empty**  
This is valid when no topic exists, the selector decides memory is unnecessary, or selector retrieval fails.

**Browser storage fails**  
Use `IndexedDbMemoryStorage` only where IndexedDB is available, or inject a custom `MemoryStorage`.

## Security

Keep provider credentials outside public client bundles. The SDK accepts custom headers and an OpenAI-compatible endpoint, so a backend/proxy can own secrets.

## Non-goals

v0.1 does not manage your Main LLM, persona, Big Five traits, relationship state, proactive messaging, UI, vector databases, embeddings, or semantic vector search.

## Validation

The release branch includes automated coverage for one-model and split-model configuration, provider success/failure cases, canonical lifecycle, 6-exchange gate, finalized active-tail behavior, selector fallback, time metadata, InMemory/IndexedDB contracts, and a host-owned Main LLM end-to-end path.

```bash
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

The GitHub Actions workflow runs the same checks on pushes to `main` and `release/**`, and on pull requests targeting `main`. `smoke:consumer` installs the packed tarball into a fresh temporary Node project and verifies public-package imports plus end-to-end delivery of non-empty `memoryContext` to a simulated host Main LLM.

## License

MIT
