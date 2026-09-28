# Topic Memory

Version 0.3.0 adds Topic Families with source-cited links and optional semantic candidate search. In a small real-model retrieval check, the current Worker and Selector recovered all required originals for two questions even though related subjects were grouped imperfectly. This is not a long-history or answer-quality benchmark. No long-context advantage or total-token saving has been established. See [evaluation status](./docs/EVALUATION.md).

Local conversation originals, short topic indexes, and on-demand recall.

[中文](./README.zh-CN.md) · [Installation](./docs/PLUGIN.md) · [SDK](./docs/USAGE.md) · [Test results](./docs/EVALUATION.md)

**0.3.0 is experimental.** It has a TypeScript core and a Codex plugin. You continue chatting in the host application; there is no separate chat or configuration page.

A completed exchange is saved with its timestamps. A Topic Worker indexes new records in batches. When the host model requests memory, a Selector reads short topic cards and returns selected original records. Worker and Selector can use the same model.

## Use with Codex

Prerequisites: Node.js 20.6+, a Codex CLI supporting plugins and hooks, and your own working model access. Native installation and recall were tested on Windows with Codex CLI **0.155.0-alpha.2.6**, Node **24.15.0**, and **gpt-5.6-luna**. Other versions are unverified.

After downloading and extracting this source revision, open a terminal in its folder:

```powershell
npm.cmd ci
npm.cmd run build:native
node integrations/runtime/cli.mjs configure --provider codex --model gpt-5.6-luna
node integrations/runtime/cli.mjs install-codex
```

Choose a model available to your own Codex account. The configuration above uses your existing Codex login and its quota; it does not require the author's API key. Restart Codex and approve the plugin's two capture hooks and memory tools when prompted. Continue chatting in the same project directory.

The [installation guide](./docs/PLUGIN.md) covers other providers, data location and removal. Claude Code has a packaged adapter and protocol checks, **not a live Claude validation**. ChatGPT's ordinary chat interface and every VS Code assistant are not covered by this test.

## Earlier segment-only test

A small live test used 12 authored user prompts, real Luna replies, real indexing and real retrieval in fresh contexts. Both Topic Memory and a simpler fixed-chunk keyword-search baseline answered **6/6 historical questions**; without history, the model answered **0/6**. Both retrieval methods abstained on an unknown fact and skipped retrieval for two ordinary questions.

Including indexing and selection, Topic Memory used **128,607 input + output tokens** for the successful run, versus **111,856** for the simpler baseline. These are reported token counts, not prices. This sample demonstrates recovery of unavailable history; **it does not establish token savings, superiority over simple search, or a model's maximum memory length**. See the [protocol, costs and limitations](./docs/EVALUATION.md).

## Developer use

Import `createTopicMemory` and give it persistent storage plus your own model adapter. Your application saves completed exchanges, schedules indexing, and exposes recall as a model tool. It keeps control of the main model's normal context. See the [SDK guide](./docs/USAGE.md).

Defaults: index after 8 unindexed exchanges, drain ready batches in the background, select at most 3 topics per directory page, and page long original text explicitly. If a selected topic is too long for one evidence page, a local word match can start the page at the matching original; `memory_open` at offset 0 still reads the complete family in the requested order. A temporary transport failure gets at most one delayed automatic retry on a later indexing opportunity; invalid semantic output is not retried automatically. There is no per-turn Selector call or inspection of hidden model reasoning.

## Data

Original text is stored locally, unencrypted, under `~/.topic-memory`, separated by project path. New batches and selected evidence are sent to your configured model provider. Secrets use an environment variable, not a shared key. Uninstalling the plugin does not delete the archive.

## Development

```bash
npm ci
npm test
npm run smoke:consumer
```

Program tests and package checks are separate from live model evaluation. Older 0.2 gateway, site, demo and evaluation sources remain in this checkout as legacy material; they are not the 0.3 installation path. The 0.3 package excludes the old gateway and demo examples. Existing `createMemory` SDK exports remain available.

MIT License.
