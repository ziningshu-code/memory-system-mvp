# Memory System V2

Memory System V2 adds long-term memory to Node.js chat apps.

It saves the user and assistant messages that were actually shown, uses embeddings to find useful older conversations, and returns the original messages as evidence. Your app keeps using its existing chat model.

- Save original messages in a local SQLite file.
- Find older messages and return their text with source IDs.
- Keep users and chat sessions separate using application-supplied IDs.
- Record explicit corrections when information changes.
- Rebuild search data from the saved conversation.

[中文说明](README.zh-CN.md)

## Quick Start

This example saves one flight-time exchange and retrieves the original user message. It calls a real embedding API; it does not call a chat model.

### 1. Install Node.js and Git

Install [Node.js](https://nodejs.org/en/download) **22 or 24**. The current GitHub installation also needs [Git](https://git-scm.com/downloads). Check both:

```sh
node --version
npm --version
git --version
```

### 2. Create a test project

```sh
mkdir memory-v2-demo
cd memory-v2-demo
npm init -y
```

### 3. Install from GitHub

The current `main` branch prepares **memory-system-v2 0.5.0-beta.2**. Install it from source; npm builds the package during installation:

```sh
npm install "git+https://github.com/ziningshu-code/memory-system-mvp.git#main"
```

There is no npm release under the new name yet. The existing [beta.1 release](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.1) keeps its old package name and download unchanged. It is a separate historical snapshot.

### 4. Set up NVIDIA embeddings

Get an API key from the [NVIDIA model page](https://build.nvidia.com/nvidia/nemotron-3-embed-1b). In `memory-v2-demo`, create a file named `.env` and replace the placeholder with your key:

```dotenv
EMBED_API_KEY=your_nvidia_api_key
```

The example uses **`nvidia/nemotron-3-embed-1b`**, which returns **2048** numbers per embedding. The SDK's NVIDIA adapter sets the query/passage request options. Saved messages and recall queries are sent to **`https://integrate.api.nvidia.com/v1/embeddings`**. Embedding requests may have provider costs; no chat API key is needed for this demo. Keep `.env` private and exclude it from version control.

### 5. Save and recall a message

Create `demo.mjs` in the same folder:

```js
import { createMemory } from 'memory-system-v2';

if (!process.env.EMBED_API_KEY) {
  throw new Error('Set EMBED_API_KEY in .env first');
}

const memory = createMemory({
  dbPath: './memory.sqlite',
  embedding: {
    kind: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-embed-1b',
    dimension: 2048,
    apiKey: process.env.EMBED_API_KEY,
  },
});

try {
  const saved = await memory.remember({
    sessionId: 'flight-demo',
    turnId: 'flight-1',
    user: 'My flight leaves at 7:40 tomorrow morning.',
    assistant: 'Understood: your flight leaves at 7:40 tomorrow morning.',
  });
  if (saved.failed.length) throw new Error('Embedding failed; original messages were saved. Check your provider/key and rerun.');

  const recalled = await memory.recall({
    sessionId: 'flight-demo',
    query: 'What time is my flight?',
  });
  if (recalled.trace.error) throw new Error(recalled.trace.error);
  const original = recalled.sources.find(source => source.sourceId === 'flight-1:user');
  if (!original) throw new Error('The flight message was not retrieved');
  console.log('Source:', original.sourceId);
  console.log('Original message:', original.text);
} finally {
  await memory.close();
}
```

Run it, loading the key from `.env`:

```sh
node --env-file=.env demo.mjs
```

The output includes:

```text
Source: flight-1:user
Original message: My flight leaves at 7:40 tomorrow morning.
```

`recall()` returns old conversation evidence. It does **not** generate the final AI answer. The demo's assistant message is fixed example data, not a model response. In your app, save the actual completed response from your chat model:

```text
user message → memory.recall() → relevant old messages
             → your existing chat model → assistant reply → memory.remember()
```

The [chat integration example](examples-product/openai-compatible-chat.mjs) shows the full flow with separate chat and embedding credentials. It uses a standard OpenAI-compatible embedding endpoint; for NVIDIA, replace its embedding configuration with the block above. See [SDK usage](docs/sdk.md) for corrections, recent-message exclusions and error handling.

## Installation after npm publication

The intended command below is **not available yet**. Use the GitHub command above until an npm release is announced:

```sh
npm install memory-system-v2@beta
```

## What it does / what it doesn't

It saves visible conversation locally, retrieves original source text, supports explicit corrections and can rebuild its search data. It makes **zero additional generative memory-model calls**; embedding requests can still consume API tokens.

It does not replace your chat model, generate answers by itself, include a hosted memory service, infer every contradiction or guarantee perfect retrieval. This release is a Node SDK, without a bundled proxy, setup page or browser SDK.

## How it works

```text
Conversation → Saved original messages → Embeddings + LongMemory search state
             → Recall → Original matching messages
```

The saved conversation is the source of truth. Search results point back to those messages. Search data can be rebuilt; it never replaces the original text. Both are stored in one local SQLite file. The demo uses `./memory.sqlite`; the SDK's default remains `~/.memory-system-mvp/memory.sqlite` for compatibility.

Returned evidence is bounded, with source IDs and exact text ranges. The budget uses a token estimate, not your chat model's exact tokenizer. A large message may return only a marked prefix, and recall may return nothing. [SDK details](docs/sdk.md) and [privacy](docs/privacy.md) explain these limits and what leaves your computer.

## Other embedding providers

You can configure an OpenAI-compatible **embeddings** endpoint, local Ollama, or your own embedder. A chat endpoint alone is not enough. Set the actual model and vector dimension; do not reuse the NVIDIA settings for a different model. See [embedding configuration](docs/sdk.md#embedding-configuration) and [.env.example](.env.example). Local embeddings keep text on your computer.

## Validation

Frozen validation set:

- 200 synthetic exchanges and 50 labeled queries.
- 33/35 designated-source hits for Memory System V2, versus 21/35 for the pinned upstream baseline, within five results.
- 400/400 saved messages recovered in both implementations.

This is a small synthetic benchmark and does not show universal superiority over LongMemory. It measures retrieval, not generated-answer accuracy. See the [methodology](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/README.md) and [full results](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/RESULTS.md).

## From V1 to V2

V1 used a Topic Worker → Selector design. Testing exposed extra generative calls, unstable topic boundaries, retrieval misses and growing complexity. V2 keeps the product requirements learned from that work, but replaces its runtime with a modified LongMemory core and a conversation integration layer.

The public [V1 release](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/legacy-v1) points to `33b90322c0747943766c3477ccce10753cb554d7`. Public [V2 beta.1](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.1) points to `d5a8781afe7beba6f45df2d7010a216fe57fd940`. This branch prepares beta.2; it does not change those releases. Read the [project history](docs/project-evolution.md) for details.

## LongMemory credit and licenses

Memory System V2 uses a modified copy of the open-source [LongMemory core](https://github.com/CaviraOSS/LongMemory). LongMemory provides most of the embedding, semantic retrieval and temporal-memory machinery. This project adds conversation storage and the application-facing behavior described above.

The upstream revision is [9ee2c8e](https://github.com/CaviraOSS/LongMemory/tree/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5). See [ATTRIBUTION](ATTRIBUTION.md), [NOTICE](NOTICE), the project's [MIT license](LICENSE) and LongMemory's [Apache-2.0 license](UPSTREAM-LONGMEMORY-LICENSE).

## Development

```sh
npm ci
npm run typecheck
npm test
npm run smoke:consumer
npm pack
```

CI covers Node 22/24 on Windows/Linux. No workflow publishes automatically. [Release notes](docs/release-notes.md).
