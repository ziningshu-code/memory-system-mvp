# Memory System V2

Long-term memory for Node.js chat applications, built on [LongMemory](https://github.com/CaviraOSS/LongMemory).

Configure memory once, then replace your application's chat call. The SDK retrieves relevant older messages, includes bounded original text in the model request, and saves the completed reply. Your existing chat model and response format stay the same.

[Download SDK](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz) · [中文说明](README.zh-CN.md) · [Integration guide](docs/sdk.md) · [App example](examples-product/chat-entry.mjs)

## Install

Use [Node.js 22 or 24](https://nodejs.org/en/download). In your application's backend folder, run this in Windows PowerShell:

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
```

On macOS/Linux, use `npm` instead of `npm.cmd`. This installs the packaged **0.5.0-beta.3** SDK from GitHub; you do not need to download or build the source. The OpenAI client can use your existing compatible provider's Base URL and API key. [Release notes](docs/release-notes.md)

## Connect your existing chat app

Keep your existing OpenAI client. Create this once in your Node.js backend:

```js
import { createMemoryChat } from 'memory-system-v2/chat';

const chat = createMemoryChat({
  client, // Your existing configured OpenAI client.
  memory: {
    dbPath: './data/memory.sqlite',
    embedding: {
      kind: 'nvidia',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/nemotron-3-embed-1b',
      dimension: 2048,
      apiKey: process.env.EMBED_API_KEY,
    },
  },
});
```

Where your app currently calls:

```js
const response = await client.chat.completions.create({ model, messages });
```

replace it with:

```js
const response = await chat.create({
  userId: signedInUser.id,
  sessionId: conversation.id,
  model,
  messages,
});
```

Continue using `response.choices[0].message.content` as before. Use stable IDs from your backend; add `personaId` if different characters have separate memories. You do not need separate retrieval, prompt-injection or save calls.

For streaming, pass `stream: true` and read the returned stream with `for await`. Call `await chat.close()` when the backend shuts down. [Full example and limits](docs/sdk.md#automatic-chat-entry)

## What it does

- Keeps original user and assistant messages in a local SQLite file.
- Retrieves older messages within the same user, character and conversation.
- Includes bounded recent context and historical evidence without repeating the same saved exchange in both.
- Supports normal text replies and streamed text replies.
- Continues chatting if memory retrieval or saving fails.

The backend runs on your computer or your own server. There is no author-operated memory service. Embedding requests send message text and queries to the configured provider and may cost money. Local Ollama embeddings are also supported. Memory management makes no additional generative-model calls.

This entry supports text-only Chat Completions. Tool calls, images and multiple choices pass through without automatic memory. Cancelled or incomplete replies are not stored as completed exchanges. Retrieval can miss relevant history; it does not guarantee that the model will answer correctly. [Privacy](docs/privacy.md) · [SDK reference](docs/sdk.md)

## Retrieval results

A synthetic test used 200 exchanges across eight sessions and 50 queries:

| Check | This SDK | Pinned LongMemory baseline |
| --- | ---: | ---: |
| Expected user source in the first five results, 35 shared queries | 33/35 | 21/35 |
| Original messages recovered after restart | 400/400 | 400/400 |

Two Chinese-history/English-query cases were missed. These are retrieval results for the beta.2 core, not a test of the new chat entry, final-answer accuracy or token savings. [Method](benchmarks-product/blind/README.md) · [Results](benchmarks-product/blind/RESULTS.md)

## Source and license

Project code: [MIT](LICENSE). The modified LongMemory core retains [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE) and its [NOTICE](NOTICE). [ATTRIBUTION](ATTRIBUTION.md) records the upstream revision and modifications.

Development checks:

```sh
npm ci
npm run typecheck
npm test
npm run smoke:consumer
```
