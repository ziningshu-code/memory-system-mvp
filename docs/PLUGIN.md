# Local plugin setup / 本地插件

## Setup

Node.js 20.6+ is required. Run `npx --yes topic-memory@0.2.0` (`npx.cmd` in Windows PowerShell). Open the printed loopback address. Save your own Base URL, model ID and API key. The optional memory model shares the endpoint/key with the main model. For local unauthenticated providers, leave Key blank. No author key is required.

From GitHub ZIP: extract, then double-click `start.cmd` on Windows, or run `npm ci` and `npm start`. Restart in the same folder. Configuration is created automatically; no hidden existing file is needed.

## Connecting an application

Copy all three fields from the setup page:

```text
Base URL: http://127.0.0.1:4318/sessions/my-conversation/v1
API key: <local connection key from the page, not the provider key>
Model: <the configured main model ID>
```

Your client must allow a custom OpenAI-compatible Base URL, run on this computer and reach loopback directly. No particular third-party client is certified by the included protocol tests. Cross-origin browser applications, container clients and remote/cloud apps do not work directly with this loopback-only setup.

Each session address represents **one conversation**. Reusing it in two chats combines their memory; generate a new session on the page for a new chat. Clients supporting headers may use `/v1` with `X-Memory-Session: my-conversation`. Without a session path/header/body, `/v1` uses one `default` session. Do not share a data directory among users.

Only the configured main model is advertised. The provider key stays on the gateway; clients use the generated local connection key. Keep the local key private because it grants access to memory and model usage.

## Request behavior

Text-only Chat Completions and model listing are supported. New sessions import complete user/assistant pairs supplied before the final user message. Later turns use stored recent context and topic retrieval, preserving system/developer instructions. Same-session turns are serialized and the model reply is stored before return. Failed requests are not included as completed history.

Editing/regenerating older turns, tool calls, images, structured output and multiple candidates are unsupported. Incompatible requests return errors. Use a new session when branching. `stream: true` produces SSE after the full response and storage update; there is no incremental token display yet.

Topic indexing follows successful replies and adds model latency; retrieval can also add a selector request. Each provider request has a 90-second timeout. The page reports worker/selector failures; a saved reply does not imply successful indexing.

## Local data and recovery

- Default: `.topic-memory` under the launch folder; `--data-dir PATH` selects a fixed location.
- `config.json` contains provider settings, a plaintext provider key and local connection key. It is not served as a static file or included in npm/Git.
- `sessions/ID.json` contains raw exchanges, topic index and last worker trace. Writes use temporary files and atomic rename. Malformed existing files produce errors rather than silently resetting history.
- `evaluation.json` contains the latest page-triggered diagnostic over public synthetic material.
- A process lock prevents simultaneous gateways on the same directory. Stale PID locks are recovered when the process no longer exists. If a stored PID was reused by another process, verify the original gateway is stopped before manually removing `server.lock`.
- Back up the directory with the plugin stopped and preserve it across upgrades. Never publish the directory.

This adapter targets small personal deployments. It reads whole JSON files; directories and indexing windows grow with history. A conservative character cap rejects very large recovered contexts rather than silently discarding evidence; it is not a tokenizer-aware budget. Raw records stay stored on failure.

## Real evaluation

Save configuration, then run the comparison on the page or `npm run evaluate:plugin` in the source checkout. The latter uses `.topic-memory/config.json`; `TOPIC_MEMORY_DATA_DIR` overrides that location. Public synthetic material is sent to your provider and can consume credits.

The test imports 24 exchanges sequentially, calling the real worker every three turns starting at turn six. Four questions compare recent-five, full-history and topic-memory. Indexing, selection and answering calls are recorded. Inspect errors and raw answers: four literal checks do not establish a benchmark accuracy estimate. The live test uses no scripted model responses.

## Troubleshooting / 常见问题

| 情况 | 处理 |
| --- | --- |
| PowerShell 禁止 npm.ps1 | 使用 `npm.cmd` / `npx.cmd`，不用改系统执行策略 |
| 4318 被占用 | 打开已有插件，或加 `--port 4319` |
| 401/403 | 检查服务商 Key、权限；客户端填页面上的本地连接 Key |
| 404 | Base URL 通常到 `/v1` 为止，不含 `/chat/completions` |
| 空回答或 JSON 检查失败 | 模型可能仅返回推理内容或不遵循 JSON，尝试兼容模型 |
| 旧内容找不回 | 至少完成六轮，查看整理/检索错误，并运行真实对比 |
| 重启后不见记录 | 检查启动目录是否改变，并选择原会话 |
| 不同聊天串记忆 | 为每个聊天分配独立会话地址 |
| 测试连接通过但客户端失败 | 检查纯文本 Chat Completions、自定义地址和是否运行于容器 |
