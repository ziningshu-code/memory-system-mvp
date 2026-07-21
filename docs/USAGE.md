# Integration Guide

[简体中文](./USAGE.zh-CN.md) · [Architecture & capacity notes](./ARCHITECTURE.md)

This is the practical guide for wiring Topic Memory into an existing chat app or agent.

The integration model is deliberately narrow:

> **Your app already knows how to call a Main LLM. Topic Memory runs beside that call, restores relevant older context, and hands the result back to you.**

You do not need to rewrite your chat stack around the SDK.

## 1. Know the three roles

### Topic Worker

A background memory-organizing job. It groups completed exchanges into topic instances and stores topic metadata plus exact transcript spans.

### Memory Selector

A retrieval job. Before a new reply, it looks at the current message, the latest five completed exchanges, and the Topic Directory. It may select up to three older topics to reopen.

### Your Main LLM

The model that writes the actual user-facing reply.

In the default v0.1 setup, **one Memory LLM handles both Topic Worker and Memory Selector**:

```ts
createMemory({ storage, llm: memoryLlm })
```

That Memory LLM is not your Main LLM. The SDK never calls your Main LLM for you.

## 2. Create the memory engine

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
```

`InMemoryStorage` is good for tests and demos. It resets when the process exits.

For browser persistence, use `IndexedDbMemoryStorage`. For a production backend, implement the exported `MemoryStorage` interface and connect your own database.

## 3. Wrap one normal chat turn

The required order is:

```text
User sends message
        │
        ▼
memory.begin()
        │
        ▼
memory.retrieve()
        │
        ▼
YOUR Main LLM
        │
        ▼
memory.completeExchange()
        │
        ▼
memory.maybeRunTopicWorker()
```

A complete example:

```ts
async function handleUserMessage(userMessage: string) {
  const pending = await memory.begin(userMessage);

  try {
    const retrieved = await memory.retrieve({ userMessage });

    const assistantReply = await myOwnMainLlm({
      userMessage,
      memoryContext: retrieved.memoryContext,
      recentContext: retrieved.recentContext,
    });

    await memory.completeExchange({
      exchangeId: pending.id,
      assistantText: assistantReply,
    });

    await memory.maybeRunTopicWorker();

    return assistantReply;
  } catch (error) {
    await memory.failExchange({
      exchangeId: pending.id,
      failureReason: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
```

`myOwnMainLlm()` is a placeholder for the model call your application already has. Topic Memory never calls it internally.

## 4. Put memory into your Main LLM prompt

`retrieve()` gives you two useful layers:

- `recentContext` — latest five completed exchanges;
- `memoryContext` — older topic memory restored only when relevant.

```ts
const retrieved = await memory.retrieve({ userMessage });
```

The full result includes:

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

A common integration pattern is:

```ts
const assistantReply = await myOwnMainLlm({
  messages: [
    {
      role: 'system',
      content: [
        baseSystemPrompt,
        retrieved.memoryContext,
      ].filter(Boolean).join('\n\n'),
    },
    {
      role: 'user',
      content: userMessage,
    },
  ],
});
```

An empty `memoryContext` is valid. It means there is no relevant older topic, no topic exists yet, or retrieval safely degraded after a selector failure.

## 5. What happens behind the API

### `memory.begin(userMessage)`

Creates a pending Canonical Exchange before the Main LLM call starts.

### `memory.retrieve({ userMessage })`

Builds the latest five-exchange recent context, exposes the Topic Directory to the Memory Selector, reopens selected historical topic spans, and returns `memoryContext`.

### Your Main LLM

Receives current input plus whatever memory fields you choose to inject.

### `memory.completeExchange(...)`

Marks the turn as completed and stores the final assistant reply as canonical history.

### `memory.maybeRunTopicWorker()`

Asks the SDK whether enough completed active-tail history exists to reorganize topics. You can call it after every successful turn; the SDK enforces its own gate.

## 6. The first six completed exchanges

Topic Worker does not run before at least six completed exchanges exist.

Before that point:

- Canonical Transcript is still recorded;
- `recentContext` still works;
- `memoryContext` may be empty because the long-term Topic Store has not been created yet.

This is normal startup behavior.

## 7. If the Main LLM fails

If `begin()` succeeded but your Main LLM request fails, do not leave the exchange pending forever.

```ts
await memory.failExchange({
  exchangeId: pending.id,
  failureReason: 'provider_timeout',
});
```

Failed exchanges remain part of the canonical lifecycle but are not treated as completed conversational evidence by Topic Worker.

## 8. One Memory LLM or two

Most apps can use one Memory LLM for both memory jobs:

```ts
const memory = createMemory({
  storage,
  llm: memoryLlm,
});
```

For advanced deployments, split the roles:

```ts
const memory = createMemory({
  storage,
  topicWorker: topicWorkerLlm,
  selector: selectorLlm,
});
```

Both implement the exported `MemoryLlm` interface.

The split can be useful if, for example, you want a stronger model for topic organization and a cheaper low-latency model for selection.

Neither configuration changes ownership of the host Main LLM.

## 9. Storage choices

### In-memory

```ts
new InMemoryStorage()
```

Use for local demos and tests. Data disappears when the process exits.

### Browser IndexedDB

```ts
new IndexedDbMemoryStorage()
```

Use in environments with IndexedDB support.

### Your own backend database

Implement `MemoryStorage` to connect PostgreSQL, SQLite, Redis, a KV store, or another persistence layer.

For real multi-user products, create or scope one memory store per conversation / user / agent identity according to your own tenancy model.

## 10. Inspect and debug memory

```ts
const exchanges = await memory.listExchanges();
const topics = await memory.listTopics();
const latestWorkerRun = await memory.getLatestTopicWorkerRun();
```

These methods are useful for internal admin tools, debugging, and understanding why a topic was or was not retrieved.

`retrieve().trace` also exposes selector diagnostics.

## 11. Failure behavior

The memory layer is designed to fail soft instead of taking down the host chat path.

- **Topic Worker provider failure:** recorded; existing topics remain.
- **Topic Worker invalid JSON / validation rejection:** rejected; invalid topics are not persisted.
- **Memory Selector failure:** long-term `memoryContext` becomes empty.
- **No relevant older topic:** `memoryContext` is empty by design.

Your host application decides whether to log, retry, alert, or simply continue without long-term memory.

## 12. Recommended production layout

```text
Client
  │
  ▼
Your backend
  ├── Topic Memory SDK
  │     ├── Memory Storage
  │     └── Memory LLM
  │           ├── Topic Worker role
  │           └── Memory Selector role
  │
  └── Your Main LLM
        └── user-facing reply
```

Keep paid provider secrets on a trusted backend or proxy.

## 13. Scaling expectations

Topic Memory does not enlarge a model context window. It reduces the need to replay all historical text on every request.

The v0.1 architecture stores the full Canonical Transcript externally, keeps a lightweight Topic Directory, and reopens at most three historical topics per retrieval.

For a worked example showing how a raw-history ~600-exchange prompt can correspond to a selectively retrievable ~5,000-exchange archive under explicit assumptions, see [Architecture & capacity notes](./ARCHITECTURE.md).

That example is a theoretical capacity calculation, not a hard product limit or benchmark claim.

## 14. Validate the package

```bash
npm install
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

`smoke:consumer` packs the SDK, installs the tarball into a fresh temporary Node project, imports only public package exports, runs the memory pipeline, and verifies that a simulated host-owned Main LLM receives a non-empty `memoryContext`.
