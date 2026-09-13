# Topic Memory

**Find the topic. Reopen the original conversation.**

[简体中文](./README.zh-CN.md) · [Integration guide](./docs/USAGE.md) · [Evaluation](./docs/EVALUATION.md) · [Architecture](./docs/ARCHITECTURE.md)

Topic Memory is a TypeScript SDK for chat apps and agents that need older conversation details. It groups history into topics, selects relevant topics for a new question, and returns the original exchanges as `memoryContext` for your existing model.

For example, a user chooses **Ueno, 14,000 yen per night** for a Tokyo hotel. After the conversation moves on to food, a project release and astronomy, the SDK can reopen the hotel discussion when that plan becomes relevant again. The source text stays available for inspection.

## Install

```bash
npm install topic-memory
```

ES modules; SDK requires Node.js 18+. The live example commands below require **Node.js 20.6+** for `--env-file`. The published `topic-memory@0.1.0` was installed and exercised in a fresh Node 24 project on 2026-09-13.

## Try the walkthrough — no API key

```bash
git clone https://github.com/ziningshu-code/memory-system-mvp.git
cd memory-system-mvp
npm ci
npm run demo
```

The demo loads **24 synthetic exchanges**, retrieves the old hotel topic, and prints the exact restored conversation. It uses the real SDK with **scripted worker and selector responses**. This is a mechanics demo, not evidence of real-model retrieval quality.

To open the interactive, English/Chinese browser version:

```bash
npm run build:site
npm run preview
```

Visit `http://127.0.0.1:4173`. Switch between hotel, food, project and missing-information questions; inspect the topic selection and original source text. Everything in this walkthrough runs locally in the browser, with no credentials or model requests.

## Quick start

Your application supplies a memory model and keeps its existing user-facing model. Pass **both** recent conversation and retrieved older evidence to that model:

```ts
import { createMemory, createOpenAICompatibleMemoryLlm, InMemoryStorage } from 'topic-memory';

const memory = createMemory({
  storage: new InMemoryStorage(),
  llm: createOpenAICompatibleMemoryLlm({
    baseUrl: process.env.MEMORY_LLM_BASE_URL!,
    apiKey: process.env.MEMORY_LLM_API_KEY,
    model: process.env.MEMORY_LLM_MODEL!,
  }),
});

const pending = await memory.begin(userMessage);
const context = await memory.retrieve({ userMessage });

// Call your existing model with current input, context.recentContext,
// and context.memoryContext. The complete runnable integration is linked below.
const assistantReply = await yourMainModel(userMessage, context);
await memory.completeExchange({ exchangeId: pending.id, assistantText: assistantReply });
await memory.maybeRunTopicWorker();
```

`yourMainModel` is application-owned. For a **complete executable integration**, use [examples/chat.mjs](./examples/chat.mjs) and its [provider helper](./examples/provider.mjs); they include the actual model request, recent-context injection, errors, and the pending/completed/failed lifecycle.

## Try it with a real model

In the cloned repository, copy `.env.example` to `.env` and set your OpenAI-compatible endpoint, model and API key. Keep this file local. The examples send your input to that provider and may use paid credits.

```bash
npm run demo:chat
```

Or preload the public synthetic conversation, then ask about the hotel plan:

```bash
npm run demo:chat -- --seed
```

The seeded conversation is synthetic; topic organization, selection and final answers use the **real configured model**. Type `/exit` to leave. Example storage is in-memory and resets when the process exits.

## What is verified?

| Check | Status / meaning |
| --- | --- |
| Published npm package | Fresh installation and old-text recovery checked on Node 24 |
| SDK lifecycle, storage, adapter and retrieval tests | Automated checks in CI |
| Four scripted walkthrough cases | Old-text recovery and empty memory for a missing fact; [recorded output](./docs/evaluation/scripted.json) |
| Real-model comparison | Runnable harness provided; **no real-model performance result claimed** |

Run `npm run evaluate` for the scripted checks or `npm run evaluate:live` for a small, real-model comparison of **recent five exchanges**, **full transcript**, and **topic retrieval**. The live report includes raw answers, literal fact-check scores, request latency, and provider token counts when available. [Read the method and limitations](./docs/EVALUATION.md).

The earlier **8.3×** figure is an illustrative capacity calculation, **not a measured improvement in accuracy or usable memory**. Its assumptions remain in [Architecture & capacity notes](./docs/ARCHITECTURE.md).

## How it works

```text
Saved conversation → Topic Worker → Topic directory
New question + recent conversation + directory → Selector
Selected topic IDs → Original transcript spans → Your model
```

One memory LLM can handle both worker and selector; separate models are also supported. Topic Memory does not generate the final answer or replace your main model. It requires no embeddings or vector database.

## Current boundaries

- Topic creation starts after **six completed exchanges**. Before that, recent context still works and long-term memory can be empty.
- The selector opens **up to three topics**. Selection can miss evidence; inspect `retrieve().trace`.
- A selector error falls back to empty long-term memory. Your app must still handle request timeouts and storage failures.
- `InMemoryStorage` is temporary. `IndexedDbMemoryStorage` persists in a browser. Backend persistence and user/conversation isolation require your own `MemoryStorage` implementation.
- Serialize turns and worker runs for a given memory store; concurrent writers are not coordinated by the SDK.
- The full topic directory grows with the archive. v0.1 does not enforce a total token budget.
- Treat historical text as untrusted evidence, not system instructions.

[Integration guide](./docs/USAGE.md) · [Public API and architecture](./docs/ARCHITECTURE.md)

## Development checks

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run smoke:consumer
npm run evaluate
npm run build:site
```

## Help test it

Try one real conversation from your own development workflow, then [report what happened](https://github.com/ziningshu-code/memory-system-mvp/issues/new?template=try-it.yml): what you asked it to remember, whether you could install it, and the first point where retrieval helped or failed. Remove credentials and private conversation details from public reports.

## License

MIT
