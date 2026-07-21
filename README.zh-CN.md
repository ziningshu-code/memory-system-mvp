# Topic Memory

[English](./README.md) · [详细接入指南](./docs/USAGE.zh-CN.md)

一个用于给现有 LLM 应用接入长期对话记忆的独立 TypeScript SDK。

它会保存 canonical conversation history，把较早的已完成对话整理成可恢复的 topic，在 Main LLM 回复前选择相关 topic，并返回可直接传给你现有主模型的 `memoryContext`。

**Memory LLM** → 负责 Topic Worker 和 Memory Selector。  
**你的 Main LLM** → 继续生成最终展示给用户的回复。这个 SDK 不接管、也不会调用你的 Main LLM。

## 安装

当前仓库以源码形式发布。可以 clone 后构建，或通过 `npm pack` 生成 tarball 再安装。

```bash
npm install
npm run build
npm pack
```

## 环境变量

使用内置 OpenAI-compatible adapter 时：

```bash
MEMORY_LLM_BASE_URL=https://your-openai-compatible-endpoint.example/v1
MEMORY_LLM_API_KEY=replace-me
MEMORY_LLM_MODEL=your-memory-model
```

不要把付费 API Key 直接放进公开的前端 bundle。需要时请通过后端或可信代理转发。

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

const pending = await memory.begin(userMessage);
const retrieved = await memory.retrieve({ userMessage });

// 这里替换成你自己现有的主聊天模型调用。
const assistantReply = await myOwnMainLlm({
  userMessage,
  memoryContext: retrieved.memoryContext,
});

await memory.completeExchange({
  exchangeId: pending.id,
  assistantText: assistantReply,
});

await memory.maybeRunTopicWorker();
```

如果要看完整的现有 App 接入方式、失败处理、存储选择和 prompt 注入示例，请看 [docs/USAGE.zh-CN.md](./docs/USAGE.zh-CN.md)。

## 调用时序

```text
用户消息
→ memory.begin()
→ memory.retrieve()
→ 你的 Main LLM
→ memory.completeExchange()
→ memory.maybeRunTopicWorker()
```

如果 Main LLM 调用失败，使用 `memory.failExchange(...)`，不要调用 `completeExchange(...)`。

## 6 个 exchange 的行为

v0.1 在少于 **6 个 completed exchanges** 时不会运行 Topic Worker。

此时：

- `recentContext` 仍然可用；
- `memoryContext` 可能为空；
- 这是正常行为，不代表安装失败。

## 工作原理

v0.1 以原应用稳定 Memory MVP 基线 `desktop-tutorial@a70d767` 的行为为依据：

1. **Canonical Transcript** 保存 pending、completed、failed exchanges，作为唯一事实来源。
2. **Recent Context** 使用最近 5 个 completed live exchanges。
3. **Topic Worker** 通过 6-exchange gate 后运行，严格校验 JSON，保留 finalized topics，只重新处理最近 finalized span 之后的 active tail。
4. **Topic Directory** 给 Selector 提供轻量 topic 索引。
5. **Memory Selector** 最多选择 3 个 topic IDs，并判断是否需要时间元数据。
6. **Opened Topic Packets** 根据 topic spans 从 Canonical Transcript 恢复精确原始对话。
7. **`memoryContext`** 返回给宿主应用，由你决定是否注入 Main LLM prompt。

Selector 失败时会安全降级为空的长期 `memoryContext`，不会阻塞你的 Main LLM。

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

## Provider

`createOpenAICompatibleMemoryLlm()` 调用：

```text
<baseUrl>/chat/completions
```

请求包含 `model`、system/user messages、`temperature`、`top_p`、`max_tokens`，并读取 `choices[0].message.content`。

这里只声明 OpenAI-compatible protocol 兼容，不代表任何特定模型提供商的官方认证。

## Storage

Node 示例和测试可以直接使用：

```ts
new InMemoryStorage()
```

浏览器环境可以使用：

```ts
new IndexedDbMemoryStorage()
```

也可以实现导出的 `MemoryStorage` interface，接入你自己的数据库。

## 高级配置

默认只配置一个 Memory LLM：

```ts
createMemory({ storage, llm })
```

它同时用于 Topic Worker 和 Memory Selector。

需要分开时：

```ts
createMemory({
  storage,
  topicWorker,
  selector,
})
```

## 失败处理

- Main LLM 失败：调用 `failExchange`。
- Topic Worker provider/parse 失败：记录在 latest worker run 中，不覆盖已有 topics。
- Topic Worker validation rejected：无效 topic 不会写入 Topic Store。
- Selector 失败：长期 `memoryContext` 为空，并在 `trace` 中返回错误。

## 常见问题

**Topic Worker 没运行**  
确认 active tail 中至少有 6 个 completed exchanges。

**`memoryContext` 是空的**  
可能是还没有 topic、Selector 判断当前问题不需要旧记忆，或 Selector 调用失败。这些都属于正常降级路径。

**浏览器存储报错**  
只有环境支持 IndexedDB 时才使用 `IndexedDbMemoryStorage`，否则实现自定义 `MemoryStorage`。

## 安全

不要把 provider secret 暴露在公开客户端代码中。可以把 OpenAI-compatible endpoint 放在自己的后端或代理之后。

## 非目标

v0.1 不管理 Main LLM、不包含 Persona、Big Five、Relationship、Proactive Messaging、UI、vector database、embedding 或向量检索。

## 验证

发布分支包含 one-model、split-model、provider、Canonical lifecycle、6-exchange gate、finalized active-tail、selector fallback、time metadata、InMemory/IndexedDB storage contract 和 host-owned Main LLM E2E 测试。

```bash
npm run build
npm run typecheck
npm test
npm pack --dry-run
npm run smoke:consumer
```

GitHub Actions 会在 push 到 `main`、`release/**` 以及针对 `main` 的 Pull Request 上自动执行同一套检查。`smoke:consumer` 会把 SDK 打成 tarball，安装进一个全新的临时 Node 项目，只从 public package exports 导入，然后验证完整 memory pipeline 和模拟宿主 Main LLM 能收到非空 `memoryContext`。

## License

MIT
