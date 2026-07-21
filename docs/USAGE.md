# Integration Guide

[简体中文](./USAGE.zh-CN.md)

This guide shows how to connect Topic Memory to an existing chat or agent application without giving the SDK control of your Main LLM.

## 1. Roles

Topic Memory uses two distinct model roles:

- **Memory LLM**: runs the Topic Worker and Memory Selector.
- **Your Main LLM**: generates the final reply shown to the user.

For normal setups, one Memory LLM can handle both Topic Worker and Selector work.

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

For browser persistence, replace `InMemoryStorage` with `IndexedDbMemoryStorage`.

## 3. Wrap one normal chat turn

The required sequence is:

```text
User message
→ begin
→ retrieve
→ Your Main LLM
→ completeExchange
→ maybeRunTopicWorker
```

Example:

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

The SDK never calls `myOwnMainLlm`. That function represents your existing model integration.

## 4. Inject memory into your Main LLM

`retrieve()` returns both short recent context and restored older topic memory.

```ts
const retrieved = await memory.retrieve({ userMessage });
```

Important fields:

```ts
retrieved.recentContext
retrieved.memoryContext
retrieved.selectedTopicIds
retrieved.openedTopicPackets
retrieved.needsTimeMetadata
retrieved.trace
```

A common prompt integration is:

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

`memoryContext` may legitimately be empty. Do not treat an empty value as an error.

## 5. The first six completed exchanges

Topic Worker does not run before at least six completed exchanges exist.

Before that point:

- Canonical Transcript is still stored.
- `recentContext` still works.
- `memoryContext` may be empty because no topic has been created yet.

Run `maybeRunTopicWorker()` after successful completed turns. The method itself enforces the gate.

## 6. Failed Main LLM calls

If your Main LLM fails after `begin()`, mark the pending exchange as failed:

```ts
await memory.failExchange({
  exchangeId: pending.id,
  failureReason: 'provider_timeout',
});
```

Failed exchanges are not treated as completed conversational evidence by Topic Worker.

## 7. One Memory LLM or two

Default:

```ts
const memory = createMemory({
  storage,
  llm: memoryLlm,
});
```

Advanced split configuration:

```ts
const memory = createMemory({
  storage,
  topicWorker: topicWorkerLlm,
  selector: selectorLlm,
});
```

Both objects implement the same exported `MemoryLlm` interface.

## 8. Persistence choices

### Node or tests

```ts
new InMemoryStorage()
```

This is process-local and resets when the process exits.

### Browser

```ts
new IndexedDbMemoryStorage()
```

Use this only in environments where IndexedDB exists.

### Custom database

Implement the exported `MemoryStorage` interface to connect PostgreSQL, SQLite, Redis, a server-side KV store, or another persistence layer.

## 9. Inspecting memory state

```ts
const exchanges = await memory.listExchanges();
const topics = await memory.listTopics();
const latestWorkerRun = await memory.getLatestTopicWorkerRun();
```

These methods are useful for admin/debug tooling.

## 10. Failure behavior

Topic Memory is designed to keep memory failures from blocking the host chat flow:

- Topic Worker provider failure: the failure is recorded; existing topics remain.
- Topic Worker validation rejection: invalid topic output is not stored.
- Selector failure: long-term `memoryContext` becomes empty.
- No relevant topic: `memoryContext` is empty.

Your application decides whether to continue, retry, log, or surface errors.

## 11. Recommended production pattern

A typical production architecture is:

```text
Client
  ↓
Your backend
  ├─ Topic Memory SDK
  │    └─ Memory LLM provider
  └─ Your Main LLM provider
```

Keep paid provider credentials on a trusted backend or proxy rather than in a public browser bundle.

## 12. Validation commands

Repository validation:

```bash
npm install
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

`smoke:consumer` packs the SDK, installs that tarball into a fresh temporary Node project, imports only the public package exports, runs six completed exchanges, creates topic memory, retrieves a non-empty `memoryContext`, and verifies that a simulated host Main LLM receives it.
