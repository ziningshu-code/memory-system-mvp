# Local conversation memory SDK (development build)

This branch builds a local TypeScript/Node memory SDK from audited [LongMemory source](https://github.com/CaviraOSS/LongMemory/tree/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5). It is **not yet published to npm or pushed to GitHub**. The current package can be tested with `npm pack` and installed from the resulting `.tgz` file.

The application supplies its own chat model. This package stores exact visible user and assistant text in a local SQLite file first, then builds LongMemory nodes and embeddings in the same file. Retrieval ranks derived nodes and returns exact original source text with IDs and timestamps. No generative memory-model call is made by this SDK. A real embedding endpoint or model is required.

## Use in a Node application

```js
import { createMemory } from 'memory-system-mvp';

const memory = createMemory({
  embedding: {
    kind: 'openai',
    baseUrl: 'https://your-embedding-provider.example/v1',
    model: 'your-embedding-model',
    apiKey: process.env.EMBED_API_KEY,
    dimension: 1024, // use the model's actual dimension
  },
});

const sessionId = 'a-stable-chat-id';
const recalled = await memory.recall({ sessionId, query: 'Which hotel did I choose?' });
// Put recalled.context in a separate system/developer message to your chat model.
// Keep the application's ordinary recent messages separate.
const answer = await yourChatModel(recalled.context);
await memory.remember({ sessionId, user: 'Which hotel did I choose?', assistant: answer });
await memory.close();
```

The runnable [OpenAI-compatible chat example](examples-product/openai-compatible-chat.mjs) shows the full request, response, and save sequence. Other embedding choices are `nvidia`, `ollama`, and an explicitly supplied `custom` provider. The embedding service may be different from the chat service; a chat API does not necessarily offer embeddings.

`recall()` returns `context`, exact `sources` with IDs, and a `trace` of ranked, rejected, and budget-omitted candidates. `maxEvidenceTokens` bounds the actual injected text. A long source may be returned as a marked exact prefix excerpt with character offsets; the SDK never labels an excerpt as the complete source. The default database path is `~/.memory-system-mvp/memory.sqlite`; set `dbPath` to choose another local location.

`remember()` saves both visible messages in one SQLite transaction **before** embedding. If embedding fails, it reports failed source IDs while keeping the exact transcript. `rebuild(sessionId)` retries derived indexing from the saved sources. A provider/model/dimension change triggers a derived-index rebuild on the next session open. `erase({sessionId, sourceId})` logically deletes the completed user/assistant turn containing that source: it removes both messages from normal history and recall, clears their text, repairs explicit correction chains, and rebuilds the session's derived state. If the same information appears in another turn, erase that turn separately. This does not promise forensic deletion of SQLite free pages, WAL files, or backups.

To record a deliberate correction, use `remember({sessionId, user, assistant, supersedesSourceId})`. The source ID identifies the older completed turn; the new user and assistant sources explicitly replace the corresponding older sources. This prevents an assistant echo of an obsolete fact from remaining current. Erasing a newer correction restores the nearest surviving predecessor turn; erasing an older turn keeps its surviving successor active. `recall({sessionId, query, asOf})` can inspect the remaining recorded history at an earlier time. `validFrom` and `validAt` are for explicitly evidenced validity dates; the SDK does not infer those dates. Automatic contradiction resolution and decay are disabled.

## Development checks

```text
npm install
npm test
npm pack
```

The deterministic suite uses a fixed test embedder. A separate NVIDIA embedding integration script uses a local `.env` file and is not part of `npm test`; its API key is never stored in the package. The audited LongMemory GitHub revision differs materially from the npm package currently named `longmemory`, so this package contains attributed source rather than depending on that registry package. See [ATTRIBUTION.md](ATTRIBUTION.md) and [UPSTREAM-LONGMEMORY-LICENSE](UPSTREAM-LONGMEMORY-LICENSE).

Current limitations: the local vector search is linear in the session's memory size; semantic relevance thresholds need calibration for providers other than the tested NVIDIA model; the package is an SDK and does not yet include a transparent local proxy or setup page; installation depends on the native `better-sqlite3` package, whose binary or build toolchain must be available for the user's Node version.
