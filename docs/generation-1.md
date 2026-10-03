# Generation 1: archived Topic Memory research

Generation 1 explored conversation memory through immutable originals, a Topic Worker, short topic cards, and an on-demand Selector. The public [legacy-v1 release](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/legacy-v1) preserves the earlier plugin at `33b90322c0747943766c3477ccce10753cb554d7`.

The later research checkpoint is separately preserved by [research-v1-0.3](https://github.com/ziningshu-code/memory-system-mvp/tree/research-v1-0.3) at `f0c1991e443a8c1870c9e8c5a72166c6108c44a4`. Its package identifies itself as experimental `topic-memory` version `0.3.0`; that version was not an npm release. The local `checkpoint/unpublished-0.3-20260928` branch also retains this checkpoint. The experiments below describe that research snapshot, not the contents of the public `legacy-v1` release. Memory System V2 has a different entry point and data model.

## What the checkpoint actually contains

| Experiment | Archived source | Implemented behavior |
| --- | --- | --- |
| Topic Worker and Selector | `src/topic-memory.ts` | Save exact completed exchanges; index new batches, defaulting to eight exchanges; ask a model to select short cards only when the host requests historical recall; open selected original text under a bounded evidence budget. |
| Topic Families | `src/families.ts`, `src/family-links.ts` | Group immutable segments using source-cited `same_event`, `related`, and `separate` links; validate quoted excerpts and reject conflicting identities. Rank candidates using local card/original keywords and optional cached card vectors, with bounded recency, recurrence, and length adjustments. |
| Evidence paging | `src/topic-memory.ts` | Open originals in earliest/latest order, seek a matching middle record in a large family, and provide bounded first/latest comparison windows. Further pages remain available through explicit offsets. |
| Incremental indexing | `src/incremental.ts` | Index only new batches, preserve previously accepted segments, keep raw lexical retrieval available, and suppress repeated model work on unchanged or failed inputs unless retry is requested. This was an additional exported engine, not the native plugin's default path. |
| Retrieval arms B/C/D | `src/experimental-retrieval.ts` | B searches raw originals lexically. C combines raw lexical and validated raw-vector ranks. D adds topic-card pointers to those candidates. All return source-linked original evidence with one shared budget and an omission trace. These were opt-in experiments, not the plugin's default recall. |
| Explicit budgets | `src/budget.ts` | Count a supplied model's tokens when a counter is provided; otherwise use UTF-8 bytes and report that unit explicitly. |
| Native adapters | `integrations/codex/topic-memory/`, `integrations/claude-code/topic-memory/`, `integrations/runtime/` | Capture completed visible exchanges through hooks and expose MCP search/open tools. The archive records a live Windows Codex check; the Claude Code adapter had protocol checks but no live validation. |

These are implemented experiments with source and program tests. They do not establish that the grouping model was semantically reliable, that the architecture reduced total cost, or that it extended a model's context window.

## Evidence and limits

The archived `docs/EVALUATION.md` separates two small live checks:

- An earlier segment-only run used twelve authored prompts and real model replies. Topic Memory and fixed-chunk keyword search both answered six of six historical questions. Including indexing and selection, the successful Topic Memory run used 128,607 reported input/output tokens, versus 111,856 for keyword search. The family implementation cannot inherit this result as its own evaluation.
- A later family check used eight authored user/assistant pairs and real NVIDIA Worker/Selector calls. Each of two questions recovered its three required originals. No main-model final answers were tested. The accepted run reported 2,911 input and 2,536 output tokens across one Worker and two Selector requests.

The reported 200-record regressions were offline program checks of indexing and paging, not 200 live chat turns. The archive describes an unfinished LoCoMo comparison; it provides no completed long-history accuracy result, maximum stable history length, blind comparison, or demonstrated total-token saving. The B/C/D retrieval arms have program tests, but no completed live comparative result is claimed here.

Read the research checkpoint's [evaluation guide](https://github.com/ziningshu-code/memory-system-mvp/blob/research-v1-0.3/docs/EVALUATION.md), `docs/evaluation/live-0.3.json`, and `tests/` for the original protocols and qualifications. Older scripted fixtures are mechanics checks, not model-quality evidence.

## Preservation and subsequent prototypes

The public `legacy-v1` tag and `legacy/generation-1` branch point to the earlier 0.2 plugin baseline, `33b90322c0747943766c3477ccce10753cb554d7`. The separate `research-v1-0.3` tag preserves the later Topic Families, incremental indexing, retrieval arms, native adapters, and their tests at `f0c1991e443a8c1870c9e8c5a72166c6108c44a4`.

A separate transcript-only prototype continued through `3debf037ad34c4dd04073d24599228998dc35c20` on `work/local-transcript-memory`. Its existing checkpoints are `pre-upstream-integration-1582571` at `15825713e0b941c06eb1844fd058b649ea4cfc5c` and `pre-architecture-recomparison-8c9412e` at `8c9412ee6a04ccca15f1e25445ac913e1144d83c`. This prototype is a distinct historical approach; it is not the current LongMemory-based product.

The generations do not share a supported automatic data migration. Preserve a copy of legacy archives before inspecting them with another implementation. See [project evolution](./project-evolution.md) for the current generation and upstream relationship.
