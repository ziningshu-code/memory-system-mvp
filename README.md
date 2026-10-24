# Memory System V2

Long-term memory for your Node.js chat app. Configure it once: the SDK retrieves older conversation text, adds bounded evidence, calls your existing model and saves completed exchanges.

[中文说明](README.zh-CN.md) · [Download package](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz)

## 1. Install

Use Node.js 22 or 24. Open PowerShell in **your application's backend folder**:

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
Copy-Item .\node_modules\memory-system-v2\examples-product\chat-entry.mjs .\memory-chat.mjs
```

This installs the built SDK without a source checkout. The copied file is an integration module for your backend, not a separate chat app. Choose another filename if it already exists.

On macOS/Linux, use `npm`, then `cp node_modules/memory-system-v2/examples-product/chat-entry.mjs ./memory-chat.mjs`.

## 2. Configure

Add these settings to your backend's existing environment configuration. If using `.env`, run `notepad .env` in the same folder to create or edit it. Preserve existing settings and keep keys out of Git.

```dotenv
# Keep your existing chat provider settings
CHAT_BASE_URL=https://your-chat-provider.example/v1
CHAT_MODEL=your-chat-model
CHAT_API_KEY=your-chat-key

# Embeddings are configured separately; this example uses NVIDIA
EMBED_PROVIDER=nvidia
EMBED_BASE_URL=https://integrate.api.nvidia.com/v1
EMBED_MODEL=nvidia/nemotron-3-embed-1b
EMBED_DIMENSION=2048
EMBED_API_KEY=your-nvidia-key

MEMORY_DB_PATH=./data/memory.sqlite
```

A `.env` file is not loaded automatically. Keep your backend's existing environment loader, or add `--env-file=.env` to its Node startup command, for example `node --env-file=.env server.mjs`, replacing `server.mjs` with your actual entry file.

For another compatible embedding endpoint, use `EMBED_PROVIDER=openai` and its actual URL, embedding model and dimension. A chat model is not an embedding model. [Embedding settings](docs/sdk.md#embedding-configuration)

## 3. Replace the chat call

Import the integration module into your existing chat handler, adjusting the path:

```js
import { reply, close } from './memory-chat.mjs';
```

Replace:

```js
const response = await client.chat.completions.create({ model, messages });
```

with:

```js
const response = await reply({
  userId: signedInUser.id,
  sessionId: conversation.id,
  messages,
});
```

Use your existing text `messages` and trusted backend user/conversation IDs. Add `personaId` when characters need separate memories. Do not trust arbitrary identity claims from the client.

Read `response.choices[0].message.content` as before. For streaming, add `stream: true` and consume with `for await`. Call `await close()` when shutting down.

No separate recall, prompt assembly or save calls are needed. To reuse your configured client or pass more model parameters, use [createMemoryChat directly](docs/sdk.md#automatic-chat-entry).

## Scope

- **Node.js 22/24 backends**, using the **OpenAI-compatible Chat Completions** interface. OpenAI models or keys are not required.
- Ordinary and streamed text; one response, alternating user/assistant messages, with system instructions first.
- Tools, images, multiple choices and unsupported message shapes go to the original client without automatic memory.
- No adapter for OpenAI Responses, native Claude Messages or native Gemini APIs in this release. This is not a universal drop-in plugin for finished apps. [Interface compatibility](docs/compatibility.md)
- An embedding provider is required and can differ from the chat provider. Run on your own computer or backend; no author-operated server is needed.
- Original text and indexes are stored in local SQLite. Remote embedding providers receive messages and queries and may charge for them. Memory management makes no additional generative calls.

## Timeouts and recovery

| Failure | Behavior |
| --- | --- |
| Chat model timeout | Existing memory remains. The app receives the error; incomplete replies are not stored as completed exchanges. The integration module configures at most one client retry. |
| Embedding failure after transcript save | Original text remains; failed indexes can be repaired on reopening the session after recovery, or by an explicit rebuild. |
| Retrieval unavailable | Chat continues with bounded recent context. |
| Database write failure | A valid model response is returned with a memory error event. This does not guarantee the exchange was saved. |

Persistence is not a separate disaster-recovery backup. The SDK does not journal unfinished user requests; the app retains pending/failed messages and retry state. Database backups remain a deployment responsibility. [Recovery details](docs/sdk.md#timeouts-and-recovery) · [Privacy](docs/privacy.md)

Retrieval can miss history and model answers can be wrong.

Validated in a real AI chat backend. The before/after integration experiment is an [attached report](docs/integration-validation.md).

## Source and license

The retrieval core reuses [LongMemory](https://github.com/CaviraOSS/LongMemory). Project code is [MIT](LICENSE); upstream code retains [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE) and [NOTICE](NOTICE). See [ATTRIBUTION](ATTRIBUTION.md) for provenance and modifications.
