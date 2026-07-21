# 架构与容量说明

[English](./ARCHITECTURE.md)

这是一份补充附录，用来解释 Topic Memory v0.1 的设计逻辑、容量推算和理论边界。正常安装和接入不需要阅读这份文档。

## 1. Topic Memory 真正扩展的是什么

Topic Memory **不会扩大 LLM 本身的 context window**。

它做的是把两个经常被混为一谈的东西拆开：

- **总共保存了多少对话历史**；
- **一次模型请求真正需要带上多少历史**。

传统 raw-history 方案通常接近：

```text
每次请求的历史 tokens
≈ 总 exchange 数 × 每个 exchange 的平均 tokens
```

Topic Memory 更接近：

```text
每次请求的 memory tokens
≈ 最近上下文
+ Topic Directory
+ 少量被重新打开的 Topic Packets
```

完整 Canonical Transcript 一直保存在存储层，不需要每次回复都重新发送。

## 2. v0.1 的检索成本

定义：

- `N` = 已保存的 completed exchanges 总数；
- `g` = 一个 topic 平均包含多少 exchanges；
- `d` = 一个 Topic Directory entry 平均占多少 tokens；
- `k` = 每次重新打开的 topic 数，v0.1 中 `k <= 3`；
- `t` = 一个 completed exchange 的平均 tokens；
- `r` = 最近上下文保留的 exchange 数，v0.1 固定为 `5`。

Topic 数量大约为：

```text
T ≈ N / g
```

Topic Directory 成本大约为：

```text
DirectoryTokens ≈ T × d
                ≈ (N / g) × d
```

最近上下文：

```text
RecentTokens ≈ r × t
             = 5 × t
```

如果一个被重新打开的 topic 平均包含 `g` 个 exchanges，那么最多三个 topic 的原始历史大约为：

```text
OpenedTopicTokens ≈ k × g × t
```

因此 v0.1 一次 memory retrieval 的粗略 prompt 成本可以写成：

```text
MemoryPromptTokens
≈ (N / g) × d
+ 5 × t
+ k × g × t
+ 固定 prompt 开销
```

这并不是 O(1) 的无限扩展方案，因为 v0.1 的 Topic Directory 仍然会随着 topic 数量增长。

它真正减少的是：**完整原始 transcript 不再随着 N 一起全部进入每一次请求。**

## 3. “600 → 5,000 exchanges”容量示例

下面只是一个理论容量计算，**不是 benchmark，也不是保证值或硬上限**。

假设：

- 模型 context window：`128,000 tokens`；
- 为 system prompt、当前输入、输出空间和其他上下文预留约 `8,000 tokens`；
- 可用于历史记录的 prompt budget 约 `120,000 tokens`；
- 一个 completed exchange（user + assistant）平均 `200 tokens`；
- 一个 topic 平均包含 `8 exchanges`；
- 一个 Topic Directory entry 平均约 `60 tokens`；
- 最近上下文固定 `5 exchanges`；
- 每次最多重新打开 `3 topics`。

### 完整历史直接塞 prompt

```text
120,000 / 200 = 600 exchanges
```

在这组假设下，如果每次都把全部历史重新发送，大约 **600 个 completed exchanges** 就已经接近 120k 的历史预算。

### Topic Memory 保存 5,000 exchanges

Topic 数量：

```text
5,000 / 8 = 625 topics
```

Topic Directory：

```text
625 × 60 = 37,500 tokens
```

最近 5 个 exchanges：

```text
5 × 200 = 1,000 tokens
```

最多打开三个 topic：

```text
3 × 8 × 200 = 4,800 tokens
```

小计：

```text
37,500 + 1,000 + 4,800 = 43,300 tokens
```

再给 Selector 指令、时间信息、格式等固定内容预留约 1,000–2,000 tokens，整个 memory 相关输入大约为：

```text
44,000–45,000 tokens
```

在这个示例中：

```text
5,000 / 600 ≈ 8.33×
```

因此，可以把它理解成：在同一组假设下，系统能够**索引并按需恢复**的 completed-exchange 历史跨度，从 raw-history 方案约 600 exchanges，提高到示例中的 5,000 exchanges，约 **8.3 倍**。

而如果真的把 5,000 exchanges 全部重新塞进 prompt：

```text
5,000 × 200 = 1,000,000 tokens
```

相比约一百万 tokens 的完整历史，Topic Memory 这个示例中的一次 memory retrieval 大约只有 44k–45k tokens，理论上减少约 **95%** 的历史 prompt 负载。

再次强调：

- 600 不是所有模型的固定极限；
- 5,000 不是 Topic Memory 的固定最大值；
- 8.3× 和 95% 都只属于这一组明确假设下的容量推算。

真实结果会受到以下因素影响：

- 用户和 assistant 每轮实际长度；
- tokenizer；
- 模型 context window；
- 平均 topic 大小；
- Topic Worker 的分组质量；
- Topic Directory entry 的长度；
- 每次被重新打开的 topic 大小。

## 4. 为什么 5,000 也不是硬上限

存储层本身可以保存超过 5,000 exchanges。

v0.1 更现实的扩展瓶颈是 **Topic Directory**。

因为 Memory Selector 当前会读取整个 Topic Directory，所以它的 prompt 成本近似：

```text
O(topic 数量)
```

如果平均每 8 个 exchanges 形成一个 topic，那么 5,000 exchanges 大约产生 625 个 topic entries。

历史继续扩大以后，Directory 自己最终会成为主要开销。

未来版本可以通过以下方式继续扩展：

- hierarchical topic directory；
- coarse-to-fine routing；
- 服务端 lexical / semantic pre-filter；
- 按时间分区的 directory；
- Selector 之前增加 vector / hybrid retrieval。

这些都不属于 v0.1 的范围。

## 5. 为什么不是只保存一份滚动 summary

滚动 summary 很便宜，但持续多次 summary-of-summary 可能会丢失：

- 精确措辞；
- 小细节；
- 时间顺序；
- 当时对话的上下文关系。

Topic Memory 保留两个不同层次：

1. **Topic metadata**：用于快速定位“过去聊过什么”；
2. **Canonical Transcript spans**：用于真正恢复“当时具体说了什么”。

所以 Topic Worker 的目标不是用一段摘要替换原始对话，而是建立一个能重新指回原始证据的索引。

这对于下面这类问题尤其重要：

- “我上个月跟你说那个项目的时候到底怎么说的？”
- “之前我们排除了哪个方案？”
- “我什么时候跟你提过这件事？”
- “当时那段对话具体发生了什么？”

Selector 先找到 topic，SDK 再打开这个 topic 后面的原始 exchanges。

## 6. 和 long-context memory 研究的关系

Topic Memory 的设计动机和 long-context LLM 研究中的一个普遍观察相符：**context window 变大，并不等于模型能稳定、均匀地利用长 prompt 中每一个位置的信息。**

相关研究包括：

- **Liu et al., “Lost in the Middle: How Language Models Use Long Contexts”**：研究显示，相关信息处于长上下文不同位置时，模型检索表现可能明显变化。
- **Maharana et al., “Evaluating Very Long-Term Conversational Memory of LLM Agents” (LoCoMo, ACL 2024)**：使用最长约 600 turns 的长期对话评估模型记忆，并指出长对话中的时间、因果和长期信息理解仍然具有挑战。
- **Banerjee et al., “APEX-MEM” (ACL 2026)**：研究半结构化、带时间信息的长期对话记忆，以及在 retrieval time 提取紧凑相关历史信息的思路。

Topic Memory v0.1 是独立实现，不声称复现上述论文的方法或 benchmark 结果。这里引用这些研究，只是为了说明“长期历史外部保存 + 回复时按需恢复相关证据”这一类设计选择的研究背景。

参考：

- https://arxiv.org/abs/2307.03172
- https://aclanthology.org/2024.acl-long.747/
- https://aclanthology.org/2026.acl-long.749/

## 7. 最准确的一句话描述

> Topic Memory 把不断增长的原始聊天记录，变成“持久化 transcript + 轻量 topic 索引”；每次新请求只定位并重新打开少量相关 transcript spans，而不是重新发送全部历史。

它的价值不是承诺一个固定的“最多能记住多少轮”，而是让**总历史规模**不再和**每一次模型调用的 prompt 大小**近似一比一增长。
