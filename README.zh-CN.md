# Memory System V2

给 Node.js 聊天应用使用的记忆 SDK。它把对话保存在本地，找回相关旧消息，再将原文交给应用自己的聊天模型。

检索核心来自 [LongMemory](https://github.com/CaviraOSS/LongMemory)。开发者接入一次后，保存和检索就会随聊天流程自动执行。它需要接入代码，不能直接装进 ChatGPT 生效。

[安装](#安装) · [下载源码 ZIP](https://github.com/ziningshu-code/memory-system-mvp/archive/refs/heads/main.zip) · [下载 SDK](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.2) · [English](README.md)

## 安装

先安装 [Node.js 22 或 24](https://nodejs.org/en/download)，在应用的文件夹里运行：

```sh
npm install memory-system-v2@beta
```

Windows PowerShell 用这条：

```powershell
npm.cmd install memory-system-v2@beta
```

当前版本是 **0.5.0-beta.2**。通过 npm 安装最方便。发布页的 **Assets** 下也有 SDK 压缩包；ZIP 链接下载的是源码。这些文件都不是 Windows 软件安装程序。

## 跑一个例子

下面保存一段航班时间对话，再找回用户原话。它会调用 NVIDIA 的 embedding 接口，不会调用聊天模型。

### 1. 新建文件夹

```sh
mkdir memory-v2-demo
cd memory-v2-demo
npm init -y
npm install memory-system-v2@beta
```

如果 PowerShell 阻止脚本执行，把两条命令中的 `npm` 换成 `npm.cmd`。

### 2. 配置 embedding

在 [NVIDIA nemotron-3-embed-1b 页面](https://build.nvidia.com/nvidia/nemotron-3-embed-1b)获取 Key。在文件夹里新建 `.env`：

```dotenv
EMBED_API_KEY=your_nvidia_api_key
```

把占位内容换成自己的 Key，不要把这个文件提交到 Git。使用该服务时，保存的消息和检索问题会发送给 NVIDIA，embedding 请求可能产生费用。也可以配置[其他服务或本地 Ollama](docs/sdk.md#embedding-configuration)。

### 3. 运行

把下面的代码保存为 `demo.mjs`：

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

```sh
node --env-file=.env demo.mjs
```

输出应包含：

```text
Source: flight-1:user
Original message: My flight leaves at 7:40 tomorrow morning.
```

示例中的助手回复是测试内容。接入应用后，应保存聊天模型实际完成的回复。

## 接入聊天应用

```text
用户发消息 → 检索旧消息 → 聊天模型回答 → 保存本轮对话
```

发请求给模型前调用 `recall()`，把返回的 `context` 放进请求中作为历史参考。模型回答完成后，调用 `remember()` 保存用户消息和回复。当前聊天内容和检索到的历史应分开处理。

[聊天示例](examples-product/openai-compatible-chat.mjs)展示了完整流程，聊天与 embedding 接口分别配置。会话隔离、排除近期消息、更正、删除和失败处理见 [SDK 文档](docs/sdk.md)。

## 保存位置和限制

对话原文和搜索数据保存在同一个本地 SQLite 文件中。示例使用 `./memory.sqlite`，默认位置是 `~/.memory-system-mvp/memory.sqlite`。

检索结果包含来源编号和原文，并有大小限制。长消息可能只返回部分原文，检索也可能遗漏相关历史。更正关系需要应用明确指定；重建搜索数据可能重新调用 embedding 服务。

记忆管理不额外调用生成模型，但需要 embedding 服务。当前没有配套代理、配置页面或浏览器 SDK。数据发送和删除范围见[隐私说明](docs/privacy.md)。

## 测试

23 项 SDK 测试通过，CI 覆盖 Windows/Linux 和 Node 22/24。全新 npm 安装和 NVIDIA 示例也已验证。

一组合成测试包含分布在八个会话中的 200 轮对话，以及 50 道查询：

| 检查 | 本 SDK | 固定版本 LongMemory 对照 |
| --- | ---: | ---: |
| 35 道共同查询中，前五条结果包含指定用户原文 | 33/35 | 21/35 |
| 重启后完整恢复的消息 | 400/400 | 400/400 |

其中两道“中文历史、英文提问”的检索失败。这是小规模测试，衡量检索能力，不代表最终回答准确率或 token 节省。[测试方法](benchmarks-product/blind/README.md) · [完整结果](benchmarks-product/blind/RESULTS.md)

## 来源和许可

SDK 使用了经过修改的 [LongMemory 核心](https://github.com/CaviraOSS/LongMemory)。对话存储和 SDK 接口位于 `src/product/`，上游版本和修改清单见 [ATTRIBUTION](ATTRIBUTION.md)。

本项目代码采用 [MIT](LICENSE) 许可，LongMemory 代码保留 [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE) 许可及 [NOTICE](NOTICE)。

如需从源码安装，先安装 Git，再运行：

```sh
npm install "git+https://github.com/ziningshu-code/memory-system-mvp.git#main"
```

它会从 `main` 构建 SDK，可能包含 npm 已发布版本之后的改动。

开发检查：

```sh
npm ci
npm run typecheck
npm test
npm run smoke:consumer
```
