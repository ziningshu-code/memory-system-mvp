# Memory System V2

Long-term memory for your Node.js chat app. Configure it once: the SDK retrieves older conversation text, adds bounded evidence, calls your existing model and saves completed exchanges.

[中文说明](README.zh-CN.md) · [Download package](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz)

## 1. Install

Use Node.js 22 or 24. Open PowerShell in **your application's backend folder**:

This is the folder containing `package.json`. Check `node --version` and `npm.cmd --version` first. Node should report `v22...` or `v24...`; after installing Node, reopen PowerShell.

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
Copy-Item .\node_modules\memory-system-v2\examples-product\chat-entry.mjs .\memory-chat.mjs
```

This installs the built SDK without a source checkout. The copied file is an integration module for your backend, not a separate chat app. Choose another filename if it already exists.

If you already downloaded the `.tgz`, install it with `npm.cmd install "full-path\memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0`, replacing the path with its actual location, then run the same `Copy-Item` command. Do not extract the archive.

On macOS/Linux, use `npm`, then `cp node_modules/memory-system-v2/examples-product/chat-entry.mjs ./memory-chat.mjs`.

## 2. Configure

In the same backend folder, create `.env` only if it does not exist, then open it:

```powershell
if (!(Test-Path -LiteralPath .\.env)) { New-Item -ItemType File -Path .\.env | Out-Null }
notepad .\.env
```

Enter your settings below, press **Ctrl+S**, and close Notepad. Edit existing duplicate keys instead of adding a second copy; preserve unrelated settings. Use each full API key without a `Bearer ` prefix. The filename is `.env`, not `.env.txt`. Keep it out of Git.

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

In that same PowerShell window, check configuration loading without printing any secrets:

```powershell
node --env-file=.env --input-type=module -e "const m = await import('./memory-chat.mjs'); await m.close(); console.log('Configuration loaded');"
```

`Configuration loaded` confirms that Node read the file and initialized the integration module. This makes **no model request** and does not validate provider credentials.

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

The shown `import` works in `.mjs` files or projects with `"type": "module"`. CommonJS handlers can use `const { reply } = await import('./memory-chat.mjs')`; TypeScript applications can use the typed direct wrapper. Do not change the entire application's module format just for this integration.

## 4. Load configuration when starting your app

The configuration check above only loaded `.env` for that one command. **Your actual server startup must load it too.**

| Original startup | Updated startup |
| --- | --- |
| `node server.mjs` | `node --env-file=.env server.mjs` |
| `node server.js` | `node --env-file=.env server.js` |
| `npm.cmd start`, where `scripts.start` in `package.json` is `node server.js` | Change that value to `node --env-file=.env server.js`, then keep using `npm.cmd start` |

Keep your real entry filename; only insert `--env-file=.env` after `node` and before the filename. Do not create an empty `server.mjs`. Run from the folder containing `.env`.

If your framework already loads environment settings, put these settings in the file it actually reads and keep that loader. Do not replace arbitrary framework `npm run dev` scripts with a plain Node command. Restart after configuration changes. Existing process environment variables take precedence over `.env`; check deployment settings if old values persist.

Send a message through **your original app**, receive a real reply, then restart its backend and continue with the same user, persona and conversation IDs. The default data file is `data/memory.sqlite` under the backend folder. SQLite may also create `-wal` and `-shm` files; do not delete them while running. There is no separate memory chat page.

| Problem | Check |
| --- | --- |
| Missing `.env` | Use `Get-Location` and `Get-Item -Force .\.env` to check the folder and exact filename. |
| Required setting missing | Fill it in, save, and make sure the real startup command loads `.env`. |
| `ERR_MODULE_NOT_FOUND` | Install in the same backend folder and check the integration-module path. |
| Provider 401/403 | Verify that provider's full key, permissions and Base URL. Chat and embeddings may use different keys. |
| Memory index/retrieval error | Check embedding endpoint, model, key and dimension. A working chat reply alone does not prove memory indexing succeeded. |

Add `.env` and `data/` to your application's `.gitignore`, preserving existing rules. Use a persistent database path in deployment.

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
