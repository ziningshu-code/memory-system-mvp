# Topic Memory

**A drop-in long-term memory layer for LLM apps.**

[简体中文](./README.zh-CN.md) · [Integration guide](./docs/USAGE.md) · [Architecture & capacity notes](./docs/ARCHITECTURE.md)

Topic Memory gives an existing chat app or agent a structured way to remember old conversations without sending the entire transcript to the model on every request.

It keeps the full conversation as the source of truth, organizes older exchanges into topic-based memory, retrieves only the topics that matter for the current message, and returns a ready-to-inject `memoryContext` for your own Main LLM.

> **What it is:** a memory plugin/SDK for an LLM application.  
> **What it is not:** a chatbot, a model provider, or a replacement for your Main LLM.

## What can it do?

Topic Memory is useful when your AI needs to remember things that happened far earlier in a conversation, for example:

- user preferences, recurring habits, names, places, and personal context;
- decisions made hundreds or thousands of exchanges ago;
- project history, requirements, previous attempts, and unresolved tasks;
- earlier events where the exact wording or timing may matter;
- long-running conversations where replaying the full transcript would become expensive or exceed the model context window.

Unlike a single rolling summary, Topic Memory keeps the canonical transcript. A retrieved topic can therefore reopen the original exchanges behind that topic instead of relying only on a compressed summary.

## The model roles — important

There are two layers, and they should not be confused:

### Memory LLM

The **Memory LLM** powers the memory system itself.

By default, the same Memory LLM instance performs two jobs:

1. **Topic Worker** — organizes completed conversation exchanges into topic instances and writes a lightweight topic index.
2. **Memory Selector** — reads the current user message, recent context, and Topic Directory, then chooses up to three older topics to reopen.

You may configure separate models for these two jobs, but most integrations can use one Memory LLM for both.

### Your Main LLM

Your **Main LLM** is still your own user-facing chat model.

Topic Memory never generates the final reply and never takes ownership of your Main LLM. It returns `memoryContext`; your application decides how to inject that context into the Main LLM prompt.

```text
User message
    │
    ├─→ Topic Memory retrieves relevant old context
    │       ├─ Recent 5 completed exchanges
    │       ├─ Topic Directory
    │       └─ Opened Topic Packets
    │
    └─→ Your Main LLM receives memoryContext and writes the reply
```

## How it works

The v0.1 pipeline is intentionally simple:

1. **Canonical Transcript**  
   Every exchange is stored as `pending`, `completed`, or `failed`. The full transcript remains the source of truth.

2. **Topic Worker**  
   After at least six completed exchanges exist, the Topic Worker processes the active tail of the conversation. It groups related exchanges into topic instances and stores:
   - topic keywords;
   - retrieval terms;
   - exact transcript spans;
   - topic status and timing metadata.

3. **Topic Directory**  
   The SDK builds a compact index of available topics. The Main LLM does not need the entire historical transcript just to decide what to remember.

4. **Memory Selector**  
   Before a new reply, the selector sees the current message, the latest five completed exchanges, and the Topic Directory. It selects at most three relevant topic IDs.

5. **Opened Topic Packets**  
   Selected topics are reopened from their exact Canonical Transcript spans. When timing matters, exchange timestamps can be included.

6. **Main LLM**  
   Topic Memory returns the restored material as `memoryContext`. Your own Main LLM uses it only when relevant to the current message.

```text
Canonical Transcript
        │
        ▼
   Topic Worker
        │
        ▼
   Topic Store ─────→ Topic Directory
                         │
Current message ─────────┤
Recent 5 exchanges ──────┤
                         ▼
                  Memory Selector
                         │
                  up to 3 topic IDs
                         │
                         ▼
                 Open Topic Packets
                         │
                         ▼
                    memoryContext
                         │
                         ▼
                  Your Main LLM
```

Selector failure safely degrades to an empty long-term `memoryContext`; it does not have to block the host chat flow.

## Why not just keep appending the entire transcript?

A large context window is still a finite prompt budget, and long-context models do not always use information uniformly well across very long inputs. Topic Memory instead separates **how much history you store** from **how much history you send on one request**.

Under one illustrative 128k-context workload, a raw-history design with about 200 tokens per completed exchange reaches roughly 600 exchanges when ~120k tokens are reserved for conversation history. With Topic Memory, a 5,000-exchange archive grouped at roughly eight exchanges per topic can be represented by a Topic Directory plus at most three reopened topics in roughly 43k–45k memory-related tokens under the assumptions documented in the appendix.

That is approximately **8.3× more represented conversation history** in this example, while sending substantially less historical text per request than replaying all 5,000 exchanges.

**This is a theoretical sizing example, not a guaranteed hard limit or benchmark result.** Actual capacity depends on message length, tokenization, topic size, model context window, and how many topics accumulate. v0.1's main scaling constraint is that the Topic Directory grows with the number of topics.

See [Architecture & capacity notes](./docs/ARCHITECTURE.md) for the formula, assumptions, caveats, and related research.

## Install

This repository is currently distributed as source code. Clone it directly or build a tarball with `npm pack`.

```bash
npm install
npm run build
npm pack
```

## Configure a Memory LLM

The built-in adapter uses an OpenAI-compatible `/chat/completions` endpoint:

```bash
MEMORY_LLM_BASE_URL=https://your-openai-compatible-endpoint.example/v1
MEMORY_LLM_API_KEY=replace-me
MEMORY_LLM_MODEL=your-memory-model
```

Keep paid provider credentials on a trusted backend or proxy. Do not ship them inside a public browser bundle.

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

async function handleUserMessage(userMessage: string) {
  const pending = await memory.begin(userMessage);

  try {
    const retrieved = await memory.retrieve({ userMessage });

    // This is YOUR existing user-facing model call.
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

The SDK does **not** call `myOwnMainLlm`; that function represents the Main LLM integration your application already has.

For a complete integration walkthrough, see [docs/USAGE.md](./docs/USAGE.md).

## Integration timing

```text
User message
→ memory.begin()
→ memory.retrieve()
→ Your Main LLM
→ memory.completeExchange()
→ memory.maybeRunTopicWorker()
```

If the Main LLM request fails after `begin()`, call `memory.failExchange(...)`.

## The first six completed exchanges

Topic Worker does not run until at least **6 completed exchanges** exist. Before then:

- Canonical Transcript is still recorded;
- `recentContext` still returns recent completed history;
- `memoryContext` may be empty because no topic has been created yet.

This is expected behavior.

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

## Storage

For demos and tests:

```ts
new InMemoryStorage()
```

For browser persistence:

```ts
new IndexedDbMemoryStorage()
```

For production backends, implement the exported `MemoryStorage` interface and connect your own database.

## Advanced configuration

Default: one Memory LLM handles Topic Worker and Selector.

```ts
createMemory({ storage, llm: memoryLlm })
```

Advanced: split the two memory jobs.

```ts
createMemory({
  storage,
  topicWorker: topicWorkerLlm,
  selector: selectorLlm,
});
```

Again, neither configuration replaces your Main LLM.

## Failure behavior

- **Main LLM fails:** call `failExchange`.
- **Topic Worker provider fails:** the failure is recorded and existing topics remain.
- **Topic Worker returns invalid structure:** the output is rejected and not written to Topic Store.
- **Selector fails:** long-term `memoryContext` falls back to empty.
- **No older topic is relevant:** `memoryContext` is empty by design.

## Validation

The repository CI validates the package as an actual consumer would use it:

```bash
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

`smoke:consumer` packs the SDK, installs the tarball into a fresh temporary Node project, imports only public package exports, runs the memory pipeline, and verifies that a simulated host-owned Main LLM receives a non-empty `memoryContext`.

## Non-goals

v0.1 does not manage persona, Big Five traits, relationship state, proactive messaging, UI, embeddings, vector databases, or the host application's Main LLM.

## License

MIT
