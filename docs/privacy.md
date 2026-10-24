# Storage and privacy

## What is saved

The SDK saves user messages, assistant replies and search data in one local SQLite file. The default is `~/.memory-system-mvp/memory.sqlite`; set `dbPath` to change it. The database is not encrypted by the SDK.

## What leaves your computer

Remote embedding providers receive the saved messages and recall queries. The chat client sends the selected context to your chat model. Embeddings stay on your computer when you use a local Ollama instance or a custom embedder that runs entirely locally; a custom embedder can also contact remote services.

There is no hosted memory backend or built-in telemetry in the product layer. API keys are supplied by your application and are not saved in transcript rows. Keep keys and local `.env` files out of Git. Check your provider's retention and billing policies before sending private conversations.

## Deletion

`erase()` deletes the paired exchange from history and recall, clears its saved text and updates search data. Deleted messages cannot be retrieved by historical queries. Updating search data may make new embedding requests.

This is logical deletion: SQLite free pages, WAL files, backups, logs and device snapshots are not securely wiped. Delete other messages that repeat the information and manage external copies separately.

## Application responsibilities

- Control the tenant, owner and session IDs. These separate records; they do not authenticate users.
- Protect the database with filesystem permissions and device encryption where needed.
- Treat retrieved text as historical quotations, not instructions.
- The automatic chat entry saves completed text exchanges without its injected memory block. If your application adds internal reply tags or changes text before displaying it, adapt that boundary so memory receives the visible text.
- With the low-level API, save the visible conversation only; do not save injected memory context as user speech.
