# Validation status — 2026-09-27

Topic cards are short retrieval cues, not a claim that every conversation has one objectively correct grouping. The result that matters is whether the selected, timestamped originals contain the needed evidence within a bounded budget. The Worker indexes completed records in batches; the Selector runs only when the host requests historical memory. The core preserves old originals and validates card assignments and any source-cited links. Those structural checks cannot establish semantic accuracy.

The current code passed **95 core + 12 native program checks**. A fresh 232-file package installed in an empty directory and passed SDK persistence, exact-original, hook and bundled MCP checks. Offline regressions placed an answer in the middle of a 100-record family, covered 200 interleaved records whose span metadata could crowd out evidence, and checked first/latest plus two-ended comparison paging under a small budget. The public `open(offset)` interface still reconstructed the original archive in order. These check paging mechanics, not model reasoning or paraphrase retrieval.

On 2026-09-27, the shorter Worker prompt and Selector were called through the NVIDIA `nvidia/nemotron-3-super-120b-a12b` Chat Completions API on **eight authored user/assistant record pairs**. The Worker output was accepted. Two historical questions each required three specific saved records; both returned all three exact originals. The travel question returned five records in 1,465 evidence bytes, and the pet-care question returned six in 1,929 bytes, under the fixed 8,000-byte evidence limit. The former included two extra records and the latter three; extra evidence is a budget cost, not an automatic retrieval failure. This run made **one Worker and two Selector requests**, with provider-reported **2,911 input + 2,536 output tokens**. The subsequent long-page changes above were checked offline, not by another model call. No main-model final answers were tested.

An earlier Worker output had placed travel and pet-care records in one broad family. Replaying that saved output through the real current Selector also recovered all three required originals for each of the same two questions. It used three Selector requests, **2,314 input + 1,193 output tokens**, and returned roughly 1.7 KB of evidence per question. This is a diagnostic of the old grouping, not an independent long-history result. An initial sandboxed attempt could not reach the API and reported no usage; unknown usage is not counted as zero. Earlier Node transport timeouts and superseded exact-family-count gates are historical diagnostics, not current semantic failures.

These are small, authored replay checks, **not 200 live chat turns**. The planned LoCoMo long-history comparison has 355 saved records and 30 questions, of which 24 have annotated evidence; current-code full indexing, retrieval, final-answer quality and total-token comparison have not been completed. There is no measured maximum stable history length, verified advantage over simple or hybrid search, or proof of total token savings. Missing literal or card terms can still miss a middle record; cross-record comparisons can require more than one evidence page. Earlier segment-only results below use a different implementation and cannot be credited to this family version.

## Earlier segment-only live validation — 2026-09-18

This is a small development evaluation, not a population accuracy benchmark or a long-context limit measurement. Test scenarios are fictional and deliberately authored. Assistant replies, Topic Worker outputs, Selector outputs and final answers came from a real `gpt-5.6-luna` model through the existing Codex login.

## Protocol

Twelve authored user messages were submitted sequentially, with previous real replies available during normal conversation. The SDK saved those exact replies. Two successful Worker batches (8 + 4 exchanges) produced eight immutable topic cards. The final four-record batch was explicitly flushed by the harness. Record timestamps were fixed test metadata, not the wall clock of model generation.

Nine questions were then asked separately in fresh, ephemeral model contexts. Main-model native memory, shell, browsing, other plugins and unrelated tools were disabled for the formal comparison. Retrieval questions did not include their answers. The model chose when to invoke the memory tools.

Methods:

1. No previous history and no memory tools.
2. The same original archive in fixed four-exchange chunks, local keyword/BM25 search, up to three chunks; no Worker or Selector model.
3. The same archive through Topic Memory: short directory, model selection, optional original inspection, exact source return.

The six historical questions cover initial facts, current facts, changes, multiple topics, paraphrases and record times. One question asks for an absent flight number. Two ordinary questions check unnecessary retrieval. Literal checks were reviewed against the real answers and returned sources; an abstention wording missed by the initial checker was corrected without rerunning models.

## Results

| Method | Historical answers | Unknown fact | Ordinary questions without recall |
|---|---:|---|---:|
| No history | 0/6 | Abstained | 2/2 |
| Fixed chunks + keyword search | 6/6 | Abstained | 2/2 |
| Topic Memory | 6/6 | Abstained | 2/2 |

Both retrieval methods recovered unavailable history. This small archive did not demonstrate a quality advantage for the topic architecture over simple search.

## Complete token accounting

Reported input tokens include cached input. Reported output tokens include reasoning output; these are not added a second time. Shared history-generation cost is separated from the retrieval comparison.

| Stage | Input tokens | Output tokens |
|---|---:|---:|
| Shared 12-turn history generation | 29,360 | 648 |
| No-history answers | 33,816 | 938 |
| Keyword-search answers, including tool continuations | 110,347 | 1,509 |
| Topic Memory main answers, including tool continuations | 96,137 | 1,577 |
| Topic Memory Selector: 8 requests | 23,523 | 567 |
| Topic Memory Worker: 2 committed batches | 5,978 | 825 |
| Additional Worker attempt whose file commit failed | 2,967 | 404 |

Successful Topic Memory indexing + selection + answers total **128,607** input and output tokens, versus **111,856** for keyword search: about **15% more** in this sample. Including the failed Worker attempt, Topic Memory consumed **131,978**. Comparing only the main model would hide the additional memory-model cost.

Main-answer elapsed totals were 225 seconds for Topic Memory and 162 seconds for keyword search. These sequential single-run timings are not performance guarantees. Codex protocol and instruction overhead is included. No API dollar price or Plus quota conversion is inferred. Earlier transport/configuration probes are excluded from quality scores and retained in the private development ledger.

## Integration and packaging checks

The Windows native Codex check used separate real sessions: one saved a fictional identifier; a fresh session recovered it through an actual MCP call without the answer in the question. The same save/restart/retrieve flow was checked after installing the actual plugin bundle, without manually adding project hooks or MCP settings. Tested host: Codex CLI 0.155.0-alpha.2.6, Node 24.15.0.

Initial installation exposed a literal plugin-path placeholder problem; the installer now resolves that path on the user's machine. Windows transient file locking was also observed and handled with bounded retries. Early headless hook probes did not capture automatically; headless automatic capture is not claimed as supported.

Program tests cover exact originals, indexing gates, rejection, deduplication, frozen segments, interleaved spans, paging, persistence, concurrent capture, project isolation, MCP transport and installation conflicts. Package checks install the produced archive into an empty directory and run its own bundled code. Fixture-based program tests are not model-quality evidence.

Claude Code has no live validation. There is no measured maximum stable number of conversation turns, no claim that these 12 exchanges exceeded a context window, no long-term reliability estimate, and no verified superiority over built-in host memory.

The prior 0.2 scripted walkthrough and `docs/evaluation/scripted.json` are legacy mechanics fixtures. They do not support any of the live results above.

Machine-readable authored history, answers and usage: [live-0.3.json](./evaluation/live-0.3.json).
