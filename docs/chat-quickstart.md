# Chat from PowerShell

This guide sends a question to your real chat model, prints its reply and saves the exchange. The next command searches older messages before calling the model. It uses the SDK; it does not install a plugin into another chat application.

You need Node.js 22 or 24, a chat endpoint/model/key, and an embedding provider. This example uses NVIDIA `nvidia/nemotron-3-embed-1b` for embeddings. Chat and embeddings can use different providers. A chat model name cannot substitute for an embedding model.

## 1. Install and download the script

```powershell
New-Item -ItemType Directory -Force "$HOME\memory-chat-demo" | Out-Null
Set-Location "$HOME\memory-chat-demo"
npm.cmd init -y
npm.cmd install memory-system-v2@beta
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ziningshu-code/memory-system-mvp/main/examples-product/openai-compatible-chat.mjs' -OutFile chat.mjs
```

Use this same folder on later runs. If downloading fails, copy the [complete script](../examples-product/openai-compatible-chat.mjs) into `chat.mjs` in the folder.

## 2. Configure the providers

```powershell
if (-not (Test-Path .env)) { New-Item -ItemType File .env | Out-Null }
notepad .env
```

Paste the following into Notepad, replace all four `replace_with_...` values, then save with **Ctrl+S**:

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

| Field to replace | Value |
| --- | --- |
| `EMBED_API_KEY` | Your complete NVIDIA key. |
| `CHAT_BASE_URL` | Your provider's OpenAI-compatible chat API base URL, commonly ending in `/v1`. Use the API address, not a web page, and do not append `/chat/completions`. |
| `CHAT_MODEL` | The exact chat model identifier from your provider. |
| `CHAT_API_KEY` | The complete key for that chat endpoint. |

Do not prefix keys with `Bearer`. Keep `.env` private. If one provider supports both services, the same key may be usable for both according to its permissions. Saved messages and queries go to the embedding provider; chat requests go to the chat provider. Both can incur costs.

## 3. Send a message

```powershell
node --env-file=.env chat.mjs "我计划去东京，酒店预算是每晚14000日元，想住上野。"
```

The terminal prints your model's real reply. The wording varies. The completed exchange is saved in `chat-memory.sqlite`.

## 4. Ask about it

```powershell
node --env-file=.env chat.mjs "我之前说的东京酒店预算是多少，想住哪个区域？"
```

The script retrieves earlier source text before asking the model. It should be able to answer 14,000 yen per night and Ueno if retrieval succeeds. This is an integration check, not a long-conversation benchmark.

The example accepts one question per invocation. Replace the quoted question to continue:

```powershell
Set-Location "$HOME\memory-chat-demo"
node --env-file=.env chat.mjs "你的下一个问题"
```

Keep `MEMORY_SESSION_ID` unchanged to reuse a conversation. A different ID starts a separate session. Keep the database file in place to retain memory.

## Troubleshooting

| Error | Check |
| --- | --- |
| `node` or `npm.cmd` not found | Install Node.js 22/24 and reopen PowerShell. |
| `.env` or `chat.mjs` not found | Run `Set-Location` first and check the files do not end in `.txt`. |
| Missing `CHAT_BASE_URL` or `CHAT_MODEL` | Complete `.env` in this folder and save it. |
| Chat HTTP 401/403 | Chat credentials and permissions. |
| Chat HTTP 404 | Chat base URL and model; do not duplicate `/chat/completions`. |
| Memory indexing failed | The reply is saved but not indexed. Check embedding credentials, permissions and network. |
| Memory retrieval failed | Older evidence was unavailable; the script still tries the chat request. |

The presence of a database file only confirms creation, not successful retrieval of a particular message.

## Connect an existing application

Find the code that handles a chat request. Before calling the model, call `recall()` and include its `context` as historical data. After a successful completion, call `remember()` with the visible user message and real reply. Once these steps are in your program, they run automatically.

Your application still manages recent context, authentication, error logging and saving after streamed replies finish. See the [SDK guide](sdk.md) for parameters.
