# Local storage and privacy

The SDK keeps original visible user/assistant text and derived LongMemory state in a local SQLite file. Default path: `~/.memory-system-mvp/memory.sqlite`. Set `dbPath` for a different location. It does not require a hosted memory service, central project server, Docker, or external vector database.

**Local storage does not mean all processing stays local.** When using a remote embedding provider, original source text and recall queries are sent to that provider. The host application separately sends its selected recent/history context to its Main LLM. Use a real local Ollama/custom embedder if remote embedding transfer is unsuitable. Provider privacy/retention and billing policies remain the user's responsibility.

Keys are provided by the application, not stored by this SDK in transcript rows. Keep local environment files out of Git. This package ships no project API key, hosted endpoint or private application source. Benchmark conversations are authored synthetic fixtures, not user chat exports. No built-in telemetry is enabled by the product layer.

`erase` is logical conversational erasure: the paired turn disappears from normal history/recall, its text is cleared, and affected derived state is rebuilt. The operation may incur embedding requests for surviving sources. It does not securely wipe SQLite free pages, WAL files, operating-system snapshots, logs, or backups. Erase every other turn that repeats sensitive information, and manage those external copies separately. Historical queries do not resurrect erased sources.

Stable tenant/owner/session IDs isolate retrieval records inside the application; they are not authentication or authorization. The host must control these identifiers. Default IDs are for one local user. The database is not encrypted by the SDK; use filesystem permissions and device encryption appropriate to your deployment.

Retrieved historical quotations may contain untrusted text. Keep them clearly separated from current instructions. Store only actual visible speech after a successful Main LLM response. A private application has been used for integration validation, but its source, patches, identifiers and configuration are excluded from this public repository and npm artifact.
