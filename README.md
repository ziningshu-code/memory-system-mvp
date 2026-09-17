# Topic Memory

**Persistent conversation memory for your own model. Set up on one local page.**

[中文说明](./README.zh-CN.md) · [Plugin guide](./docs/PLUGIN.md) · [SDK guide](./docs/USAGE.md) · [Architecture](./docs/ARCHITECTURE.md)

Topic Memory is a local memory plugin and TypeScript SDK. It keeps original conversations, builds a topic index, and restores source passages for your model. Bring your own endpoint; no author's shared API key or hosted account is required.

## One command, one page

Install [Node.js](https://nodejs.org/) **20.6+**, then run in a folder you will keep:

```bash
npx --yes topic-memory@0.2.0
```

On Windows PowerShell use `npx.cmd --yes topic-memory@0.2.0`. Open **http://127.0.0.1:4318**:

1. Enter your provider Base URL, model ID and API key; save. Local unauthenticated models may leave the key blank.
2. Test the connection and chat on the same page.
3. To use an existing local chat client, copy the page's session Base URL, local connection key and model ID into its OpenAI-compatible settings.

No `.env` editing. Use a new session URL for every independent conversation. The UI currently uses Chinese labels.

## Download from GitHub

Choose **Code → Download ZIP**, extract, then double-click **`start.cmd`** on Windows. Or run in the extracted folder:

```bash
npm ci
npm start
```

Use `npm.cmd` in PowerShell if script execution is restricted. Keep the terminal open. Ctrl+C stops it; restarting in the same folder restores configuration and memory.

## Compatibility

This is a local **OpenAI-compatible Chat Completions gateway**, not a native extension for every chat application. Clients must allow a custom endpoint, key and model. Specific third-party clients have not been certified by the protocol tests.

- Text Chat Completions and model listing; independent durable memory at `/sessions/SESSION_ID/v1`.
- `stream: true` returns SSE **after the full answer is generated and stored**, not incremental tokens.
- No images, tool/function calls, Responses API, structured output, multiple candidates or editing/branching old messages. Start a new session when branching.
- Loopback only (`127.0.0.1`), one local user. Cross-origin browser clients, containers and cloud apps cannot directly use this setup.
- Recent five exchanges work immediately; topics start after six completed exchanges, with up to three selected topics. Indexing and directory costs still grow with history.

## Data and credentials

Configuration, conversations and reports live in **`.topic-memory` under the launch folder**. The page shows the absolute path. Back it up before upgrading, and preserve the directory. A fixed path can be selected:

```bash
npx --yes topic-memory@0.2.0 --data-dir ./my-memory
```

The configuration contains a plaintext provider key; protect this directory. The UI never reads the provider key back. Git/npm exclude local data. Conversation evidence is sent to your chosen provider, not the author. One process owns each directory and same-session turns are serialized.

## Verification

Automated tests cover SDK behavior, interleaved indexing coverage, restart persistence, session isolation, concurrent turns, authentication, redacted errors and SSE. Protocol tests use a local fixture and **are not model-quality evidence**.

The page's real-model comparison calls your provider for topic indexing, selection and answers: 24 public synthetic exchanges, repeated indexing during ingestion, four questions, recent-five/full-transcript/topic-memory methods. About 23 requests can incur charges. Reports contain raw answers, worker errors, latency and provider usage. Literal checks can misgrade paraphrases. This diagnostic does not establish general accuracy, savings or production readiness.

The legacy `npm run demo` and static `npm run build:site` use scripted responses and only illustrate mechanics.

## SDK

```bash
npm install topic-memory
```

```ts
import { createMemory, createOpenAICompatibleMemoryLlm } from 'topic-memory';
import { FileMemoryStorage } from 'topic-memory/node';
const memory = createMemory({
  storage: new FileMemoryStorage('./data/conversation.json'),
  llm: createOpenAICompatibleMemoryLlm({ baseUrl, model, apiKey }),
});
```

Browser apps can use the existing `topic-memory` in-memory/IndexedDB exports. The filesystem adapter is Node-only. Hosts own the main-model call and must serialize complete turns per store. See the [SDK lifecycle guide](./docs/USAGE.md).

## Development

```bash
npm ci
npm run typecheck
npm test
npm run smoke:consumer
npm run evaluate
npm run build:site
```

After saving web configuration, `npm run evaluate:plugin` writes `benchmark-results/plugin-live.json`. Never commit credentials or private conversations.

MIT License.
