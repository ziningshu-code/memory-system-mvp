# Memory System V2

A Node.js SDK for developers building chat apps. Save conversations locally, find relevant older messages, and send the original text to your chat model.

Built on [LongMemory](https://github.com/CaviraOSS/LongMemory). Your app calls the SDK before and after each reply; once integrated, saving and retrieval run as part of the chat. It is not a standalone chat app or a plugin you can install into ChatGPT.

[Install](#install) · [Download source ZIP](https://github.com/ziningshu-code/memory-system-mvp/archive/refs/heads/main.zip) · [Download SDK](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.2) · [中文说明](README.zh-CN.md)

## Install

Use [Node.js 22 or 24](https://nodejs.org/en/download), then run this in your application's folder:

```sh
npm install memory-system-v2@beta
```

Windows PowerShell:

```powershell
npm.cmd install memory-system-v2@beta
```

The current release is **0.5.0-beta.2**. npm installation is the simplest option. The release page also has a packaged SDK under **Assets**; the ZIP link downloads source code. Neither download is a Windows application installer.

## Try it

This example saves a flight-time exchange and retrieves the original user message. It uses NVIDIA embeddings and makes no chat-model request.

### 1. Create a folder

```sh
mkdir memory-v2-demo
cd memory-v2-demo
npm init -y
npm install memory-system-v2@beta
```

In PowerShell, use `npm.cmd` for both npm commands if script execution is blocked.

### 2. Configure embeddings

Get a key for [NVIDIA nemotron-3-embed-1b](https://build.nvidia.com/nvidia/nemotron-3-embed-1b). Create `.env` in this folder:

```dotenv
EMBED_API_KEY=your_nvidia_api_key
```

Replace the placeholder with your key. Keep this file out of Git. This provider receives the saved messages and search queries; embedding requests may incur costs. You can also use [other providers or local Ollama](docs/sdk.md#embedding-configuration).

### 3. Run the example

Save the following as `demo.mjs`:

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

```sh
node --env-file=.env demo.mjs
```

Expected output:

```text
Source: flight-1:user
Original message: My flight leaves at 7:40 tomorrow morning.
```

The assistant text in this example is sample data. In your app, save the actual completed response from your chat model.

## Connect a chat app

```text
User message → recall old messages → your chat model → reply → save the exchange
```

Call `recall()` before sending a question to your model, include its `context` as historical evidence, then call `remember()` with the user message and completed reply. Keep the current conversation and retrieved evidence separate.

The [chat example](examples-product/openai-compatible-chat.mjs) shows this flow with independent chat and embedding endpoints. The [SDK guide](docs/sdk.md) covers sessions, recent-message exclusions, corrections, deletion and error handling.

## Storage and limits

Original messages and search data are stored in one local SQLite file. The example uses `./memory.sqlite`; the default is `~/.memory-system-mvp/memory.sqlite`.

Recall returns source IDs and original text, with a size limit. Long messages may be excerpted, and some searches may miss relevant history. Corrections must be supplied explicitly. Rebuilds can make new embedding requests.

Memory management makes no extra generative-model calls. Embeddings still require a provider. There is no bundled proxy, setup page or browser SDK. See [privacy and deletion](docs/privacy.md).

## Tests

23 SDK tests pass, with CI on Windows/Linux and Node 22/24. The npm installation and NVIDIA example have also been checked in a fresh folder.

A synthetic benchmark used 200 exchanges across eight sessions and 50 queries:

| Check | This SDK | Pinned LongMemory baseline |
| --- | ---: | ---: |
| Expected user source in the first five results, 35 shared queries | 33/35 | 21/35 |
| Original messages recovered after restart | 400/400 | 400/400 |

Two Chinese-history/English-query cases were missed. This small test measures retrieval, not final-answer accuracy or token savings. [Method](benchmarks-product/blind/README.md) · [Full results](benchmarks-product/blind/RESULTS.md)

## Source and license

The SDK includes a modified [LongMemory core](https://github.com/CaviraOSS/LongMemory). Conversation storage and the public SDK are in `src/product/`. [ATTRIBUTION](ATTRIBUTION.md) lists the upstream revision and changes.

Project code: [MIT](LICENSE). LongMemory code: [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE), with its [NOTICE](NOTICE).

For source installation, install Git and run:

```sh
npm install "git+https://github.com/ziningshu-code/memory-system-mvp.git#main"
```

This builds the SDK from `main`, which may include changes after the npm release.

For development:

```sh
npm ci
npm run typecheck
npm test
npm run smoke:consumer
```
