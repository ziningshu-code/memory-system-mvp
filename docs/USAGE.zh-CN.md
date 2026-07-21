# 接入指南

[English](./USAGE.md)

这份指南说明如何把 Topic Memory 接到你现有的聊天或 Agent 应用里，同时保持 Main LLM 完全由你的宿主应用控制。

## 1. 两种模型角色

Topic Memory 中有两个不同角色：

- **Memory LLM**：负责 Topic Worker 和 Memory Selector。
- **你的 Main LLM**：继续生成最终展示给用户的回复。

一般情况下，只需要配置一个 Memory LLM，同时承担 Topic Worker 和 Selector。

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

浏览器持久化可以把 `InMemoryStorage` 换成 `IndexedDbMemoryStorage`。

## 3. 包住一轮普通聊天

正确调用顺序：

```text
用户消息
→ begin
→ retrieve
→ 你的 Main LLM
→ completeExchange
→ maybeRunTopicWorker
```

示例：

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

SDK 不会调用 `myOwnMainLlm`。这个函数代表你自己已有的主聊天模型调用。

## 4. 把记忆传给 Main LLM

`retrieve()` 会同时返回最近短期上下文和恢复出来的旧 topic memory：

```ts
const retrieved = await memory.retrieve({ userMessage });
```

重点字段：

```ts
retrieved.recentContext
retrieved.memoryContext
retrieved.selectedTopicIds
retrieved.openedTopicPackets
retrieved.needsTimeMetadata
retrieved.trace
```

常见接法：

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

`memoryContext` 为空是正常情况，不要把空值直接当成报错。

## 5. 前 6 个 completed exchanges

少于 6 个 completed exchanges 时，Topic Worker 不运行。

这段阶段：

- Canonical Transcript 仍然正常保存；
- `recentContext` 仍然可用；
- 因为还没有生成 topic，`memoryContext` 可能为空。

每次成功完成一轮回复后调用 `maybeRunTopicWorker()` 即可，gate 由 SDK 自己判断。

## 6. Main LLM 调用失败

如果 `begin()` 之后你的 Main LLM 调用失败，应把 pending exchange 标记成 failed：

```ts
await memory.failExchange({
  exchangeId: pending.id,
  failureReason: 'provider_timeout',
});
```

Failed exchange 不会被 Topic Worker 当成已完成的对话事实。

## 7. 一个 Memory LLM 或两个

默认：

```ts
const memory = createMemory({
  storage,
  llm: memoryLlm,
});
```

高级拆分：

```ts
const memory = createMemory({
  storage,
  topicWorker: topicWorkerLlm,
  selector: selectorLlm,
});
```

两个对象都实现导出的 `MemoryLlm` interface。

## 8. 存储方案

### Node 或测试

```ts
new InMemoryStorage()
```

只存在当前进程内，进程退出后会清空。

### 浏览器

```ts
new IndexedDbMemoryStorage()
```

仅在支持 IndexedDB 的环境使用。

### 自定义数据库

实现导出的 `MemoryStorage` interface，即可接 PostgreSQL、SQLite、Redis、服务端 KV 等存储。

## 9. 查看 memory 状态

```ts
const exchanges = await memory.listExchanges();
const topics = await memory.listTopics();
const latestWorkerRun = await memory.getLatestTopicWorkerRun();
```

这些 API 适合做后台管理和 debug 工具。

## 10. 失败降级

Topic Memory 的目标是避免 memory 故障拖垮宿主聊天流程：

- Topic Worker provider 失败：记录失败，保留已有 topics；
- Topic Worker validation rejected：无效 topic 不会写入；
- Selector 失败：长期 `memoryContext` 退化为空；
- 没有相关旧 topic：`memoryContext` 为空。

是否重试、记录日志或继续回复，由宿主应用决定。

## 11. 推荐生产架构

```text
客户端
  ↓
你的后端
  ├─ Topic Memory SDK
  │    └─ Memory LLM provider
  └─ 你的 Main LLM provider
```

付费 provider 的 API Key 应保存在可信后端或代理，不要直接暴露在公开前端 bundle。

## 12. 验证命令

```bash
npm install
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

`smoke:consumer` 会先打包 SDK，再把 tarball 安装到一个全新的临时 Node 项目，只通过 public package exports 导入；随后跑 6 个 completed exchanges、生成 topic、恢复非空 `memoryContext`，最后验证模拟的宿主 Main LLM 确实收到了该 memoryContext。
