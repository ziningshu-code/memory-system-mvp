# Topic Memory

**给现有 LLM 应用加上一层可插拔的长期对话记忆。**

[English](./README.md) · [详细接入指南](./docs/USAGE.zh-CN.md) · [架构与容量说明](./docs/ARCHITECTURE.zh-CN.md)

Topic Memory 是一个独立的 TypeScript SDK。它解决的不是“让模型拥有更大的 context window”，而是另一个更实际的问题：**当一段对话持续几百、几千轮以后，怎样让模型在需要时找回旧信息，而不是每次都把完整聊天记录重新塞进 prompt。**

它会保留完整的 Canonical Transcript，把较早的 completed exchanges 按 topic 组织成可检索的长期记忆；新消息到来时，只打开与当前问题相关的旧 topic，最后把恢复出的上下文作为 `memoryContext` 交给你自己的 Main LLM。

> **它是什么：** LLM 应用的长期记忆插件 / SDK。  
> **它不是什么：** 聊天机器人、模型供应商，也不会替代你的 Main LLM。

## 它可以用来做什么？

适合需要长期连续性的聊天、AI 朋友、Agent 或长期项目助手，例如记住：

- 用户长期偏好、习惯、人物、地点和个人背景；
- 几百甚至几千个 exchange 以前做过的决定；
- 项目历史、需求变更、以前尝试过的方法和未完成事项；
- 某次旧对话的具体措辞、事件顺序或时间信息；
- 任何不适合永久占用 Main LLM context window、但未来可能需要重新找回的信息。

它和“只维护一份不断覆盖的聊天摘要”不同：Topic Memory 会保留原始 Canonical Transcript。检索命中一个 topic 后，可以根据这个 topic 保存的 transcript spans 重新打开当时的原始对话，而不是只能依赖一段已经压缩过的 summary。

## 先搞清楚三个角色

这是 v0.1 最容易被误解的地方。

### Topic Worker

Topic Worker 不负责回复用户。

它在对话进行过程中整理已经完成的 exchanges，把属于同一个讨论主题的连续或相关对话归到一个 topic 下，并保存：

- topic keywords；
- retrieval terms；
- 对应的原始 transcript spans；
- topic status；
- 时间信息。

它更像一个后台“记忆整理员”。

### Memory Selector

Memory Selector 也不回复用户。

新消息到来时，它会看：

- 当前用户消息；
- 最近 5 个 completed exchanges；
- Topic Directory。

然后最多选择 3 个可能相关的旧 topic。

SDK 再根据 topic 保存的 spans 回到 Canonical Transcript，恢复当时的原始对话细节，并生成 `memoryContext`。

### 你的 Main LLM

真正给用户写回复的仍然是你自己的 **Main LLM**。

**v0.1 默认可以只配置一个 Memory LLM，让同一个 Memory LLM 同时承担 Topic Worker 和 Memory Selector。这个 Memory LLM 不是 Main LLM。**

你当然也可以在自己的产品里让 Memory LLM 和 Main LLM 使用同一个底层模型供应商甚至同一个 model name，但在架构上它们的职责仍然分开：

```text
Memory LLM
├─ Topic Worker：整理记忆
└─ Memory Selector：寻找记忆

Your Main LLM
└─ 根据当前消息 + memoryContext 生成最终回复
```

Topic Memory SDK 不会调用或接管你的 Main LLM。

## 工作原理

v0.1 的流程可以理解成六步。

### 1. Canonical Transcript：先保存原始事实

每一轮对话都会先进入 Canonical Transcript，并处于：

- `pending`
- `completed`
- `failed`

其中 completed exchange 才会被当作可靠的长期对话证据。

### 2. Topic Worker：把旧对话整理成“目录”

当至少存在 6 个 completed exchanges 后，Topic Worker 开始处理 active tail。

它不会简单地“一轮生成一个记忆”。它会把属于同一主题的多轮对话归为一个 topic，并记录这个 topic 对应原始对话的准确 span。

### 3. Topic Directory：只保留轻量索引

长期历史不会整段塞给 Selector。

Selector 先看到的是 Topic Directory——类似一本书的目录：它告诉模型“过去聊过什么”，但不会先把几千轮原文全部加载进来。

### 4. Memory Selector：定位可能相关的旧 topic

用户发来新消息后，Selector 根据当前问题、最近 5 个 exchanges 和 Topic Directory，最多选择 3 个相关 topic IDs。

### 5. Opened Topic Packet：回到原始对话

选中 topic 后，SDK 根据它保存的 spans，从 Canonical Transcript 中恢复真正的原始 user / assistant 对话。

如果用户问“什么时候”“当时”“多久以前”之类的问题，还可以一起恢复时间元数据。

### 6. Main LLM：拿到恢复出的记忆再回复

最终 SDK 返回：

```ts
retrieved.memoryContext
```

你的 Main LLM 可以把这段内容作为额外上下文使用。

```text
Canonical Transcript
        │
        ▼
   Topic Worker
        │
        ▼
    Topic Store ─────→ Topic Directory
                          │
当前用户消息 ─────────────┤
最近 5 个 exchanges ──────┤
                          ▼
                   Memory Selector
                          │
                    最多 3 个 topic
                          │
                          ▼
                  Open Topic Packets
                          │
                          ▼
                     memoryContext
                          │
                          ▼
                    你的 Main LLM
```

如果 Selector 出错，SDK 会安全降级为长期 `memoryContext` 为空，而不是让整个聊天流程崩掉。

## 理论上能把“记忆跨度”提高多少？

Topic Memory 并不会魔法般扩大模型本身的 context window。它做的是把：

> **“总共保存了多少历史”**

和

> **“这一次请求真正送进模型多少历史”**

拆开。

以一个说明性的 128k context 场景为例：如果给历史记录大约 120k tokens，每个 completed exchange 平均约 200 tokens，那么传统“完整历史全部塞回 prompt”的方案大约在 **600 exchanges** 左右就已经接近预算。

如果使用 Topic Memory，并假设：

- 总历史：5,000 exchanges；
- 平均 8 exchanges 被整理成一个 topic；
- 每个 Topic Directory entry 平均约 60 tokens；
- 最近上下文保留 5 exchanges；
- 每次最多打开 3 个 topic；

那么这 5,000 exchanges 对应的 memory retrieval prompt，在这组假设下大约仍只有 **43k–45k tokens**。

也就是说，在这个示例模型里，能够被系统索引和按需恢复的历史跨度大约从 600 扩展到 5,000 exchanges，约 **8.3×**；同时不需要在每次回复时重放 5,000 exchanges 的全部原文。

**这不是硬上限，也不是性能 benchmark。** 它只是根据 v0.1 当前数据结构做的容量推算。真实结果取决于消息长度、tokenizer、平均 topic 大小、模型 context window 和 Topic Directory 的增长速度。

实际上，5,000 也不是存储层的最大值。v0.1 更早遇到的扩展瓶颈通常会是 Topic Directory 随 topic 数量线性增长。详细公式、假设和相关 long-context memory 研究放在 [架构与容量说明](./docs/ARCHITECTURE.zh-CN.md)，不会影响正常安装和使用。

## 安装

当前版本以源码形式公开，可 clone 使用，也可以通过 `npm pack` 生成 tarball。

```bash
npm install
npm run build
npm pack
```

## 配置 Memory LLM

内置 adapter 使用 OpenAI-compatible `/chat/completions` 协议：

```bash
MEMORY_LLM_BASE_URL=https://your-openai-compatible-endpoint.example/v1
MEMORY_LLM_API_KEY=replace-me
MEMORY_LLM_MODEL=your-memory-model
```

不要把付费 API Key 放进公开前端 bundle。生产环境建议通过自己的后端或可信代理调用。

## 5 分钟接入

```ts
import {
  createMemory,
  createOpenAICompatibleMemoryLlm,
  InMemoryStorage,
} from 'topic-memory';

const memoryLlm = createOpenAICompatibleMemoryLlm({
  baseUrl: process.env.MEMORY_LLM_BASE_URL!,
  apiKey: process.env.MEMORY_LLM_API_KEY,
  model: process.env.MEMORY_LLM_MODEL!,
});

const memory = createMemory({
  storage: new InMemoryStorage(),
  llm: memoryLlm,
});

async function handleUserMessage(userMessage: string) {
  const pending = await memory.begin(userMessage);

  try {
    const retrieved = await memory.retrieve({ userMessage });

    // 这里是你自己原本就有的主聊天模型调用。
    const assistantReply = await myOwnMainLlm({
      userMessage,
      memoryContext: retrieved.memoryContext,
      recentContext: retrieved.recentContext,
    });

    await memory.completeExchange({
      exchangeId: pending.id,
      assistantText: assistantReply,
    });

    await memory.maybeRunTopicWorker();
    return assistantReply;
  } catch (error) {
    await memory.failExchange({
      exchangeId: pending.id,
      failureReason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

SDK **不会**调用 `myOwnMainLlm`。这个函数只是代表你现有 App 里的 Main LLM 调用。

完整接法请看 [docs/USAGE.zh-CN.md](./docs/USAGE.zh-CN.md)。

## 正确调用顺序

```text
用户消息
→ memory.begin()
→ memory.retrieve()
→ 你的 Main LLM
→ memory.completeExchange()
→ memory.maybeRunTopicWorker()
```

如果 Main LLM 在 `begin()` 之后调用失败，使用 `memory.failExchange(...)`。

## 前 6 个 completed exchanges

Topic Worker 在至少存在 **6 个 completed exchanges** 之前不会运行。

此时：

- Canonical Transcript 仍然正常保存；
- `recentContext` 仍然可用；
- 因为还没有 topic，`memoryContext` 可能为空。

这是正常行为。

## Public API

```ts
createMemory
MemoryEngine
InMemoryStorage
IndexedDbMemoryStorage
createOpenAICompatibleMemoryLlm
```

主要方法：

```ts
begin
beginExchange
completeExchange
failExchange
maybeRunTopicWorker
retrieve
listExchanges
listTopics
getLatestTopicWorkerRun
clear
```

`retrieve()` 返回：

```ts
{
  recentContext,
  topicDirectory,
  selectedTopicIds,
  openedTopicPackets,
  memoryContext,
  needsTimeMetadata,
  trace,
}
```

## 存储

Demo / 测试：

```ts
new InMemoryStorage()
```

浏览器持久化：

```ts
new IndexedDbMemoryStorage()
```

服务端生产环境可以实现导出的 `MemoryStorage` interface，接入自己的数据库。

## 高级配置

默认只需要一个 Memory LLM：

```ts
createMemory({ storage, llm: memoryLlm })
```

这个 Memory LLM 同时处理 Topic Worker 和 Selector。

也可以拆成两个：

```ts
createMemory({
  storage,
  topicWorker: topicWorkerLlm,
  selector: selectorLlm,
});
```

无论哪种配置，都不会替代宿主应用自己的 Main LLM。

## 失败降级

- **Main LLM 调用失败：** 使用 `failExchange`；
- **Topic Worker provider 失败：** 记录失败并保留已有 topics；
- **Topic Worker 输出结构不合法：** 直接拒绝，不写入 Topic Store；
- **Selector 失败：** 长期 `memoryContext` 降级为空；
- **当前问题不需要旧记忆：** `memoryContext` 本来就应该为空。

## 验证

仓库 CI 会按真实第三方项目的使用方式验证 package：

```bash
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

`smoke:consumer` 会把 SDK 打包，安装进一个全新的临时 Node 项目，只通过 public package exports 导入，然后运行完整 memory pipeline，并验证模拟的宿主 Main LLM 最终收到非空 `memoryContext`。

## 非目标

v0.1 不管理 Persona、Big Five、Relationship、Proactive Messaging、UI、embedding、vector database，也不管理宿主应用的 Main LLM。

## License

MIT
