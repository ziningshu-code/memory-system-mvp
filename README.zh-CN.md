# Memory System V2

Memory System V2 给 Node.js 聊天应用增加长期记忆。

它保存用户和助手实际看到的消息，通过 embedding 找到可能有用的旧对话，再把原文交给应用作为历史证据。应用继续使用自己的聊天模型。

- 把对话原文保存在本地 SQLite 文件中。
- 找回旧消息，返回原文和来源编号。
- 通过应用提供的用户、会话编号分开保存和检索。
- 信息发生变化时，记录应用明确指定的更正。
- 从保存的原文重建搜索数据。

[English README](README.md)

## 快速开始

下面从一个空文件夹开始：保存一段关于航班时间的对话，再检索并打印用户原话。示例会调用真实的 embedding API，不会调用聊天模型。

### 1. 安装 Node.js 和 Git

安装 [Node.js](https://nodejs.org/en/download) **22 或 24**。当前从 GitHub 安装还需要 [Git](https://git-scm.com/downloads)。安装后检查：

```sh
node --version
npm --version
git --version
```

### 2. 建立测试项目

```sh
mkdir memory-v2-demo
cd memory-v2-demo
npm init -y
```

### 3. 从 GitHub 安装

当前 `main` 分支准备的是 **memory-system-v2 0.5.0-beta.2**。下面的命令从源码安装，npm 会在安装过程中构建 SDK：

```sh
npm install "git+https://github.com/ziningshu-code/memory-system-mvp.git#main"
```

新包名还没有发布到 npm。已有的 [beta.1 发布](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.1)保留原来的包名和下载文件，是单独的历史版本，本次不会改动。

### 4. 配置 NVIDIA embeddings

在 [NVIDIA 模型页面](https://build.nvidia.com/nvidia/nemotron-3-embed-1b)获取 API Key。在 `memory-v2-demo` 文件夹中新建 `.env`，把下面的占位内容替换为自己的 Key：

```dotenv
EMBED_API_KEY=your_nvidia_api_key
```

示例使用 **`nvidia/nemotron-3-embed-1b`**，每个 embedding 的向量维度是 **2048**。SDK 的 NVIDIA 适配器会设置查询与正文所需的请求选项。保存的消息和检索问题会发送到 **`https://integrate.api.nvidia.com/v1/embeddings`**。Embedding 请求可能产生服务商费用；这个示例不需要聊天模型的 API Key。请保管好 `.env`，不要把它提交到版本库。

### 5. 保存消息并找回原文

在同一个文件夹中新建 `demo.mjs`，复制以下完整代码。测试内容与英文版相同，方便直接核对运行结果：

```js
import { createMemory } from 'memory-system-v2';

if (!process.env.EMBED_API_KEY) {
  throw new Error('Set EMBED_API_KEY in .env first');
}

const memory = createMemory({
  dbPath: './memory.sqlite',
  embedding: {
    kind: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-embed-1b',
    dimension: 2048,
    apiKey: process.env.EMBED_API_KEY,
  },
});

try {
  const saved = await memory.remember({
    sessionId: 'flight-demo',
    turnId: 'flight-1',
    user: 'My flight leaves at 7:40 tomorrow morning.',
    assistant: 'Understood: your flight leaves at 7:40 tomorrow morning.',
  });
  if (saved.failed.length) throw new Error('Embedding failed; original messages were saved. Check your provider/key and rerun.');

  const recalled = await memory.recall({
    sessionId: 'flight-demo',
    query: 'What time is my flight?',
  });
  if (recalled.trace.error) throw new Error(recalled.trace.error);
  const original = recalled.sources.find(source => source.sourceId === 'flight-1:user');
  if (!original) throw new Error('The flight message was not retrieved');
  console.log('Source:', original.sourceId);
  console.log('Original message:', original.text);
} finally {
  await memory.close();
}
```

运行时从 `.env` 读取 Key：

```sh
node --env-file=.env demo.mjs
```

输出会包含来源编号，以及“我的航班明早 7:40 起飞”这条消息的英文原文：

```text
Source: flight-1:user
Original message: My flight leaves at 7:40 tomorrow morning.
```

`recall()` 返回的是旧对话证据，**不会生成最终回答**。示例中的助手消息是固定测试内容，不是模型生成的回复。接入实际应用时，应在自己的聊天模型完成回答后保存真实的用户消息和助手回复：

```text
user message → memory.recall() → relevant old messages
             → your existing chat model → assistant reply → memory.remember()
```

[聊天接入示例](examples-product/openai-compatible-chat.mjs)展示了完整流程，聊天与 embedding 的凭据分开配置。该示例默认使用标准 OpenAI-compatible embedding 接口；接入 NVIDIA 时，把它的 embedding 配置替换为上面的配置。更正、排除近期消息和失败处理见 [SDK 文档](docs/sdk.md)。

## npm 发布后的安装方式

以下是计划中的命令，**现在还不能使用**。正式宣布 npm 发布前，请使用上面的 GitHub 安装命令：

```sh
npm install memory-system-v2@beta
```

## 能做什么，有哪些限制

它在本地保存可见对话，检索原文，支持明确指定的更正，并能重建搜索数据。记忆管理**不会额外调用生成模型**，但 embedding API 仍可能消耗 token 和产生费用。

它不替代聊天模型，不会单独生成答案，不提供托管记忆服务，也不会自动识别所有矛盾或保证每次都能找到正确历史。当前产品是 Node SDK，没有附带代理服务器、配置页面或浏览器 SDK。

## 工作方式

```text
Conversation → Saved original messages → Embeddings + LongMemory search state
             → Recall → Original matching messages
```

保存的原始对话是事实来源。搜索结果通过来源编号回到这些消息；搜索数据可以重建，不能替代原文。两者保存在同一个本地 SQLite 文件中。示例指定 `./memory.sqlite`；为兼容已有数据，SDK 默认路径仍为 `~/.memory-system-mvp/memory.sqlite`。

返回的历史证据有大小限制，并附带来源编号和准确的文本范围。预算按 token 估算，不使用你的聊天模型的精确分词器。较长消息可能只返回标明范围的原文前缀；没有合适证据时也可以返回空结果。[SDK 文档](docs/sdk.md)和[隐私说明](docs/privacy.md)详细解释了这些限制，以及哪些数据会离开电脑。

## 其他 embedding 服务

可以配置兼容 OpenAI 的 **embeddings** 接口、本地 Ollama，或自己的 embedder。只有聊天接口并不够。请填写模型真实的名称与向量维度，不要把 NVIDIA 的参数照搬到其他模型。具体配置见 [embedding 配置](docs/sdk.md#embedding-configuration)和 [.env.example](.env.example)。使用本地 embedding 模型时，文本无需发送到外部服务。

## 验证结果

固定验证集包含：

- 200 轮合成对话、50 道标注查询。
- 在共同的 35 道指定来源检索题中，前五条结果命中原文的数量为 Memory System V2 **33/35**，固定版本上游为 **21/35**。
- 两边都完整恢复了 **400/400** 条保存的消息。

这是一个小规模合成测试，不能证明普遍优于 LongMemory。它测量的是检索能力，不是模型最终回答的准确率。完整方法与限制见[测试方法](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/README.md)和[结果报告](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/RESULTS.md)。

## 从 V1 到 V2

V1 采用 Topic Worker → Selector 的设计。测试暴露了额外生成调用、话题边界不稳定、检索遗漏和复杂度增加等问题。V2 保留这些实验形成的产品需求，用修改后的 LongMemory 核心与对话接入层替换了原来的运行机制。

公开的 [V1 发布](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/legacy-v1)对应 `33b90322c0747943766c3477ccce10753cb554d7`；公开的 [V2 beta.1](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.1)对应 `d5a8781afe7beba6f45df2d7010a216fe57fd940`。当前分支准备 beta.2，不改动这两个发布版本。更多历史见[项目演变](docs/project-evolution.md)。

## LongMemory 来源与许可

Memory System V2 使用了经过修改的开源 [LongMemory 核心](https://github.com/CaviraOSS/LongMemory)。Embedding、语义检索和时间记忆机制主要来自 LongMemory。本项目增加了对话保存及上述面向应用的行为。

上游固定版本为 [9ee2c8e](https://github.com/CaviraOSS/LongMemory/tree/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5)。代码归属和修改说明见 [ATTRIBUTION](ATTRIBUTION.md)、[NOTICE](NOTICE)、本项目的 [MIT 许可](LICENSE)和 LongMemory 的 [Apache-2.0 许可](UPSTREAM-LONGMEMORY-LICENSE)。

## 开发检查

```sh
npm ci
npm run typecheck
npm test
npm run smoke:consumer
npm pack
```

CI 覆盖 Node 22/24 与 Windows/Linux，没有自动发布工作流。[版本说明](docs/release-notes.md)。
