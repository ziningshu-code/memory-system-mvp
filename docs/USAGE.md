# Core SDK

Use the new `createTopicMemory` API for on-demand memory. The host owns its main-model conversation, tool calls and normal context. Existing `createMemory` is the 0.2 API and retains its earlier behavior.

```ts
import {
  createTopicMemory,
  createOpenAICompatibleMemoryLlm,
  MEMORY_TOOL_GUIDANCE,
} from 'topic-memory';
import { FileMemoryStorage } from 'topic-memory/node';

const memory = createTopicMemory({
  storage: new FileMemoryStorage('./data/conversation.json'),
  llm: createOpenAICompatibleMemoryLlm({
    baseUrl: process.env.MODEL_BASE_URL!,
    model: process.env.MODEL_NAME!,
    apiKey: process.env.TOPIC_MEMORY_API_KEY,
  }),
});

// After your real main-model response completes:
await memory.append({
  sourceId: hostTurnId,
  userText,
  assistantText,
  userSentAt,
  assistantCompletedAt,
});

// Schedule this outside the interactive response path.
// It does not call the model before the batch gate is reached.
await memory.index();

// Expose these operations through your host's model-tool mechanism:
const memorySearch = (query: string, directoryOffset = 0) =>
  memory.recall({ query, directoryOffset });
const memoryOpen = (topicIds: string[], offset = 0, order: 'earliest' | 'latest' = 'earliest') =>
  memory.open(topicIds, offset, order);

// Add MEMORY_TOOL_GUIDANCE to the host's memory-tool instructions.
// Return the tool result to the main model; let it answer from the originals.
```

The snippet is an integration pattern; `hostTurnId`, message text and timestamps come from your application. It does not create a chatbot or synthesize conversations. A host must actually register and execute tools for the model; importing this module alone does not do that.

One model adapter handles both indexing and selection by default. Separate `topicWorker` and `selector` adapters are optional. Supply your own `MemoryLlm.complete` implementation for providers that do not implement Chat Completions. Do not mix users in one store.

Family mode is the default. The Worker returns `{topics, assignments, links}`. A card contains a short subject `scope`, `labelTerms` and `retrievalTerms` to help locate originals; its boundary is approximate. Each assignment is `{sequence, topicIndex, change}`; every supplied sequence appears once. Change is `continuation`, `addition`, `revision`, or `negation`. A link is `{fromTopic, toTopic, kind, sequence, quote}` for two new cards, or uses `toFamily` for a supplied existing family ID. `kind` is `same_event`, `related`, or `separate`. `quote` must be an exact excerpt from the assigned original record. The core checks references, source provenance and conflicting relations, derives family IDs and spans, and preserves old segments. A valid quote supports auditing; it does not prove that the model's semantic judgment is correct. Proper names should retain source spelling.

Extra short labels may be joined without discarding text to fit the card's field count. This deterministic formatting step never invents a category or repairs a missing record assignment; oversized cards still fail explicitly.

Set `familyMode:false` to use the earlier segment-only protocol, including legacy custom workers returning explicit spans or `{sequence,topicIndex}` assignments and `relatedTopicIds`. Do not mix protocol versions. After correcting a failed Worker, retry the same pending batch explicitly with `index({flush:true, retryFailed:true})`.

For a compatible endpoint, `createOpenAICompatibleMemoryLlm({..., jsonMode:true})` adds `response_format:{type:'json_object'}`. It is opt-in, because not every compatible endpoint supports it. `reasoningEffort` can be supplied for endpoints that support that parameter. Configure `workerMaxTokens` and `selectorMaxTokens` on `createTopicMemory` when a reasoning model consumes output allowance before producing JSON. Unsupported responses and truncated outputs fail explicitly, without retry or downgrade. JSON mode does not guarantee correct topic semantics; normal validation still applies.

## Operations

- `append`: saves a completed pair and timestamps, without inference. Repeating an identical source ID is idempotent; changing its original text is rejected.
- `index`: indexes up to one batch of unseen records. `flush: true` processes a short trailing batch. Inspect `reason` and `run.validationStatus`. Use `retryFailed: true` only for an intentional retry after fixing a failure.
- `recall`: one directory-selection request, with a second original-inspection request only if the Selector asks for it. When it requests `includeRelated`, related families may fill unused selection slots; omitted links appear in the trace and prevent a completeness claim. If a selected family exceeds the evidence budget, a local word match can start its first evidence page at the matching original; `unreadPrefix` marks records skipped before that page in its selected order. Long original-versus-revised questions may return two bounded windows, one from each end.
- `open`: accepts a family ID or segment ID, returns exact serialized originals with sequence numbers and timestamps; no model call.
- `directory` and `status`: inspect local index state without a model call.
- `familyDirectory(query, offset)`: returns ranked family candidates and remaining-page metadata. Optional query embeddings may call the supplied embedding provider.

If selected evidence is insufficient, follow `nextDirectoryOffset` with the same query. Follow an evidence record's `nextOffset` using `open([topicId], nextOffset, evidence.order ?? 'earliest')`. When `unreadPrefix` is true, `open([topicId], 0, evidence.order ?? 'earliest')` reads the preceding originals in that order. `spansOmitted:true` means the full interleaved span list was left out to preserve evidence budget; `spanCount` reports its size and each returned original still carries its sequence and timestamps. Keep the archive and ordering unchanged while assembling pages. Pages are exact substrings and may split a serialized JSON record; concatenate them if complete JSONL records are needed. A transport `complete` flag is not a semantic retrieval guarantee.

## Optional semantic candidates

Pass `embedding:{id, embed(texts, inputType)}` to `createTopicMemory`. The adapter returns one finite, nonzero vector per text, all of the same dimension. `inputType` is `passage` for new keyword cards or `query` for candidate searches. The ID must identify provider, model and dimension; change it when any of those change. Vectors are stored with card text and reused across restarts. Existing cards are not automatically re-embedded. This extra model access is optional; no author-owned credential is required. Native adapters currently use local keyword candidates by default.

Embedding errors fall back to keywords and appear in Worker warnings or search trace. Keyword search also checks local originals, so an exact detail omitted from a card can still nominate its family. Neither candidate scores nor the recency/frequency/length heuristic are truth probabilities. See [architecture](./ARCHITECTURE.md) for the bounded weighting rule and limitations.

## Limits and failure handling

Defaults are 8 exchanges per batch, 10 Worker candidate families, 12 Selector candidate families per page and at most 3 selected families; budgets are 32,000 for Worker, 24,000 for directory cards and 24,000 for evidence. The separate model output allowances default to 2,400 for Worker and 300 for Selector; these may need adjustment for reasoning models. Without a supplied `tokenCounter`, a budget unit is a UTF-8 byte, **not an estimated token**. Query text, response metadata and provider instructions can add overhead. The Worker reserves room for candidates, so some records below the total request budget may still remain pending.

Very long records remain unindexed when they cannot fit a Worker request; they are not silently truncated and marked complete. Unindexed cards contain only a short preview, so recall can miss facts outside it. The original is still available through `open`. A directory may need multiple searches as the archive grows.

Invalid model JSON, missing/overlapping spans and unknown IDs are rejected. Check error fields; do not turn a provider failure into a claim that the user never said something. An unchanged failed indexing input is not automatically retried. No guarantee is made that a host model will always decide to search.

The in-process core serializes its mutations. The basic file store is not a distributed database: use one writer per store, or provide transactional storage. Native adapters add local inter-process locks and isolate archives by project path. Files are unencrypted and are read as snapshots; large-archive I/O scalability is unmeasured.
