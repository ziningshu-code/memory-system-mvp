# Topic Memory

**按话题找回原始对话，让旧细节重新进入上下文。**

[English](./README.md) · [接入指南](./docs/USAGE.zh-CN.md) · [效果验证](./docs/EVALUATION.md) · [架构说明](./docs/ARCHITECTURE.zh-CN.md)

Topic Memory 是面向聊天应用和 AI Agent 的 TypeScript SDK。它把历史对话整理成话题，根据新问题选择相关话题，再恢复当时的原始对话，交给你已有的主模型使用。

例如，用户曾决定去东京时住在**上野，每晚预算 14,000 日元**。之后聊过饮食、项目和天文学，当用户再次问起酒店计划时，SDK 可以重新打开那段对话，并保留可检查的原文依据。

## 安装

```bash
npm install topic-memory
```

使用 ES modules。SDK 要求 Node.js 18+；下方真实模型示例使用 `--env-file`，要求 **Node.js 20.6+**。2026-09-13 已在全新 Node 24 项目中安装并运行公开的 `topic-memory@0.1.0`。

## 先试一下：不需要 API Key

```bash
git clone https://github.com/ziningshu-code/memory-system-mvp.git
cd memory-system-mvp
npm ci
npm run demo
```

示例载入 **24 轮虚构对话**，找回较早的酒店话题，并打印原始对话。它使用真实 SDK 和**预设的整理、选择响应**，用于展示流程，不代表真实模型的检索准确率。

查看可切换中英文的网页演示：

```bash
npm run build:site
npm run preview
```

打开 `http://127.0.0.1:4173`，选择酒店、饮食、项目或未记录信息场景，检查选中的话题和找回的原文。这个预设演示完全在浏览器本地运行，不需要账号、API Key，也不调用模型。

## 快速接入

你的应用配置一个负责记忆的模型，同时保留自己原有的主模型。主模型应同时收到**最近对话**和**找回的旧证据**：

```ts
import { createMemory, createOpenAICompatibleMemoryLlm, InMemoryStorage } from 'topic-memory';

const memory = createMemory({
  storage: new InMemoryStorage(),
  llm: createOpenAICompatibleMemoryLlm({
    baseUrl: process.env.MEMORY_LLM_BASE_URL!,
    apiKey: process.env.MEMORY_LLM_API_KEY,
    model: process.env.MEMORY_LLM_MODEL!,
  }),
});

const pending = await memory.begin(userMessage);
const context = await memory.retrieve({ userMessage });
// 你的主模型接收当前消息、context.recentContext、context.memoryContext。
const assistantReply = await yourMainModel(userMessage, context);
await memory.completeExchange({ exchangeId: pending.id, assistantText: assistantReply });
await memory.maybeRunTopicWorker();
```

上面的 `yourMainModel` 代表应用自己的调用。**可以直接运行的完整实现**在 [examples/chat.mjs](./examples/chat.mjs) 和 [provider.mjs](./examples/provider.mjs)，包含真实请求、最近上下文注入、失败处理和对话状态管理。

## 使用真实模型

在克隆的项目中，把 `.env.example` 复制为 `.env`，填写支持 OpenAI-compatible 协议的服务地址、模型和 API Key。配置文件只保存在本地。示例会向你配置的服务发送对话，并可能消耗付费额度。

```bash
npm run demo:chat
```

也可以先载入虚构对话，再直接提问酒店计划：

```bash
npm run demo:chat -- --seed
```

对话素材是虚构的；话题整理、选择和最终回答都使用**实际配置的模型**。输入 `/exit` 退出。示例使用内存存储，退出后数据清空。

## 现在验证到了哪一步？

| 检查 | 结果及含义 |
| --- | --- |
| npm 公开软件包 | 已在全新 Node 24 项目安装，并恢复旧对话 |
| SDK 状态、存储、适配器和检索 | 由 CI 自动检查 |
| 四个预设演示场景 | 检查原文恢复和信息不存在时的空记忆；[查看记录](./docs/evaluation/scripted.json) |
| 真实模型对照 | 已提供可运行的测试工具；**暂不声称有真实模型性能结论** |

`npm run evaluate` 运行预设检查。`npm run evaluate:live` 使用同一个真实主模型，对比**最近五轮上下文**、**完整历史**和**话题检索**，记录原始回答、字面事实评分、请求耗时，以及服务实际返回的 token 用量。[查看方法和边界](./docs/EVALUATION.md)。

此前的 **8.3 倍**是容量假设示例，**不是实测的准确率提升或有效记忆提升**。公式和前提保留在[架构与容量说明](./docs/ARCHITECTURE.zh-CN.md)。

## 工作流程

```text
保存的对话 → 话题整理 → 话题目录
新问题 + 最近对话 + 目录 → 选择器
选中的话题 ID → 原始对话片段 → 你的主模型
```

整理和选择可以使用同一个记忆模型，也支持分别配置。SDK 不生成最终回复，也不替换主模型，不要求 embedding 或向量数据库。

## 当前边界

- 至少完成 **6 轮对话**才开始生成长期话题；之前最近上下文仍可使用。
- 每次最多选 **3 个话题**，可能漏掉证据，可检查 `retrieve().trace`。
- 选择器出错时返回空长期记忆；应用仍需处理请求超时和存储失败。
- `InMemoryStorage` 不持久化；浏览器可使用 `IndexedDbMemoryStorage`；后端数据库和用户／会话隔离需要实现 `MemoryStorage`。
- 同一个存储中的对话和整理任务应串行执行，SDK 没有协调并发写入。
- 目录会随历史增加；v0.1 没有总 token 预算限制。
- 历史内容应作为不可信的证据处理，不能提升为系统指令。

## 开发检查

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run smoke:consumer
npm run evaluate
npm run build:site
```

## 参与试用

在自己的开发场景中试一个对话，再[反馈体验](https://github.com/ziningshu-code/memory-system-mvp/issues/new?template=try-it.yml)：希望记住什么、安装是否顺利、哪里帮上了忙或第一次失败。公开反馈前请去掉密钥和私人对话。

## License

MIT
