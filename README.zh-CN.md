# Topic Memory

**用自己的模型，在一个页面配置可持久保存的聊天记忆。**

[English](./README.md) · [插件接入与常见问题](./docs/PLUGIN.md) · [SDK 接入](./docs/USAGE.zh-CN.md) · [架构](./docs/ARCHITECTURE.zh-CN.md)

Topic Memory 是本地记忆插件，也是 TypeScript SDK。它保存原始聊天，建立话题索引，在新问题需要时找回原文，再交给你自己的模型回答。没有作者的共享 API Key，没有托管账号，也不会代替你支付模型费用。

## 最快开始：一条命令、一个页面

先安装 [Node.js](https://nodejs.org/)（20.6 或以上）。在准备长期使用的文件夹打开 PowerShell，运行：

```powershell
npx.cmd --yes topic-memory@0.2.0
```

macOS / Linux 使用 `npx --yes topic-memory@0.2.0`。打开终端显示的 **http://127.0.0.1:4318**：

1. 填写你自己的 **Base URL、模型名称、API Key**，点击「保存配置」。本机无鉴权模型可以不填 Key。可选的记忆模型使用同一服务商与 Key。
2. 点击「测试连接」，通过后直接在同一页面聊天。
3. 接入已有聊天工具时，复制页面上的 **当前会话 Base URL、本地连接 Key、模型名称** 到该工具的 OpenAI 兼容服务设置。

**不需要寻找或编辑 `.env`。** 页面自动创建本机配置。每个独立聊天请创建新会话，使用对应的独立地址。

## 从 GitHub 下载

点击 **Code → Download ZIP**，解压后，Windows 双击 **`start.cmd`**。它会安装依赖、构建并启动，随后打开终端显示的地址。

也可以在解压后的项目文件夹运行：

```powershell
npm.cmd ci
npm.cmd start
```

macOS / Linux 去掉 `.cmd`。保留终端窗口；停止时按 Ctrl+C。下次从同一个文件夹启动，配置与记忆会恢复。升级前备份 `.topic-memory`，升级后使用相同的数据目录。

## 实际呈现与兼容范围

一个页面完成模型配置、连接测试、真实聊天、会话切换、复制接入信息和真实模型对比。

这是通过 **OpenAI-compatible Chat Completions 本地接口**接入的插件。它适用于允许自定义接口地址、Key 和模型名的本机客户端；并非任何软件商店都能直接安装的原生扩展，尚未宣称对具体第三方客户端完成认证测试。

| 支持 | 当前边界 |
| --- | --- |
| 自己的远程模型或本机兼容模型 | 远程地址需要 HTTPS；HTTP 仅限本机 |
| 纯文本 Chat Completions、模型列表 | 不支持图片、工具调用、Responses API、结构化输出和多候选 |
| `stream: true` 的 SSE 格式 | 完整生成并保存后一次返回，暂不逐 token 推送 |
| 会话独立保存，重启恢复 | 同一地址对应同一会话；新聊天需要新会话地址 |
| 单人本机使用，同会话串行处理 | 不面向多用户部署；容器及云端应用不能直接访问本机地址 |
| 最近 5 轮 + 找回的旧话题 | 至少完成 6 轮开始整理长期话题；最多选 3 个话题 |

## 数据放在哪里？

默认保存在**启动目录的 `.topic-memory` 文件夹**，页面显示完整路径。包括模型配置、会话记录和本地测试报告。Key 不会在配置接口中回显，不会发往作者服务；模型请求和选中的聊天证据会发送到你配置的模型服务。配置文件在磁盘上包含明文 Key，请保护数据目录；Git 和 npm 打包排除它。

更换工作目录时可指定固定数据路径：

```powershell
npx.cmd --yes topic-memory@0.2.0 --data-dir "D:\MyMemory"
```

## 验证到了哪里？

- 自动测试覆盖 SDK 生命周期、交错话题索引保留、断档校验、重启持久化、会话隔离、并发排队、鉴权、错误处理和 SSE 响应。协议集成测试使用本地测试服务，**不作为真实模型效果证据**。
- 页面「真实模型对比」使用你配置的模型：24 轮公开虚构对话、连续多次话题整理、4 个问题，比较最近 5 轮、完整历史、话题记忆。约 23 次模型请求，可能计费；报告包含原始回答、整理错误、耗时和服务商返回的 token 用量。
- 这是小样本诊断，字面评分可能误判同义表达。**没有凭此宣称普遍准确率、成本优势或生产可靠性。**
- 旧的 `npm run demo` 与 `npm run build:site` 是预设机制演示，不是上述真实插件，也不是效果证据。

## 开发者 SDK

```bash
npm install topic-memory
```

```ts
import { createMemory, createOpenAICompatibleMemoryLlm } from 'topic-memory';
import { FileMemoryStorage } from 'topic-memory/node';

const memory = createMemory({
  storage: new FileMemoryStorage('./data/conversation.json'),
  llm: createOpenAICompatibleMemoryLlm({ baseUrl, model, apiKey }),
});
```

接入方负责在主模型调用前检索、回答后保存，并串行运行同一会话。[完整 SDK 生命周期](./docs/USAGE.zh-CN.md)。浏览器继续使用 `topic-memory` 入口的内存或 IndexedDB 存储。

## 开发检查

```bash
npm ci
npm run typecheck
npm test
npm run smoke:consumer
npm run evaluate
npm run build:site
```

保存网页模型配置后，运行 `npm run evaluate:plugin` 生成 `benchmark-results/plugin-live.json`。不要上传配置和私人聊天。

MIT License.
