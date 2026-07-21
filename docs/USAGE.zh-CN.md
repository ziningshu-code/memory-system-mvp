# 接入指南

[English](./USAGE.md) · [架构与容量说明](./ARCHITECTURE.zh-CN.md)

这份文档只讲一件事：**怎么把 Topic Memory 接进你已经存在的聊天 App 或 Agent。**

它的接入思路很简单：

> 你的 App 本来就会调用 Main LLM。Topic Memory 只是在这次调用旁边加一层长期记忆：先找回相关旧信息，再把 `memoryContext` 交给你。

你不需要为了接这个 SDK 重写整套聊天架构。

## 1. 先分清三个角色

### Topic Worker

后台的“记忆整理员”。

它会把 completed exchanges 按主题整理成 topic，并保存 topic metadata 和指向原始 Canonical Transcript 的准确 spans。

### Memory Selector

后台的“记忆检索员”。

每次新消息到来时，它会看当前问题、最近 5 个 completed exchanges 和 Topic Directory，然后最多挑 3 个相关旧 topic 打开。

### 你的 Main LLM

真正生成用户最终看到回复的模型。

v0.1 默认只需要配置一个 Memory LLM：

```ts
createMemory({ storage, llm: memoryLlm })
```

这个 Memory LLM 同时承担 Topic Worker 和 Memory Selector。

**它不是你的 Main LLM。** Topic Memory SDK 不会替你调用 Main LLM。

## 2. 创建 memory engine

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
```

`InMemoryStorage` 适合 demo 和测试，进程退出后会清空。

浏览器持久化使用 `IndexedDbMemoryStorage`。正式服务端产品可以实现导出的 `MemoryStorage` interface，接自己的数据库。

## 3. 包住一轮正常聊天

正确顺序：

```text
用户发送消息
      │
      ▼
memory.begin()
      │
      ▼
memory.retrieve()
      │
      ▼
你的 Main LLM
      │
      ▼
memory.completeExchange()
      │
      ▼
memory.maybeRunTopicWorker()
```

完整示例：

```ts
async function handleUserMessage(userMessage: string) {
  const pending = await memory.begin(userMessage);

  try {
    const retrieved = await memory.retrieve({ userMessage });

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

这里的 `myOwnMainLlm()` 就是你自己 App 原来已有的主模型调用。SDK 内部不会调用它。

## 4. 把长期记忆传给 Main LLM

`retrieve()` 会返回两层上下文：

- `recentContext`：最近 5 个 completed exchanges；
- `memoryContext`：只有当前问题真正需要时才恢复出来的旧 topic memory。

```ts
const retrieved = await memory.retrieve({ userMessage });
```

完整返回值包括：

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

一种常见的 Main LLM 接法：

```ts
const assistantReply = await myOwnMainLlm({
  messages: [
    {
      role: 'system',
      content: [
        baseSystemPrompt,
        retrieved.memoryContext,
      ].filter(Boolean).join('\n\n'),
    },
    {
      role: 'user',
      content: userMessage,
    },
  ],
});
```

`memoryContext` 为空并不代表报错。

可能只是：

- 还没有生成 topic；
- 当前问题不需要旧记忆；
- Selector 调用失败后安全降级为空。

## 5. 这些 API 背后分别发生了什么

### `memory.begin(userMessage)`

在 Main LLM 开始回复前，先创建一个 pending Canonical Exchange。

### `memory.retrieve({ userMessage })`

准备最近 5 个 exchanges，构建 Topic Directory 给 Selector，选择相关旧 topic，然后根据 transcript spans 打开原始历史，最终返回 `memoryContext`。

### 你的 Main LLM

拿到当前消息和你决定注入的 memory fields，生成最终回复。

### `memory.completeExchange(...)`

把这一轮标记成 completed，并把最终 assistant reply 保存进 Canonical Transcript。

### `memory.maybeRunTopicWorker()`

检查 active tail 是否已经积累了足够 completed exchanges，需要时重新整理 topic。

你可以每次成功回复后都调用它，SDK 自己会判断 gate，不需要你手动数轮数。

## 6. 前 6 个 completed exchanges

至少存在 6 个 completed exchanges 之前，Topic Worker 不运行。

这段时间：

- Canonical Transcript 正常记录；
- `recentContext` 正常工作；
- 因为长期 Topic Store 还没建立，`memoryContext` 可能为空。

这是正常启动阶段。

## 7. Main LLM 调用失败怎么办

如果 `begin()` 已经成功，但 Main LLM 后面超时或报错，不要让这个 exchange 永远停在 pending。

```ts
await memory.failExchange({
  exchangeId: pending.id,
  failureReason: 'provider_timeout',
});
```

Failed exchange 仍然属于 Canonical Transcript 生命周期的一部分，但 Topic Worker 不会把它当作 completed conversation evidence。

## 8. 一个 Memory LLM 还是两个

绝大多数 App 可以直接用一个：

```ts
const memory = createMemory({
  storage,
  llm: memoryLlm,
});
```

它同时承担 Topic Worker 和 Selector。

高级部署可以拆开：

```ts
const memory = createMemory({
  storage,
  topicWorker: topicWorkerLlm,
  selector: selectorLlm,
});
```

两个对象都实现 `MemoryLlm` interface。

例如你可以让 Topic Worker 用能力更强的模型，而 Selector 用延迟更低、成本更低的模型。

无论怎么拆，都不会改变宿主 Main LLM 仍由你的 App 控制这一点。

## 9. 存储怎么选

### 内存

```ts
new InMemoryStorage()
```

适合本地 demo 和测试。进程退出后数据消失。

### 浏览器 IndexedDB

```ts
new IndexedDbMemoryStorage()
```

只在支持 IndexedDB 的环境使用。

### 你自己的服务端数据库

实现 `MemoryStorage` interface，就可以接 PostgreSQL、SQLite、Redis、KV store 等。

真正的多用户产品应该按照自己的 tenancy 设计，为 conversation / user / agent identity 隔离 memory store。

## 10. 怎么检查 Memory 里面到底存了什么

```ts
const exchanges = await memory.listExchanges();
const topics = await memory.listTopics();
const latestWorkerRun = await memory.getLatestTopicWorkerRun();
```

适合做后台管理页、debug 面板，或者调查为什么某个旧 topic 没被找回来。

`retrieve().trace` 也会返回 Selector 相关诊断信息。

## 11. 失败时会不会拖垮聊天

设计目标是 fail soft：Memory 出问题时，宿主聊天尽量还能继续。

- **Topic Worker provider 失败：** 记录失败，已有 topics 保留；
- **Topic Worker JSON / validation 不合格：** 拒绝这次结果，不写入 Topic Store；
- **Memory Selector 失败：** 长期 `memoryContext` 降级为空；
- **当前问题没有相关旧 topic：** `memoryContext` 本来就为空。

是否重试、记日志、报警，还是直接继续无长期记忆回复，由你的宿主应用决定。

## 12. 推荐的生产架构

```text
客户端
  │
  ▼
你的后端
  ├── Topic Memory SDK
  │     ├── Memory Storage
  │     └── Memory LLM
  │           ├── Topic Worker role
  │           └── Memory Selector role
  │
  └── 你的 Main LLM
        └── 生成用户最终回复
```

付费 provider 的密钥放在可信后端或代理，不要直接打进公开前端 bundle。

## 13. 能扩展到多少轮？

Topic Memory 不会扩大模型 context window。它减少的是“每次都重放全部历史”的需求。

v0.1 会把完整 Canonical Transcript 保存在外部存储，只把轻量 Topic Directory 和最多三个相关旧 topic 放进一次 retrieval。

在一组明确假设下，传统 raw-history 约 600 exchanges 的 prompt 预算，可以对应一个约 5,000 exchanges 的可索引、可按需恢复历史档案。这个例子约等于 8.3× 的历史跨度。

详细公式和 43k–45k token 推算见 [架构与容量说明](./ARCHITECTURE.zh-CN.md)。

这只是理论容量计算，不是硬上限或性能 benchmark。

## 14. 验证 package

```bash
npm install
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

`smoke:consumer` 会打包 SDK，把 tarball 安装进一个全新的临时 Node 项目，只从 public package exports 导入，然后运行完整 memory pipeline，并验证模拟的宿主 Main LLM 确实收到非空 `memoryContext`。
