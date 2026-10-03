# Memory System V2 / 0.5.0-beta.2 preparation

The next package is `memory-system-v2@0.5.0-beta.2`. This update changes the product name and public onboarding. It does not change the memory engine or the existing storage format. Beta.2 has not been published to npm and has no release tag. Follow the [Quick Start](../README.md) for the current GitHub installation path.

The existing [v0.5.0-beta.1 GitHub release](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.1) remains at `d5a8781afe7beba6f45df2d7010a216fe57fd940`, with its original `memory-system-mvp-0.5.0-beta.1.tgz` artifact. It is not replaced or renamed by this preparation. Neither package version has been published to npm.

## Beta.2 changes

- Display name: Memory System V2. Upcoming npm package name: `memory-system-v2`.
- Complete English and Chinese instructions for installing, configuring embeddings, saving a conversation and printing recalled original messages.
- Simpler descriptions of what the SDK does, its limitations and how applications use the returned evidence.
- Correct public V1, research and beta.1 references. Existing benchmark results remain unchanged.

## Memory behavior introduced in beta.1

- Authoritative exact paired transcript persistence before derived indexing.
- Stable owner/session/turn/role/source modeling and exact-source resolution.
- Explicit source-ID corrections covering both roles, historical recall, logical turn erasure and predecessor restoration.
- Recovery/rebuild from retained original sources and embedding identity checks.
- Bounded evidence, marked exact prefix excerpts, retrieval trace and recent-turn exclusions.
- A conversational SDK and generic OpenAI-compatible integration example; private application validation is retained privately.

## Uses and adapts from LongMemory

The runtime is built on and extends source pinned to `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`. LongMemory supplies embedding providers, semantic retrieval, derived memory relationships, temporal machinery and SQLite persistence. Five imported files have targeted adaptations listed in [ATTRIBUTION](../ATTRIBUTION.md); the project does not claim those upstream algorithms as original. The conversation integration layer is in `src/product/`.

## Lessons carried forward from Generation 1

The independently designed topic system explored short indexes followed by original-text expansion. Experiments exposed generation cost, unstable boundaries, retrieval reliability and integration limits. Memory System V2 follows its requirements while replacing its runtime. The public [legacy-v1 release](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/legacy-v1) preserves the earlier plugin at `33b90322c0747943766c3477ccce10753cb554d7`. The later experimental 0.3 checkpoint is separately preserved at [research-v1-0.3](https://github.com/ziningshu-code/memory-system-mvp/tree/research-v1-0.3), `f0c1991e443a8c1870c9e8c5a72166c6108c44a4`; it was not an npm release.

## Validation and known limitations

The frozen beta.1 benchmark uses 200 authored synthetic exchanges across eight scopes (25 exchanges per scope), 400 messages and 50 queries with real NVIDIA embeddings. It makes no Main LLM call. Shared ranked positive exact-user Recall@5 is 33/35 for the product and 21/35 upstream. Product case checks pass 48/50, with two Chinese-history/English-query misses; these include product lifecycle cases and are not answer accuracy. All 400 messages retain exact source text, and both systems have zero observed scope leakage. Product no-memory abstention is 4/4. Native grounding policies and correction hints differ. [Category metrics and raw results](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/RESULTS.md) disclose these differences and unsupported upstream APIs as N/A. Earlier 50-turn results are in-sample calibration. No parameter was tuned after the final result. The beta.2 preparation does not rerun this benchmark or claim a new retrieval improvement.

The beta requires Node 22/24 and a usable native SQLite dependency. It requires embeddings and has no bundled transparent proxy/setup UI. Relevance thresholds are provider/data dependent; recall may miss evidence or return distractors. Search is local and linear in session size. Evidence budgets use estimates and oversized sources return prefixes, so important trailing detail may be omitted. Corrections are explicit, not inferred universally. Logical erase does not wipe backups/free pages. Rebuilds can incur embedding cost. V1 data has no automatic migration. Host canonical-history commits and SDK saves are not one shared transaction; hosts must reconcile missed saves if needed.

## Public GitHub history

The public repository is [ziningshu-code/memory-system-mvp](https://github.com/ziningshu-code/memory-system-mvp), and `main` contains Generation 2. The separately published `legacy-v1`, `research-v1-0.3` and `v0.5.0-beta.1` tags retain their original snapshots. Product naming does not rename the GitHub repository. Generation numbering is separate from npm semantic versioning.

This cleanup does not publish to npm or create a beta.2 tag. No automatic npm publishing workflow is installed.
