# Memory System V2

给自己开发的 Node.js 聊天应用加上长期记忆。安装并接入一次，SDK 自动查旧对话、加入有限的历史原文、调用原模型，再保存完成的对话。

[English](README.md) · [下载安装包](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz)

## 1. 下载并安装

准备 Node.js 22 或 24。在**自己应用的后端目录**打开 PowerShell：

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
Copy-Item .\node_modules\memory-system-v2\examples-product\chat-entry.mjs .\memory-chat.mjs
```

安装的是编译好的 SDK，不需要克隆仓库或自己构建。第二行把接入文件复制到当前目录；它供你的后端导入，不是另一个聊天软件。已有同名文件时先换一个文件名，避免覆盖。

macOS/Linux 使用 `npm`，再用 `cp node_modules/memory-system-v2/examples-product/chat-entry.mjs ./memory-chat.mjs` 复制文件。

## 2. 填配置

在后端现有的环境配置中加入以下内容。若使用 `.env`，可在同一目录运行 `notepad .env` 创建或编辑；**保留已有设置，不要覆盖其他配置，不要提交 Key 到 Git**。

```dotenv
# 原来聊天模型的设置：沿用你自己的地址、模型和 Key
CHAT_BASE_URL=https://你的聊天服务地址/v1
CHAT_MODEL=你正在使用的聊天模型
CHAT_API_KEY=你的聊天服务Key

# 另行配置 embedding。以下是 NVIDIA 的示例，可与聊天服务不同
EMBED_PROVIDER=nvidia
EMBED_BASE_URL=https://integrate.api.nvidia.com/v1
EMBED_MODEL=nvidia/nemotron-3-embed-1b
EMBED_DIMENSION=2048
EMBED_API_KEY=你的NVIDIA_Key

# 保存在你电脑或后端服务器上的文件
MEMORY_DB_PATH=./data/memory.sqlite
```

`.env` 不会自动生效。沿用后端已有的环境变量加载方式；直接用 Node 启动时，在原启动命令中加 `--env-file=.env`，例如 `node --env-file=.env server.mjs`，其中 `server.mjs` 必须换成你的实际入口。

其他兼容 embedding 服务使用 `EMBED_PROVIDER=openai`，并填写它的真实地址、模型和维度；不要把聊天模型名称当作 embedding 模型。更多配置见 [SDK 文档](docs/sdk.md#embedding-configuration)。

## 3. 替换聊天调用

在现有聊天处理函数所在的文件导入：

```js
import { reply, close } from './memory-chat.mjs'; // 按你的目录调整路径
```

把原来的模型调用：

```js
const response = await client.chat.completions.create({ model, messages });
```

替换为：

```js
const response = await reply({
  userId: signedInUser.id,
  sessionId: conversation.id,
  messages,
});
```

`messages` 沿用应用本来发送的文字消息；两个 ID 换成后端已经确认的用户和会话编号。不同角色需要分开记忆时加 `personaId`。不要直接相信客户端任意传来的身份。

照常读取 `response.choices[0].message.content`。流式请求加 `stream: true`，照常 `for await` 接收。后端退出时调用 `await close()`。

不需要再写检索、拼接历史和保存逻辑。若要复用现有客户端、保留更多请求参数，直接使用 [createMemoryChat](docs/sdk.md#automatic-chat-entry)。

## 支持范围

- 面向 **Node.js 22/24 后端**，封装 **OpenAI-compatible Chat Completions** 接口；不要求使用 OpenAI 的模型或 Key。
- 支持普通和流式文字对话；单个回复、交替的用户／助手消息，系统指令放在前面。
- 工具调用、图片、多候选或其他不支持的消息结构会交回原客户端处理，本版不自动为它们加记忆。
- 不是 OpenAI Responses、Claude 原生 Messages 或 Gemini 原生接口的封装，也不是能拖进任意 App 的通用插件。[接口范围](docs/compatibility.md)
- 需要 embedding 服务；聊天与 embedding 可来自不同厂商。SDK 在自己的电脑或服务器运行，不依赖作者服务器。
- 原文和索引保存在本地 SQLite。外部 embedding 服务会接收消息和查询，可能产生费用；记忆管理不额外调用生成模型。

## 超时后会怎样

| 情况 | 处理方式 |
| --- | --- |
| 聊天模型超时 | 旧记忆保留。错误交给应用处理；未完成的回复不记成完整对话。接入文件配置最多一次客户端重试。 |
| 保存原文后的 embedding 超时 | 原文仍在本地，索引标记失败。服务恢复后，重新打开该会话会尝试补索引，也可主动重建。 |
| 检索不可用 | 继续使用有限近期上下文调用聊天模型。 |
| 本地数据库写入失败 | 不丢弃已得到的模型回答，同时报告保存错误；此时不能声称本轮已备份。 |

本地持久化不等于额外的灾备副本。SDK 不保存尚未完成的用户请求，应用仍需保留待发送／失败消息及重试状态。数据库文件备份由部署方负责。[故障恢复说明](docs/sdk.md#timeouts-and-recovery) · [隐私](docs/privacy.md)

检索可能漏掉旧信息，模型也可能答错。不要把它当作百分之百准确的记录查询工具。

已在真实 AI 聊天应用后端验证；封装前后的过程、结果和限制见附件[实验报告](docs/integration-validation.md)。

## 来源与许可

检索核心复用 [LongMemory](https://github.com/CaviraOSS/LongMemory)。项目代码为 [MIT](LICENSE)，上游代码保留 [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE) 和 [NOTICE](NOTICE)；来源及修改见 [ATTRIBUTION](ATTRIBUTION.md)。
