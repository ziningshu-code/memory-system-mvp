# Memory System V2

给自己开发的 Node.js 聊天应用加上长期记忆。安装并接入一次，SDK 自动查旧对话、加入有限的历史原文、调用原模型，再保存完成的对话。

[English](README.md) · [下载安装包](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz)

## 1. 下载并安装

准备 Node.js 22 或 24。在**自己应用的后端目录**打开 PowerShell：

这里指放着 `package.json` 的目录。先执行 `node --version` 和 `npm.cmd --version`；前者应为 `v22...` 或 `v24...`。如果命令不存在，安装 Node 后重新打开 PowerShell。

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
Copy-Item .\node_modules\memory-system-v2\examples-product\chat-entry.mjs .\memory-chat.mjs
```

安装的是编译好的 SDK，不需要克隆仓库或自己构建。第二行把接入文件复制到当前目录；它供你的后端导入，不是另一个聊天软件。已有同名文件时先换一个文件名，避免覆盖。

如果已从本页“下载安装包”保存了 `.tgz`，也可在后端目录执行 `npm.cmd install "完整路径\memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0`，然后执行同一条 `Copy-Item` 命令。把路径换成实际下载位置，不要解压该文件。

macOS/Linux 使用 `npm`，再用 `cp node_modules/memory-system-v2/examples-product/chat-entry.mjs ./memory-chat.mjs` 复制文件。

## 2. 填配置

仍在这个后端目录，执行下面两行。第一行只在文件不存在时创建它，第二行打开记事本：

```powershell
if (!(Test-Path -LiteralPath .\.env)) { New-Item -ItemType File -Path .\.env | Out-Null }
notepad .\.env
```

加入以下内容，替换自己的地址、模型和 Key，按 **Ctrl+S 保存**后关闭记事本。已有同名配置就修改该行，不要重复添加；保留其他设置。Key 填服务商给的完整字符串，不加 `Bearer `。文件名是 `.env`，不是 `.env.txt`；**不要提交到 Git**。

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

保存后，仍在同一 PowerShell 窗口执行：

```powershell
node --env-file=.env --input-type=module -e "const m = await import('./memory-chat.mjs'); await m.close(); console.log('Configuration loaded');"
```

看到 `Configuration loaded`，说明 Node 读到了文件且接入模块可初始化。这一步**不请求模型，也不能验证 Key 是否有效**。不要用输出 Key 的方式排查。

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

上述 `import` 适用于 `.mjs` 或 `package.json` 中有 `"type": "module"` 的项目。CommonJS 的聊天处理函数可用 `const { reply } = await import('./memory-chat.mjs')`；TypeScript 或需要保留更多请求参数时见 [直接封装现有客户端](docs/sdk.md#automatic-chat-entry)。不要为了接入而改掉整个应用的模块格式。

不需要再写检索、拼接历史和保存逻辑。若要复用现有客户端、保留更多请求参数，直接使用 [createMemoryChat](docs/sdk.md#automatic-chat-entry)。

## 4. 加载配置并启动原应用

上面的配置检查**只对那条命令有效**，不会替下一条启动命令加载 `.env`。启动应用时也必须加载：

| 原启动方式 | 改成 |
| --- | --- |
| `node server.mjs` | `node --env-file=.env server.mjs` |
| `node server.js` | `node --env-file=.env server.js` |
| `npm.cmd start`，且 `package.json` 的 `scripts.start` 是 `node server.js` | 把该值改为 `node --env-file=.env server.js`，然后仍用 `npm.cmd start` |

表里的文件名是例子：**保留自己原来的入口文件名，只在 `node` 后加入 `--env-file=.env`**。不要新建一个没有业务逻辑的 `server.mjs`。参数放在入口文件前，且从 `.env` 所在目录启动。

如果框架本来会加载环境配置，沿用它的加载方式，并把这些设置写入框架实际读取的文件；不要直接把任意 `npm run dev` 改成 Node 命令。修改配置后重启后端。系统中已有的同名环境变量优先于 `.env`，若仍读到旧配置，应检查原有部署设置。

在**原来的应用界面**发送一条消息，收到真实回答后关闭并重启后端，再用相同用户、角色和会话继续聊天。默认数据文件是后端目录下的 `data/memory.sqlite`；`-wal`、`-shm` 文件也可能出现，不要在运行时删除它们。没有另一个记忆聊天页面需要打开。

### 启动不成功时

| 提示 | 检查 |
| --- | --- |
| `.env` 文件不存在 | `Get-Location` 查看当前目录，`Get-Item -Force .\.env` 确认文件名。 |
| `CHAT_BASE_URL is required` 等 | 补齐对应配置、保存；确认实际启动命令也加载了 `.env`。 |
| `ERR_MODULE_NOT_FOUND` | 在同一后端目录安装依赖，并检查 `memory-chat.mjs` 路径。 |
| 服务商返回 401/403 | 核对该服务对应的完整 Key、接口权限和地址。聊天与 embedding 的 Key 可以不同。 |
| `[memory:index]` 或 `[memory:retrieve]` 错误 | 检查 embedding 地址、模型、Key 和维度；聊天能回复不代表记忆索引成功。 |

正式部署时还需把 `.env`、`data/` 加入应用的 `.gitignore`（已有的规则保留），并使用可持久保存的数据库路径。

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
