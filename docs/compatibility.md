# Interface compatibility

The automatic entry wraps **OpenAI-style Chat Completions** through the JavaScript OpenAI client. That is an API shape, not a requirement to buy an OpenAI model. The endpoint must accept `messages`, return compatible completion objects, and report successful text completion with `finish_reason: 'stop'`.

| Interface | Current automatic entry |
| --- | --- |
| Chat Completions, ordinary or streamed text | Supported shape; NVIDIA GPT-OSS-20B was used in the real App test |
| DeepSeek OpenAI-compatible endpoint | Officially documented compatible interface; not live-tested with this SDK |
| Gemini OpenAI-compatible endpoint | Officially documented compatibility layer; not live-tested with this SDK |
| Claude OpenAI SDK compatibility layer | Officially documented compatibility layer with limitations; not live-tested with this SDK |
| Ollama Chat Completions endpoint | Officially documented compatible interface; not live-tested with this wrapper |
| OpenAI Responses API | No automatic adapter in this release |
| Native Claude Messages / native Gemini APIs | No automatic adapter in this release |
| Tools, images, multiple output choices or unsupported message shapes | Forwarded to the existing client without automatic memory |
| Browser, iOS/Android app directly, Python runtime | Not this Node.js package; integrate it in a Node.js backend |

Provider compatibility is not a promise that every model, parameter or streaming extension works. This wrapper does not install itself into ChatGPT, Claude, Codex or other finished apps.

Chat and embeddings are separate configurations. A compatible chat endpoint need not provide embeddings. Use the embedding service's own URL, model, key and dimension.

There is no need for a separate package for each model name. Providers sharing Chat Completions can use the same entry. Other protocol families need separate adapters; none are claimed here.

Official references, checked 2026-10-24:

- [DeepSeek API](https://api-docs.deepseek.com/)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Claude OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
