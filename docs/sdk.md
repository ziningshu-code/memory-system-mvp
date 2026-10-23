# SDK guide

## Install

Use Node.js 22 or 24. Install the packaged SDK in your application's backend folder:

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
```

Use `npm` on macOS/Linux. This installs beta.3 from GitHub without a source checkout. The chat entry is tested with OpenAI Node 7.42; the client can connect to an OpenAI-compatible provider. Existing low-level `createMemory()` integrations still work and do not require the OpenAI client.

SQLite uses `better-sqlite3`. If installation fails, check the Node version first. Platforms without a prebuilt binary need Python and C/C++ build tools for `node-gyp`. See [SQLite troubleshooting](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md).

## Automatic chat entry

Create one instance per backend process using your existing OpenAI client:

```js
import { createMemoryChat } from 'memory-system-v2/chat';

const chat = createMemoryChat({
  client,
  memory: {
    dbPath: './data/memory.sqlite',
    embedding: {
      kind: 'openai',
      baseUrl: process.env.EMBED_BASE_URL,
      apiKey: process.env.EMBED_API_KEY,
      model: process.env.EMBED_MODEL,
      dimension: Number(process.env.EMBED_DIMENSION),
    },
  },
});
```

Use your provider's embedding model and its actual vector dimension. Chat and embeddings can use different providers. The [application example](../examples-product/chat-entry.mjs) reads and validates environment settings.

Replace `client.chat.completions.create(params, options)` with:

```js
const response = await chat.create({
  ...params, // The existing model, messages and other model settings.
  userId: signedInUser.id,
  sessionId: conversation.id,
}, options);
```

Build `userId`, `sessionId` and optional `personaId` from trusted backend data. Never let a caller claim another user's identity or conversation. Different users, personas and sessions have separate memories. These IDs are stripped before forwarding the model request.

For supported text conversations, the wrapper automatically selects recent context, retrieves older original messages, adds bounded evidence, calls the model and saves the completed visible exchange. The completion object is returned unchanged. Model errors still propagate; memory errors do not discard a valid reply.

```js
const stream = await chat.create({
  userId: signedInUser.id,
  sessionId: conversation.id,
  model,
  messages,
  stream: true,
}, { signal });

for await (const chunk of stream) {
  sendTextToYourClient(chunk.choices[0]?.delta?.content ?? '');
}
```

Streaming forwards chunks as they arrive and saves after natural completion. Breaking the loop or calling `stream.controller.abort()` cancels it. Finish consuming or cancel every stream: requests in the same user/persona/session wait for the previous request to finish. `await chat.close()` cancels open streams, waits for work and closes memory.

The wrapper returns a Promise, or a Promise of an async iterable for streaming. OpenAI helpers such as `.withResponse()`, `.tee()` and `.toReadableStream()` are not exposed. Its types are checked against OpenAI Node 7.42.

### Context and diagnostics

- `recentTurns`: maximum recent completed pairs, default 5.
- `recentMaxChars`: combined recent user/assistant string length, default 6000. Complete pairs are kept; oversized pairs are not cut.
- `memory.maxEvidenceTokens`: estimated historical-evidence budget, default 512, including source markers and wrapper delimiters.
- `onMemoryEvent(event)`: optional callback with retrieval source IDs, estimated evidence size, omitted sources or failure stage. No message text or API keys are included.

If your request contains earlier text pairs, the wrapper bounds those pairs. If you send only the current user message, it loads recent saved pairs. Saved exchanges still present in the outgoing recent context are excluded from long-term retrieval. System/developer instructions and the current user message are not counted in the recent-window limit.

The supported shape is alternating text user/assistant messages ending with a user message, optionally preceded by system/developer instructions. Tool calls, images, multiple choices and other unsupported shapes pass through unchanged, without memory. Only nonempty text answers ending with `finish_reason: 'stop'` are saved. Truncated, refused, failed or cancelled answers are not saved as completed exchanges.

## Low-level memory API

Use `createMemory` from `memory-system-v2` when your application needs to control retrieval and saving itself. The automatic chat entry does not require these calls:

1. `recall({sessionId, query, excludeTurnIds?})` retrieves history.
2. Your app includes `result.context` as historical data and calls its model.
3. `remember({sessionId, turnId?, user, assistant})` saves the completed visible exchange.
4. `close()` finishes queued work.

Pass a persistent `dbPath` and embedding configuration to `createMemory()`. Defaults are tenant `local`, owner `default`, and database `~/.memory-system-mvp/memory.sqlite`. In-memory databases are not supported. Set stable owner IDs for separate users.

The automatic entry uses `ownerId = userId` and the low-level session ID `JSON.stringify([personaId ?? null, sessionId])`. Use that mapping if you access its history, correction or deletion methods through a separate low-level instance; close the chat entry first to keep a single writer.

### Methods

| Method | Result |
| --- | --- |
| `remember(input)` | Saves a completed exchange; returns `turnId`, `sourceIds`, `indexed` and `failed`. |
| `recall(input)` | Returns `context`, exact `sources` and a retrieval `trace`. |
| `history(sessionId)` | Lists saved messages in order, including replaced messages and excluding deleted ones. |
| `rebuild(sessionId)` | Recreates search data from saved messages; returns `indexed` and `failed`. |
| `erase({sessionId, sourceId})` | Deletes the whole paired exchange. |
| `close()` | Finishes queued work and closes the database. |

Stable `turnId` values make save retries idempotent. Source IDs are `${turnId}:user` and `${turnId}:assistant`. An identical retry reuses indexed sources; changing text or correction/time metadata under the same ID is rejected.

A nonempty `failed` means the original message is saved but its search data is incomplete. Retry with `rebuild()`. Unchanged ordinary saves reuse existing vectors; rebuilding can call the embedding service again.

## Recall options and trace

The default is up to five sources within an estimated 512-token budget, including source markers. Set `limit` and `maxEvidenceTokens` per call. A long source may return an exact prefix; `exactRange` gives Unicode code-point offsets and the total source length. A relevant detail beyond that excerpt may not be included.

`trace` lists ranked, rejected and omitted sources, the estimated context size and any retrieval error. Empty results are valid. These token counts are estimates, not the chat model's exact tokenizer.

Sources pass the relevance check when their semantic score reaches `minSemanticSimilarity`, or their LongMemory lexical score is at least 0.8. The default semantic threshold is 0.35 for NVIDIA `nvidia/nemotron-3-embed-1b` and 0.62 for other configurations. You can change it for your own data; higher thresholds can reject irrelevant results but also miss useful messages.

## Corrections and historical recall

Corrections are explicit: set `supersedesSourceId` to a source in the older exchange. Both roles of the older exchange are replaced for current recall.

```js
await memory.remember({sessionId: 'chat', turnId: 'old', recordedAt: 1000,
  user: 'The appointment is Tuesday.', assistant: 'Tuesday, understood.'});
await memory.remember({sessionId: 'chat', turnId: 'new', recordedAt: 2000,
  supersedesSourceId: 'old:user',
  user: 'Correction: the appointment is Wednesday.', assistant: 'Wednesday, understood.'});
const before = await memory.recall({sessionId: 'chat', query: 'appointment', asOf: 1500});
await memory.erase({sessionId: 'chat', sourceId: 'new:user'});
```

`asOf` selects what had been recorded at a Unix-millisecond timestamp. Optional `validFrom` on a saved exchange and `validAt` on recall describe validity times supplied by your application; the SDK does not infer them.

Deleting a newer correction restores the nearest surviving predecessor. Deleting an older or middle exchange keeps surviving successors and reconnects the correction chain. Deleted text stays unavailable in historical recall. See [deletion limits](privacy.md#deletion).

## Embedding configuration

| Kind | Required settings |
| --- | --- |
| `openai` | Embeddings `baseUrl`, `model`, `dimension`; `apiKey` when the provider requires it. |
| `nvidia` | `model`, `dimension`, `apiKey`; optional `baseUrl`. |
| `ollama` | Local `model`, `dimension`; optional `baseUrl`. |
| `custom` | Stable `id`, `dimension` and `embed(text, context)` returning a real vector. |

A chat endpoint alone is not an embedding service. Configure chat and embeddings independently. The NVIDIA README example uses `nvidia/nemotron-3-embed-1b` at 2048 dimensions. Set the actual dimension for other models.

Missing configuration fails at initialization. Provider failures or invalid vectors produce failed source IDs or a recall error trace while retaining saved messages. Changing provider/model/dimension invalidates incompatible search data. Opening a session can retry missing indexes; this may incur embedding cost.

## Errors and deployment

The automatic chat entry handles retrieval/save failures and reports them through `onMemoryEvent`. With the low-level API, handle these yourself: if recall fails or `trace.error` is set, continue with recent context; if saving fails, still return a valid chat-model response. Avoid logging keys or private message text.

Use one writer per local database. Paired saves are transactional, but the SDK and your application's own history store do not share a transaction. Your application should reconcile a missed save after a crash. Session IDs are application-controlled, not an authentication mechanism.

No automatic backfill or V1 archive import is provided. The chat entry saves new completed exchanges; passing older messages as recent context does not import them into long-term storage.
