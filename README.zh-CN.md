# Memory System V2

给 Node.js 聊天应用接入长期记忆，检索核心来自 [LongMemory](https://github.com/CaviraOSS/LongMemory)。

配置一次，再替换应用里调用聊天模型的那一行。SDK 会自动查找旧对话、把有限的原文放进请求，并保存本次完成的回复。聊天模型和回复格式沿用你原来的设置。

[English](README.md) · [接入文档](docs/sdk.md) · [应用代码示例](examples-product/chat-entry.mjs)

## 安装

先安装 [Node.js 22 或 24](https://nodejs.org/en/download)。

**下面的聊天入口属于本地 0.5.0-beta.3 预览版，已发布的 npm beta.2 暂时没有这个入口。** 要试用这份代码，在本项目文件夹中运行：

```powershell
npm.cmd ci
npm.cmd pack
```

再进入你自己的应用文件夹，安装刚生成的包：

```powershell
npm.cmd install "C:\实际路径\memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
```

把路径换成包的实际位置。macOS/Linux 将 `npm.cmd` 换成 `npm`。已发布的底层 SDK 仍可通过 `memory-system-v2@0.5.0-beta.2` 安装。

## 接到已有聊天应用

保留你已经配置好的 OpenAI 客户端，在 Node.js 后端初始化一次：

```js
import { createMemoryChat } from 'memory-system-v2/chat';

const chat = createMemoryChat({
  client, // 你原来调用聊天模型的客户端。
  memory: {
    dbPath: './data/memory.sqlite',
    embedding: {
      kind: 'nvidia',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/nemotron-3-embed-1b',
      dimension: 2048,
      apiKey: process.env.EMBED_API_KEY,
    },
  },
});
```

找到原来调用模型的代码：

```js
const response = await client.chat.completions.create({ model, messages });
```

替换为：

```js
const response = await chat.create({
  userId: signedInUser.id,
  sessionId: conversation.id,
  model,
  messages,
});
```

后面仍然用 `response.choices[0].message.content` 读取回答。用户和会话 ID 使用后端现有的稳定编号；不同角色需要独立记忆时，再传入 `personaId`。不需要自己另外写检索、拼接记忆和保存步骤。

流式聊天传入 `stream: true`，照常用 `for await` 接收内容。后端退出时调用 `await chat.close()`。[完整用法和限制](docs/sdk.md#automatic-chat-entry)

## 它会自动做什么

- 把用户消息和助手回复原文保存在本地 SQLite 文件。
- 在相同用户、角色和会话内检索旧消息。
- 限制近期上下文和历史证据的大小，避免同一段对话重复加入两处。
- 支持普通文字回复和流式文字回复。
- 记忆检索或保存出错时，仍让正常聊天继续。

程序运行在你的电脑或自己的后端服务器上，不需要作者提供服务器。使用外部 embedding 服务时，消息和检索问题会发送给该服务，可能产生费用；也支持本地 Ollama。记忆管理不额外调用生成模型。

这个入口面向文字 Chat Completions。工具调用、图片和多候选回答会照常转发，但不自动处理记忆。取消或没有完成的回复不会记成完整对话。检索可能遗漏历史，也不能保证模型回答一定正确。[隐私说明](docs/privacy.md) · [SDK 文档](docs/sdk.md)

## 检索测试

一组合成测试包含八个会话中的 200 轮对话和 50 道查询：

| 检查 | 本 SDK | 固定版本 LongMemory 对照 |
| --- | ---: | ---: |
| 35 道共同查询中，前五条结果包含指定用户原文 | 33/35 | 21/35 |
| 重启后完整恢复的消息 | 400/400 | 400/400 |

其中两道“中文历史、英文提问”的检索失败。这是 beta.2 核心的检索结果，不是新聊天入口的测试，也不代表最终回答准确率或 token 节省。[测试方法](benchmarks-product/blind/README.md) · [完整结果](benchmarks-product/blind/RESULTS.md)

## 来源和许可

本项目代码采用 [MIT](LICENSE) 许可。修改后的 LongMemory 核心保留 [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE) 许可及 [NOTICE](NOTICE)，上游版本和修改见 [ATTRIBUTION](ATTRIBUTION.md)。

开发检查：

```sh
npm ci
npm run typecheck
npm test
npm run smoke:consumer
```
