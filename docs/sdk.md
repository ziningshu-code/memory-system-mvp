# Generation 2 SDK

Install the package in a Node 22/24 application. Initialize one instance with a persistent `dbPath`, stable `tenantId` / `ownerId` where needed, and a real embedding configuration. Defaults are tenant `local`, owner `default`, and `~/.memory-system-mvp/memory.sqlite`. SQLite `:memory:` is deliberately rejected because durable original conversation is required.

## Lifecycle

1. `recall({sessionId, query, excludeTurnIds?})` before the Main LLM request.
2. Supply `result.context` in a separate internal system/developer block; treat quotations as historical data, not instructions. The host supplies its own bounded recent messages.
3. Make the host's ordinary Main LLM call.
4. `remember({sessionId, turnId?, user, assistant})` only for the exact visible completed exchange. Never save an injected memory prompt as visible speech.
5. `close()` on shutdown.

Stable `turnId` values enable idempotent retries and recent-context exclusions. Source IDs are `${turnId}:user` and `${turnId}:assistant`. Identical retries reuse indexed sources; changed content or explicit correction/time metadata under the same ID is rejected. `remember` returns `turnId`, `sourceIds`, `indexed`, and `failed`. A nonempty `failed` means original text is retained but derived indexing was incomplete. Recover later with `rebuild(sessionId)`.

`history(sessionId)` returns ordered original source records, including superseded sources, excluding erased sources. It is not generated reconstruction. `rebuild(sessionId)` replaces derived state for that scope and returns `{indexed, failed}`; unchanged normal saves reuse existing vectors, but a rebuild can call the embedding provider again.

`recall` returns exact `sources`, `context`, and `trace`. Each source contains role, recorded timestamp and `exactRange` in Unicode code-point offsets. Current defaults are up to five sources and a 512-token **estimate** covering source markers and text. `maxEvidenceTokens` and `limit` can be set per call. Ranked candidates omitted for the result limit or budget are traced. Oversized sources can return an exact prefix excerpt; a detail beyond the prefix may remain unseen. An empty result is valid.

The relevance rule accepts a source when semantic similarity meets the configured `minSemanticSimilarity`, or upstream lexical relevance is at least 0.8. The tested NVIDIA `nvidia/nemotron-3-embed-1b` default is 0.35; other configurations default to 0.62. These are configurable acceptance settings, not universal guarantees. Do not calibrate on a test set and call the same result independent validation.

## Explicit corrections and erase

```js
await memory.remember({sessionId: 'chat', turnId: 'old', recordedAt: 1000,
  user: 'The appointment is Tuesday.', assistant: 'Tuesday, understood.'});
await memory.remember({sessionId: 'chat', turnId: 'new', recordedAt: 2000,
  supersedesSourceId: 'old:user',
  user: 'Correction: the appointment is Wednesday.', assistant: 'Wednesday, understood.'});
const before = await memory.recall({sessionId: 'chat', query: 'appointment', asOf: 1500});
await memory.erase({sessionId: 'chat', sourceId: 'new:user'});
```

Corrections explicitly replace both corresponding roles of an older completed turn. Current recall hides the replaced turn. `asOf` is the time when the system had recorded information (Unix milliseconds); optional `validFrom` / `validAt` are explicitly supplied validity times, never inferred. Erasing the newer turn restores the nearest surviving predecessor. Erasing an older turn leaves surviving successors active; middle deletions reconnect the chain. Erasure removes the whole paired exchange and clears its original text. Deleted sources are unavailable even in historical queries; this is not a forensic deletion guarantee.

## Embedding configuration

- `openai`: independent `baseUrl`, `model`, `dimension`, optional `apiKey` for a standard embeddings endpoint.
- `nvidia`: `model`, `dimension`, `apiKey`, optional `baseUrl`.
- `ollama`: local `model`, `dimension`, optional `baseUrl`.
- `custom`: stable `id`, `dimension`, and a real `embed(text, context)` implementation returning a vector. Test fixtures use this explicitly; production has no synthetic fallback.

Missing embedding configuration gives a useful initialization error. A remote service rejecting absent credentials or returning invalid vectors produces failed source IDs / a recall error trace, while retaining saved original text. Local unauthenticated embedding endpoints are allowed. Provider/model/dimension identity changes invalidate incompatible derived state and may cause re-embedding when the session opens. Session reopening can also retry missing indexes. This beta also changes the derived conversational contract version: earlier local 0.5 development databases rebuild on next session open, so source-backed utterances do not require external truth verification. This can incur embedding cost. V1 file archives are a different format and are not automatically imported.

## Fail-soft host integration

Continue with recent context if recall fails or `trace.error` is present. Return a valid Main LLM response even if memory saving/indexing fails. Log errors without disclosing provider keys or private conversation text. The [runnable example](../examples-product/openai-compatible-chat.mjs) demonstrates these host responsibilities with independent chat and embedding endpoints.

Use one writer per local database in normal deployment. SQLite transactions protect atomic paired transcript saves; this SDK is not a distributed multi-writer coordination service. Scopes are selected by the application, not inferred from an API token. The generic example is text-only, non-streaming; applications can integrate the same SDK around their own streaming completion lifecycle.
