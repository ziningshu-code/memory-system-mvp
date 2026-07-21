# Architecture & Capacity Notes

[简体中文](./ARCHITECTURE.zh-CN.md)

This appendix explains the design assumptions behind Topic Memory v0.1. It is not required for installation or integration.

## 1. What Topic Memory actually scales

Topic Memory does **not** increase an LLM's native context window.

Instead, it separates two quantities that are often treated as if they were the same:

- **stored conversation history** — how much history the application can preserve;
- **per-request prompt history** — how much of that history must be sent to a model for one reply.

A raw-history design tends toward:

```text
per-request history tokens ≈ total exchanges × average tokens per exchange
```

Topic Memory tends toward:

```text
per-request memory tokens
≈ recent context
+ Topic Directory
+ a small number of reopened topic packets
```

The full Canonical Transcript remains in storage and is not replayed on every request.

## 2. The v0.1 retrieval path

Let:

- `N` = total completed exchanges stored;
- `g` = average exchanges represented by one topic;
- `d` = average tokens in one Topic Directory entry;
- `k` = number of reopened topics, with `k <= 3` in v0.1;
- `t` = average tokens per completed exchange;
- `r` = number of recent exchanges, fixed at `5` in v0.1.

The approximate number of topics is:

```text
T ≈ N / g
```

The Topic Directory cost is approximately:

```text
DirectoryTokens ≈ T × d
                ≈ (N / g) × d
```

The recent-context cost is approximately:

```text
RecentTokens ≈ r × t
             = 5 × t
```

If a reopened topic contains roughly `g` exchanges, the maximum reopened historical text is approximately:

```text
OpenedTopicTokens ≈ k × g × t
```

So a rough v0.1 memory prompt estimate is:

```text
MemoryPromptTokens
≈ (N / g) × d
+ 5 × t
+ k × g × t
+ fixed prompt overhead
```

This is not constant-time retrieval: the v0.1 Topic Directory grows with the number of topics. The important difference is that the full raw transcript does not grow inside every prompt.

## 3. Illustrative 600 → 5,000 exchange sizing example

The following is a capacity calculation, **not a benchmark result and not a guaranteed maximum**.

Assume:

- model context window: `128,000 tokens`;
- approximately `8,000 tokens` reserved for system instructions, current input, output headroom, and other application context;
- available historical prompt budget: approximately `120,000 tokens`;
- average completed exchange: `200 tokens` across user + assistant;
- average topic size: `8 exchanges`;
- average Topic Directory entry: `60 tokens`;
- recent context: `5 exchanges`;
- maximum reopened topics: `3`.

### Raw-history approach

```text
120,000 / 200 = 600 exchanges
```

Under these assumptions, replaying every historical exchange reaches the approximate historical prompt budget at around **600 completed exchanges**.

### Topic Memory with 5,000 stored exchanges

Number of topics:

```text
5,000 / 8 = 625 topics
```

Topic Directory:

```text
625 × 60 = 37,500 tokens
```

Recent context:

```text
5 × 200 = 1,000 tokens
```

Up to three reopened topics:

```text
3 × 8 × 200 = 4,800 tokens
```

Subtotal:

```text
37,500 + 1,000 + 4,800 = 43,300 tokens
```

Allowing roughly 1,000–2,000 additional tokens for selector instructions, timestamps, formatting, and other fixed overhead gives an illustrative total of approximately:

```text
44,000–45,000 memory-related tokens
```

In this example:

```text
5,000 / 600 ≈ 8.33×
```

So the system can *represent and selectively reopen* about **8.3× more completed-exchange history** than the raw 600-exchange prompt example, while keeping the memory-related prompt far below the cost of replaying all 5,000 exchanges.

For comparison, replaying all 5,000 exchanges at 200 tokens each would be roughly:

```text
5,000 × 200 = 1,000,000 tokens
```

The illustrative Topic Memory retrieval prompt of ~44k–45k tokens is about **95% smaller** than replaying that full one-million-token history.

Again: these numbers describe one set of assumptions. They do not mean Topic Memory guarantees exactly 5,000 exchanges or that 600 exchanges is a universal limit.

## 4. Why 5,000 is not a hard maximum

The storage layer can preserve more than 5,000 exchanges. v0.1's more relevant scaling constraint is the Topic Directory.

Because the selector currently sees the entire Topic Directory, its prompt cost grows approximately with:

```text
O(number of topics)
```

If topics average eight exchanges each, 5,000 exchanges produce about 625 topic entries. If the archive becomes much larger, the directory itself eventually becomes the dominant prompt cost.

A future version could reduce this cost with techniques such as:

- hierarchical topic directories;
- coarse-to-fine topic routing;
- server-side lexical or semantic pre-filtering;
- time-partitioned directories;
- vector or hybrid retrieval before the Memory Selector.

Those are intentionally outside v0.1.

## 5. Why topics instead of a single rolling summary

A rolling summary is cheap, but repeated summarization can discard exact details and flatten chronology.

Topic Memory keeps two different representations:

1. **Topic metadata** for lightweight discovery.
2. **Canonical Transcript spans** for exact recovery.

The Topic Worker is therefore not trying to replace the original conversation with a summary. It creates an index that points back to the original evidence.

This matters when the user asks questions such as:

- "What did I say about that project last month?"
- "Which option did we reject before?"
- "When did I tell you that?"
- "What exactly happened in that earlier conversation?"

The selector can identify a topic, then the SDK can reopen the original exchanges behind it.

## 6. Long-context research context

The design motivation is consistent with a broader observation in long-context LLM research: a larger context window does not automatically imply perfect retrieval from every position in a long prompt.

Related work includes:

- **Liu et al., "Lost in the Middle: How Language Models Use Long Contexts"** — shows that retrieval performance can depend strongly on where relevant information appears in long input contexts.
- **Maharana et al., "Evaluating Very Long-Term Conversational Memory of LLM Agents" (LoCoMo, ACL 2024)** — evaluates conversations of up to 600 turns and reports that long-term conversational memory remains challenging even with long-context and retrieval approaches.
- **Banerjee et al., "APEX-MEM: Agentic Semi-Structured Memory with Temporal Reasoning for Long-Term Conversational AI" (ACL 2026)** — explores semi-structured, temporally grounded memory with retrieval-time resolution of relevant historical information.

Topic Memory v0.1 is an independent implementation and does not claim to reproduce the methods or benchmark results of those systems. These references are included only as context for the general design choice of storing long history externally and retrieving compact, relevant evidence at reply time.

References:

- https://arxiv.org/abs/2307.03172
- https://aclanthology.org/2024.acl-long.747/
- https://aclanthology.org/2026.acl-long.749/

## 7. Practical interpretation

The safest way to describe v0.1 is:

> Topic Memory converts an ever-growing raw transcript into a persistent archive plus a lightweight topic index, then reopens only a few relevant transcript spans for each new request.

Its benefit is not a guaranteed number of remembered exchanges. Its benefit is that the amount of conversation you can preserve becomes much less tightly coupled to the amount of conversation you must resend on every model call.
