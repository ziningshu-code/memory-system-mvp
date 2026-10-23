# 在 PowerShell 里运行带记忆的聊天

这是 beta.2 底层 SDK 的独立命令行示例。给已有应用接入自动记忆，请看[新版接入说明](../README.zh-CN.md#接到已有聊天应用)。

这个教程会让你输入一句话，收到聊天模型的真实回复，再自动保存这轮对话。之后运行下一条命令时，程序会先查找相关旧消息。它使用现有 SDK，不会把插件装进其他聊天软件。

先准备 Node.js 22 或 24，以及两种接口配置：

- **聊天接口**：负责回答你的问题，需要服务商的 API 地址、模型名称和 Key。
- **Embedding 接口**：负责找旧消息。下面用 NVIDIA 的 `nvidia/nemotron-3-embed-1b`，需要 NVIDIA Key。

两个接口可以来自不同服务商。如果同一个服务商同时提供两种模型，也可以按它的权限使用同一个 Key。不要把聊天模型名称填到 embedding 模型这一项。

## 1. 安装并下载聊天脚本

打开 PowerShell，复制执行：

```powershell
New-Item -ItemType Directory -Force "$HOME\memory-chat-demo" | Out-Null
Set-Location "$HOME\memory-chat-demo"
npm.cmd init -y
npm.cmd install memory-system-v2@beta
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ziningshu-code/memory-system-mvp/main/examples-product/openai-compatible-chat.mjs' -OutFile chat.mjs
```

文件会放在你的用户目录下的 `memory-chat-demo` 文件夹。以后继续用这个文件夹，保存的记忆才会保持在同一位置。

如果下载失败，打开[聊天脚本](../examples-product/openai-compatible-chat.mjs)，把完整代码保存到这个文件夹，文件名为 `chat.mjs`。

## 2. 填配置

在同一个 PowerShell 窗口执行：

```powershell
if (-not (Test-Path .env)) { New-Item -ItemType File .env | Out-Null }
notepad .env
```

记事本里填入下面的内容。把四个 `replace_with_...` 换成你自己的信息，再按 **Ctrl+S** 保存：

```dotenv
EMBED_PROVIDER=nvidia
EMBED_BASE_URL=https://integrate.api.nvidia.com/v1
EMBED_MODEL=nvidia/nemotron-3-embed-1b
EMBED_DIMENSION=2048
EMBED_API_KEY=replace_with_your_nvidia_key
CHAT_BASE_URL=replace_with_your_chat_base_url
CHAT_MODEL=replace_with_your_chat_model
CHAT_API_KEY=replace_with_your_chat_api_key
MEMORY_DB_PATH=./chat-memory.sqlite
MEMORY_SESSION_ID=my-chat
```

| 需要替换的项 | 填什么 |
| --- | --- |
| `EMBED_API_KEY` | 完整的 NVIDIA Key。 |
| `CHAT_BASE_URL` | 聊天服务商给你的 OpenAI-compatible API 基础地址，通常以 `/v1` 结尾。不填网页地址，也不附加 `/chat/completions`。 |
| `CHAT_MODEL` | 服务商提供的聊天模型标识，按原样填写。 |
| `CHAT_API_KEY` | 这个聊天接口使用的完整 Key。 |

Key 前面不要加 `Bearer`。`.env` 不要上传到 GitHub，也不要把 Key 发给别人。

保存的消息和检索问题会发送给配置的 embedding 服务，聊天请求会发送给聊天服务。两者都可能产生服务商费用。

## 3. 发第一条消息

回到 PowerShell，执行：

```powershell
node --env-file=.env chat.mjs "我计划去东京，酒店预算是每晚14000日元，想住上野。"
```

终端会显示你的聊天模型生成的回复，内容因模型而异。程序随后把用户消息和这条真实回复保存到 `chat-memory.sqlite`。

## 4. 再问一次

第一条命令结束后，继续执行：

```powershell
node --env-file=.env chat.mjs "我之前说的东京酒店预算是多少，想住哪个区域？"
```

程序会检索本地历史，再把找到的原文交给模型。模型应该据此回答“每晚14000日元、上野”；如果没找对，可能答不出来。这一步检查接入流程，不是长对话压力测试。

这个命令行示例每次接收一个问题，不会一直显示输入框。继续聊天就重复这条命令，替换引号里的问题。后续可运行：

```powershell
Set-Location "$HOME\memory-chat-demo"
node --env-file=.env chat.mjs "你的下一个问题"
```

保持 `MEMORY_SESSION_ID` 不变才能检索同一会话。换一个 ID 会进入另一个会话。不要移动或删除数据库文件，除非你想使用一份新的记忆。

## 出错时看哪里

| 看到的错误 | 检查什么 |
| --- | --- |
| 找不到 `node` 或 `npm.cmd` | 安装 Node.js 22/24 后重新打开 PowerShell。 |
| 找不到 `.env` 或 `chat.mjs` | 先执行上面的 `Set-Location`，文件名不要带 `.txt`。 |
| `CHAT_BASE_URL is required` 或 `CHAT_MODEL is required` | `.env` 没填完整，或保存到了别的文件夹。 |
| `Main LLM returned HTTP 401/403` | 聊天 Key、接口权限是否正确。 |
| `Main LLM returned HTTP 404` | 聊天地址和模型名是否正确；地址不要重复带 `/chat/completions`。 |
| `memory indexing failed` | 聊天已回答，但记忆索引没有成功；检查 NVIDIA Key、模型权限和网络。 |
| `Memory retrieval failed` | 本次没有成功取出旧记忆，程序仍会尝试正常回答。 |

`.sqlite` 文件出现说明数据库已创建，但不能单凭文件存在就认定某条记忆已成功检索。把错误信息留下来排查，不要反复改模型参数或重新安装。

## 如果你要接到自己开发的软件

上面是一个能运行的命令行示例。给已有应用接入时，找到处理聊天请求的那段代码：

1. 调用聊天模型**之前**，用 `recall()` 检索，把 `context` 作为历史参考加入请求。
2. 聊天模型**完成回复之后**，用 `remember()` 保存用户原话和真实回复。

这两个步骤写进程序后，每轮自动执行。还要由应用处理近期聊天、用户权限、失败日志和流式回复结束时的保存。具体参数见 [SDK 文档](sdk.md)。
