# Evaluation / 效果验证

## v0.2 plugin diagnostics

The local plugin offers real-model testing on its setup page without `.env` editing. Save your model settings, then run the comparison; alternatively run `npm run evaluate:plugin`. The live test performs repeated topic indexing during sequential ingestion (turns 6, 9, 12, 15, 18, 21 and 24), and compares four questions against recent-five/full-transcript/topic-memory context. Reports include raw answers, worker errors and all provider calls. It uses synthetic material but real models for indexing, selection and answers. See [plugin guide](./PLUGIN.md).

On 2026-09-17, the v0.2 source passed 21 automated tests and an installed-package startup check locally on Windows/Node 24. These tests use controlled local providers to check protocols and logic, not model quality. The interleaved-topic regression checks that early open-topic spans remain indexed when a later topic is finalized. File persistence, restart recovery, session isolation, request serialization, local authentication and SSE format are also exercised. CI validates the release commit separately.

No general model-accuracy or cost-improvement claim follows from these tests. A live report is not available until a user configures a provider and runs it.

## Earlier v0.1 evidence

On 2026-09-13, the public `topic-memory@0.1.0` package was installed into a fresh Node 24 project and used to retrieve an old hotel exchange with a scripted model adapter. The source build, 14 existing SDK tests and fresh-consumer tarball test passed locally on Windows. See CI for checks against the latest revision.

The checked-in [scripted result](./evaluation/scripted.json) covers four cases: Tokyo hotel details, a food allergy, a project decision, and an unknown passport number. The three positive facts occur outside the most recent five exchanges.

**These checks demonstrate mechanics. They do not establish real-model accuracy, latency, token savings, production readiness, or performance on long conversations.** No real-model result is published here yet.

中文：已验证公开包的安装和预设响应下的原文恢复。预设测试不等于真实模型效果；目前还没有发布真实模型的准确率、速度或费用结论。

## Reproduce the scripted checks

```bash
npm ci
npm run evaluate
```

The SDK ingests a public, synthetic, 24-exchange conversation. Its actual topic validation and span recovery run normally. Worker topic boundaries and selector choices are scripted. This makes the walkthrough stable and useful for debugging the integration, while explicitly removing model quality from the test.

For the missing fact, the scripted selector chooses no topic and the SDK returns an empty `memoryContext`. This does not prove that an arbitrary main model will abstain.

## Run the real-model comparison

Requires Node 20.6+. Copy `.env.example` to `.env`, configure your provider, then run:

```bash
npm run evaluate:live
```

The command makes real provider requests and may incur charges. It sends only the checked-in synthetic dataset and questions, not private chat history. The API key stays in the request header and is not written into the report. Output is saved locally to the ignored `benchmark-results/live.json` file.

The small comparison uses the **same final-answer model, system instruction and question** for:

1. **Recent five:** only the latest five exchanges.
2. **Full transcript:** all 24 exchanges.
3. **Topic memory:** the latest five exchanges plus SDK-retrieved original topic packets.

The live worker constructs topics in one batch over the archive. The selector uses the actual model for each question. Questions are independent: their answers are not added back into the archive. Expected answers and scoring rules are never included in the model's input.

The run normally makes 1 worker request, 4 selector requests and 12 main-model requests (17 total). If topic construction fails, the report records this and the memory method can fall back to recent context; it is not silently counted as success.

## What the report measures

- Raw model answers for each question and method.
- A transparent literal check for the expected facts. For the unknown fact, a conservative English abstention pattern is checked. Read the answers: this is not a semantic judge and may score a valid paraphrase incorrectly or miss a contradiction.
- Selected topic IDs, recovered source text, expected evidence sequence numbers, and selector errors.
- Per-request elapsed milliseconds, including network latency.
- Input and output token usage **only when the provider reports it**. Missing usage is `null`, not zero.

For a fair total token comparison, count the one-time worker construction cost, all selector requests and all topic-memory main-model requests. Show construction separately if amortizing it across later queries. Do not compare the topic method's main-model tokens alone against a baseline's total spend. Prices are not hard-coded; apply the provider's actual rates to recorded usage if you need a monetary estimate.

The `memoryCharacters` and `selectorInputCharacters` fields are string lengths, **not token estimates**.

## Limits and next experiments

Four hand-written questions over 24 synthetic exchanges are a small integration evaluation. They are not representative of hundreds or thousands of turns. There is one run per method, no confidence interval, no summary/vector-search baseline, and no continuous-ingestion measurement.

Before making performance claims, add held-out conversation sets with updates to facts, interleaved topics, similar names, time questions, irrelevant questions, and materially longer archives. Repeat runs and disclose the models, prompts, failures and complete provider usage. Compare against a rolling-summary or retrieval baseline appropriate to the host application.

## The earlier 8.3× figure

The [architecture appendix](./ARCHITECTURE.md) contains a capacity calculation under assumed message and topic sizes. It is not an empirical result and must not be presented as measured memory accuracy or capacity improvement.

