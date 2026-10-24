# Memory System V2

Add long-term memory to Node.js chat apps. The SDK saves conversation text and retrieves relevant content for the model when users ask follow-up questions.

Supports ordinary and streamed text through OpenAI-compatible Chat Completions. An embedding provider is required.

[中文说明](README.zh-CN.md) · [Download package](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz)

## 1. Install

Requires Node.js 22 or 24. Open PowerShell in your application's backend folder, which contains `package.json`.

Check the installation with `node --version` and `npm.cmd --version`. If either command is missing, install Node and reopen PowerShell.

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
Copy-Item .\node_modules\memory-system-v2\examples-product\chat-entry.mjs .\memory-chat.mjs
```

The second line copies the integration module to the current folder. Choose another filename if one already exists to avoid overwriting it.

If you already downloaded the `.tgz`, install it with `npm.cmd install "full-path\memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0`, replacing the path with its actual location, then run the same `Copy-Item` command. Do not extract the archive.

On macOS/Linux, use `npm`, then `cp node_modules/memory-system-v2/examples-product/chat-entry.mjs ./memory-chat.mjs`.

## 2. Configure

Create or open `.env` in the same folder:

```powershell
if (!(Test-Path -LiteralPath .\.env)) { New-Item -ItemType File -Path .\.env | Out-Null }
notepad .\.env
```

Enter your URLs, models and API keys, then press **Ctrl+S to save**. Update existing keys in place and preserve other settings. Use each full API key without a `Bearer ` prefix. The filename should be `.env`, not `.env.txt`.

```dotenv
# Chat model
CHAT_BASE_URL=https://your-chat-provider.example/v1
CHAT_MODEL=your-chat-model
CHAT_API_KEY=your-chat-key

# Embedding provider; this example uses NVIDIA
EMBED_PROVIDER=nvidia
EMBED_BASE_URL=https://integrate.api.nvidia.com/v1
EMBED_MODEL=nvidia/nemotron-3-embed-1b
EMBED_DIMENSION=2048
EMBED_API_KEY=your-nvidia-key

# Local database
MEMORY_DB_PATH=./data/memory.sqlite
```

After saving, check that the configuration loads:

```powershell
node --env-file=.env --input-type=module -e "const m = await import('./memory-chat.mjs'); await m.close(); console.log('Configuration loaded');"
```

`Configuration loaded` confirms that the configuration loaded. This does not request a model response or validate API keys.

For another compatible embedding provider, use `EMBED_PROVIDER=openai` and its URL, embedding model and dimension. Chat and embeddings can use different providers. [Embedding settings](docs/sdk.md#embedding-configuration)

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

Use your existing text `messages` and user/conversation IDs verified by your backend. Add `personaId` when characters need separate memories.

Read `response.choices[0].message.content` as before. For streaming, add `stream: true` and consume with `for await`. Call `await close()` when shutting down.

The shown `import` works in `.mjs` files or projects with `"type": "module"`. CommonJS async handlers can use `const { reply } = await import('./memory-chat.mjs')`.

For TypeScript, reusing an existing client or passing more model parameters, see the [createMemoryChat API](docs/sdk.md#automatic-chat-entry). Images, tool calls and multiple choices pass through to the original client without automatic memory.

## 4. Start your app

Your startup command must also load `.env`; the configuration check above does not load environment variables for later commands.

| Original startup | Updated startup |
| --- | --- |
| `node server.mjs` | `node --env-file=.env server.mjs` |
| `node server.js` | `node --env-file=.env server.js` |
| `npm.cmd start`, where `scripts.start` in `package.json` is `node server.js` | Change that value to `node --env-file=.env server.js`, then keep using `npm.cmd start` |

Keep your application's entry filename and place `--env-file=.env` after `node`, before the filename. Run from the folder containing `.env`.

If your framework already loads environment settings, keep its startup command and configuration file. Restart the backend after configuration changes. Existing environment variables take precedence over `.env`.

Conversation text and indexes are stored in `data/memory.sqlite` by default and remain available after restarting with the same user, persona and conversation IDs. Preserve the database file in deployment and add `.env` and `data/` to `.gitignore`.

Remote embedding providers receive messages and queries. [Privacy](docs/privacy.md)

## Documentation

[API](docs/sdk.md) · [Interface compatibility](docs/compatibility.md) · [Timeouts and recovery](docs/sdk.md#timeouts-and-recovery) · [Experiment report](docs/integration-validation.md)

## Source and license

The retrieval core reuses [LongMemory](https://github.com/CaviraOSS/LongMemory). Project code is [MIT](LICENSE); upstream code retains [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE) and [NOTICE](NOTICE). See [ATTRIBUTION](ATTRIBUTION.md) for provenance and modifications.
