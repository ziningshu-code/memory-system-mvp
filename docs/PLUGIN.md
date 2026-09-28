# 安装与使用 / Installation

0.3 是实验候选版。Codex CLI 的本地安装与跨会话检索已做真实检查；Claude Code 仅检查过适配包和 MCP 协议。VS Code 内的 Codex、桌面应用以及其他宿主尚未分别实测。

## Codex

安装 Node.js 和 Codex CLI，并先确认自己的 Codex 可以正常回答。下载这一版本的源码后，在源码文件夹执行：

```powershell
npm.cmd ci
npm.cmd run build:native
node integrations/runtime/cli.mjs configure --provider codex --model gpt-5.6-luna
node integrations/runtime/cli.mjs install-codex
```

使用自己可用的模型名称。重新开启 Codex 会话，首次认可自动保存 hooks 和工具权限。Codex 自身的权限提示仍然有效，插件不会关闭沙盒或替用户永久批准全部工具。

安装器将本插件复制到 `~/plugins/topic-memory`，在个人插件目录 `~/.agents/plugins/marketplace.json` 添加这一项，并调用 Codex 的插件安装命令。它保留其他插件；遇到同名但来源不同的内容会停止。为兼容已测试的 Windows Codex 版本，安装器自动写入 MCP 启动脚本的本机路径；不要求用户编辑路径。

仍然在 Codex 里聊天。必须在同一项目路径下使用，才会读到该项目的记忆。文件夹改名、不同工作树或更换路径会得到不同档案。插件保存用户消息和最终文本回复，不保存完整工具调用轨迹、图片或分支关系。

在自己的项目目录中检查状态；将下面路径替换为最初解压的源码目录，或在已全局安装本地包时直接使用 `topic-memory status`：

```powershell
node <源码目录>/integrations/runtime/cli.mjs status
```

不足 8 条的记录也保存原文，只是还未做完整话题整理。开发者可显式运行 `index` 处理尾批；普通用户不需要逐轮操作。失败记录和调用情况在本地 `activity.jsonl` 中，不会自动上传给作者。

## 使用自己的模型 API

如果选择兼容 Chat Completions 的服务，先在自己的终端设置环境变量 `TOPIC_MEMORY_API_KEY`，然后配置自己的地址和模型：

```text
node integrations/runtime/cli.mjs configure --provider openai-compatible --base-url <包含v1的服务地址> --model <自己的模型名称>
```

无需鉴权的本地服务可以不设置 Key。配置文件只保存服务地址、模型名和 Key 的环境变量名称，不保存 Key 本身。启动宿主时必须继承该环境变量；不要把 Key 放进仓库或聊天消息。SDK 可使用其他提供方适配器。

接口支持 JSON 输出约束时，可在配置命令末尾加 `--json-mode`。推理模型需要更多输出空间且服务支持相应参数时，可加 `--reasoning-effort medium --worker-max-tokens 6400 --selector-max-tokens 1600`；这些值仅是配置示例，应按实际模型测试。上述选项不保证语义归组正确；不支持的接口会明确报错。向量候选检索目前由 SDK 适配器选择接入，原生插件默认使用本地关键词候选。

## Claude Code：尚未完成真实验证

构建后，按 Claude Code 官方的本地插件方式加载 `integrations/claude-code/topic-memory`：

```text
claude --plugin-dir <源码目录>/integrations/claude-code/topic-memory
```

先按上文配置后台模型。拥有 Claude Code 订阅并不等于拥有第三方模型 API Key。本项目没有验证通过 Claude 订阅直接运行后台 Worker/Selector。未登录真实 Claude 账户前，不把这个适配包列为实测兼容。

## 数据与卸载

默认数据目录为用户目录下的 `.topic-memory`，可通过 `TOPIC_MEMORY_HOME` 指定。原文和活动日志均为本地未加密文件；活动日志可能含检索问题。新批次、目录及被选择的原文会发送给配置的模型服务；SDK 宿主也会收到检索结果。

安装命令会输出插件标识，默认是 `topic-memory@personal`。卸载使用：

```text
codex plugin remove topic-memory@personal
```

如果已有个人插件目录使用其他名称，使用安装命令输出的那个标识。卸载会停止后续捕获，不会删除档案。需要彻底清除时，先确认并备份自己的数据目录，再自行删除相应项目档案。

官方接口参考：[Codex 配置](https://learn.chatgpt.com/docs/config-file/config-reference)、[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Claude Code 插件](https://code.claude.com/docs/en/plugins-reference)。
