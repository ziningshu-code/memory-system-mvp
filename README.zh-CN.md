# Memory System V2

给 Node.js 聊天应用添加长期记忆。SDK 保存对话原文，在后续提问时检索相关内容并提供给模型。

支持 OpenAI-compatible Chat Completions 的普通和流式文字对话，需要配置 embedding 服务。

[English](README.md) · [下载安装包](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz)

## 1. 下载并安装

需要 Node.js 22 或 24。在应用的后端目录（含 `package.json`）打开 PowerShell。

用 `node --version` 和 `npm.cmd --version` 检查安装；如果命令不存在，安装 Node 后重新打开 PowerShell。

```powershell
npm.cmd install "https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0
Copy-Item .\node_modules\memory-system-v2\examples-product\chat-entry.mjs .\memory-chat.mjs
```

第二行将接入模块复制到当前目录。已有同名文件时换一个文件名，避免覆盖。

也可以先下载 `.tgz`，执行 `npm.cmd install "完整路径\memory-system-v2-0.5.0-beta.3.tgz" openai@7.42.0`，再运行上面的 `Copy-Item`。路径换成实际下载位置，无需解压。

macOS/Linux 使用 `npm`，再用 `cp node_modules/memory-system-v2/examples-product/chat-entry.mjs ./memory-chat.mjs` 复制文件。

## 2. 填配置

在同一目录创建或打开 `.env`：

```powershell
if (!(Test-Path -LiteralPath .\.env)) { New-Item -ItemType File -Path .\.env | Out-Null }
notepad .\.env
```

填入自己的地址、模型和 Key，按 **Ctrl+S 保存**。已有同名配置就修改原行，保留其他设置。Key 填完整字符串，不加 `Bearer `；文件名应为 `.env`，不是 `.env.txt`。

```dotenv
# 聊天模型
CHAT_BASE_URL=https://你的聊天服务地址/v1
CHAT_MODEL=你正在使用的聊天模型
CHAT_API_KEY=你的聊天服务Key

# Embedding 服务，以下以 NVIDIA 为例
EMBED_PROVIDER=nvidia
EMBED_BASE_URL=https://integrate.api.nvidia.com/v1
EMBED_MODEL=nvidia/nemotron-3-embed-1b
EMBED_DIMENSION=2048
EMBED_API_KEY=你的NVIDIA_Key

# 本地数据库
MEMORY_DB_PATH=./data/memory.sqlite
```

保存后检查配置加载：

```powershell
node --env-file=.env --input-type=module -e "const m = await import('./memory-chat.mjs'); await m.close(); console.log('Configuration loaded');"
```

输出 `Configuration loaded` 表示配置已加载；这一步不请求模型，也不验证 Key。

其他兼容 embedding 服务使用 `EMBED_PROVIDER=openai`，填写对应地址、embedding 模型和维度。聊天和 embedding 可以使用不同服务商。[配置说明](docs/sdk.md#embedding-configuration)

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

`messages` 沿用原来的文字消息；两个 ID 使用后端验证过的用户和会话编号。需要区分角色时加 `personaId`。

照常读取 `response.choices[0].message.content`。流式请求加 `stream: true`，照常 `for await` 接收。后端退出时调用 `await close()`。

上述 `import` 适用于 `.mjs` 或设置了 `"type": "module"` 的项目。CommonJS 的异步处理函数可用 `const { reply } = await import('./memory-chat.mjs')`。

TypeScript、复用现有客户端或传入更多模型参数，见 [createMemoryChat API](docs/sdk.md#automatic-chat-entry)。图片、工具调用和多候选回复会透传给原客户端，不启用自动记忆。

## 4. 启动应用

启动命令也需要加载 `.env`；上面的配置检查不会为后续命令加载环境变量。

| 原启动方式 | 改成 |
| --- | --- |
| `node server.mjs` | `node --env-file=.env server.mjs` |
| `node server.js` | `node --env-file=.env server.js` |
| `npm.cmd start`，且 `package.json` 的 `scripts.start` 是 `node server.js` | 把该值改为 `node --env-file=.env server.js`，然后仍用 `npm.cmd start` |

保留应用实际的入口文件名，将 `--env-file=.env` 放在 `node` 后、文件名前。从 `.env` 所在目录启动。

框架已有环境变量加载方式时，沿用其启动命令和配置文件。修改配置后重启后端；系统中已有的同名环境变量优先于 `.env`。

对话和索引默认保存在 `data/memory.sqlite`，重启后按相同用户、角色和会话 ID 继续读取。部署时保留数据库文件，并将 `.env`、`data/` 加入 `.gitignore`。

使用远程 embedding 服务时，消息和查询会发送给该服务。[隐私说明](docs/privacy.md)

## 文档

[API](docs/sdk.md) · [接口兼容性](docs/compatibility.md) · [故障恢复](docs/sdk.md#timeouts-and-recovery) · [实验报告](docs/integration-validation.md)

## 来源与许可

检索核心复用 [LongMemory](https://github.com/CaviraOSS/LongMemory)。项目代码为 [MIT](LICENSE)，上游代码保留 [Apache-2.0](UPSTREAM-LONGMEMORY-LICENSE) 和 [NOTICE](NOTICE)；来源及修改见 [ATTRIBUTION](ATTRIBUTION.md)。
