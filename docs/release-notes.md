# 0.5.0-beta.3

[Download SDK](https://github.com/ziningshu-code/memory-system-mvp/releases/download/v0.5.0-beta.3/memory-system-v2-0.5.0-beta.3.tgz) · [Install and connect](../README.md#1-install) · [中文说明](../README.zh-CN.md)

This release adds `createMemoryChat` at `memory-system-v2/chat`. Configure it once with your existing OpenAI-compatible client and embedding provider, then replace the chat call with `chat.create()` and pass your application's user and conversation IDs.

The entry automatically retrieves older messages, adds bounded original evidence, calls the existing chat model and saves the completed visible exchange. It supports normal and streamed text replies. Memory failures do not discard a valid model response; cancelled or incomplete replies are not saved as completed exchanges.

The LongMemory retrieval core, original-message storage and low-level `createMemory()` API remain available. This release requires Node.js 22 or 24; the new chat entry is tested with OpenAI Node 7.42.

## Validation

Automated checks cover TypeScript, native SQLite, ordinary and streaming requests, automatic retrieval and saving, restart, and recovery after chat/embedding failures. The packaged SDK is also checked in a fresh installation with the official OpenAI client against a local test service.

The before/after integration in a real AI chat backend is documented in the attached [experiment report](integration-validation.md). It distinguishes live responses from automated checks and preserves timeout and display observations. The earlier retrieval benchmark is unchanged.

## Limits

This is a Node.js developer SDK. It does not include a chat application, proxy or setup page. The automatic entry handles text Chat Completions; tool calls, images and multiple choices pass through without automatic memory. Retrieval can miss relevant messages, and evidence budgets are estimates.

Use your own embedding service or local Ollama. External embedding providers receive messages and retrieval queries; your chat provider receives the selected evidence. There is no author-operated memory server. See [privacy](privacy.md) and the [integration guide](sdk.md).

## Earlier release

[0.5.0-beta.2](https://github.com/ziningshu-code/memory-system-mvp/releases/tag/v0.5.0-beta.2) contains the low-level memory API without the automatic chat entry. The beta.3 installation command uses a GitHub release asset directly and does not depend on npm's `beta` or `latest` tag.

Project code is MIT; the modified LongMemory core is Apache-2.0. Revision and modifications are recorded in [ATTRIBUTION](../ATTRIBUTION.md).
