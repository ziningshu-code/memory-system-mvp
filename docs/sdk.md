# SDK guide

## Install

Use Node.js 22 or 24:

```sh
npm install memory-system-v2@beta
```

In Windows PowerShell, use `npm.cmd` if script execution is blocked. Start with the [runnable example](../README.md#try-it), then use the [chat integration example](../examples-product/openai-compatible-chat.mjs).

SQLite uses `better-sqlite3`. If installation fails, check the Node version first. Platforms without a prebuilt binary need Python and C/C++ build tools for `node-gyp`. See [SQLite troubleshooting](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md).

## Create an instance

Call `createMemory()` with a persistent `dbPath` and an embedding configuration. The README shows NVIDIA; other options are below. The defaults are tenant `local`, owner `default`, and database `~/.memory-system-mvp/memory.sqlite`. Use stable tenant/owner IDs when your application has more than one user. In-memory SQLite databases are not supported.

## Chat flow

1. Call `recall({sessionId, query, excludeTurnIds?})` before the chat-model request.
2. Include `result.context` in a separate system/developer block as historical data. Supply your application's bounded recent conversation separately.
3. Call your normal chat model.
4. Call `remember({sessionId, turnId?, user, assistant})` with the completed visible exchange.
5. Call `close()` on shutdown.

Use `excludeTurnIds` for turns already included in recent context. The SDK does not know which messages your application has sent to the model.

## Methods

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

If recall fails or `trace.error` is set, continue with recent context. If saving fails, still return a valid chat-model response. Avoid logging keys or private message text.

Use one writer per local database. Paired saves are transactional, but the SDK and your application's own history store do not share a transaction. Your application should reconcile a missed save after a crash. Session IDs are application-controlled, not an authentication mechanism.

The example is text-only and non-streaming. For streaming applications, save the exact completed reply after the stream finishes. No automatic backfill or V1 archive import is provided.
