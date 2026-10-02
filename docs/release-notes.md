# Generation 2 / 0.5.0-beta.1

Prepared locally. No npm publication, GitHub push, public release, or visibility change has been performed.

## Generation 2 adds

- Authoritative exact paired transcript persistence before derived indexing.
- Stable owner/session/turn/role/source modeling and exact-source resolution.
- Explicit source-ID corrections covering both roles, historical recall, logical turn erasure and predecessor restoration.
- Recovery/rebuild from retained original sources and embedding identity checks.
- Bounded evidence, marked exact prefix excerpts, retrieval trace and recent-turn exclusions.
- A conversational SDK and generic OpenAI-compatible integration example; private application validation is retained privately.

## Uses and adapts from LongMemory

The runtime is built on and extends source pinned to `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`. LongMemory supplies embedding providers, semantic retrieval, derived memory relationships, temporal machinery and SQLite persistence. Five imported files have targeted adaptations listed in [ATTRIBUTION](../ATTRIBUTION.md); the project does not claim those upstream algorithms as original. The conversation integration layer is in `src/product/`.

## Lessons carried forward from Generation 1

The independently designed topic system explored short indexes followed by original-text expansion. Experiments exposed generation cost, unstable boundaries, retrieval reliability and integration limits. Generation 2 follows its requirements while replacing its runtime. The actual unpublished research checkpoint is preserved at local tag `legacy-v1` (`f0c1991e443a8c1870c9e8c5a72166c6108c44a4`), pending separate publication.

## Validation and known limitations

The frozen benchmark uses 200 authored synthetic exchanges across eight scopes (25 exchanges per scope), 400 messages and 50 queries with real NVIDIA embeddings. It makes no Main LLM call. Shared ranked positive exact-user Recall@5 is 33/35 for the product and 21/35 upstream. Product case checks pass 48/50, with two Chinese-history/English-query misses; these include product lifecycle cases and are not answer accuracy. All 400 messages retain exact source text, and both systems have zero observed scope leakage. Product no-memory abstention is 4/4. Native grounding policies and correction hints differ. [Category metrics and raw results](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/RESULTS.md) disclose these differences and unsupported upstream APIs as N/A; links become available after publication. Earlier 50-turn results are in-sample calibration. No parameter was tuned after the final result.

The beta requires Node 22/24 and a usable native SQLite dependency. It requires embeddings and has no bundled transparent proxy/setup UI. Relevance thresholds are provider/data dependent; recall may miss evidence or return distractors. Search is local and linear in session size. Evidence budgets use estimates and oversized sources return prefixes, so important trailing detail may be omitted. Corrections are explicit, not inferred universally. Logical erase does not wipe backups/free pages. Rebuilds can incur embedding cost. V1 data has no automatic migration. Host canonical-history commits and SDK saves are not one shared transaction; hosts must reconcile missed saves if needed.

## Planned GitHub structure after approval

The default branch will contain Generation 2. Publish `legacy-v1` separately so the genuine earlier branch remains reachable; V1 is not an ancestor of the V2 work branch. The current-generation release tag will match `v0.5.0-beta.1`. Include the inspected `.tgz`, these release notes and the raw synthetic benchmark results. Generation numbering is separate from npm semantic versioning.

Publication requires a separate explicit action after review. No automatic publishing workflow is installed.
