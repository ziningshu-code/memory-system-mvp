# 开发者接入

新流程使用 `createTopicMemory`。旧 `createMemory` 接口仍保留 0.2 行为，不会自动切换算法。

```ts
import { createTopicMemory, createOpenAICompatibleMemoryLlm, MEMORY_TOOL_GUIDANCE } from 'topic-memory';
import { FileMemoryStorage } from 'topic-memory/node';

const memory = createTopicMemory({
  storage: new FileMemoryStorage('./data/conversation.json'),
  llm: createOpenAICompatibleMemoryLlm({
    baseUrl: process.env.MODEL_BASE_URL!,
    model: process.env.MODEL_NAME!,
    apiKey: process.env.TOPIC_MEMORY_API_KEY,
  }),
});
```

宿主完成真实回复后，把自己拿到的消息、时间和稳定回合 ID 交给 `memory.append(...)`。在回复完成后的后台安排 `memory.index()`；默认不足 8 条时不会调用模型。尾批可以显式 `index({flush:true})`。

把以下两项注册为宿主模型的工具，并使用 `MEMORY_TOOL_GUIDANCE` 说明调用条件：

- `memory_search(query, directoryOffset)` → `memory.recall({query, directoryOffset})`。
- `memory_open(topicIds, offset, order)` → `memory.open(topicIds, offset, order)`，支持组 ID 或片段 ID；order 为 `earliest` 或 `latest`。

模型请求工具后，宿主实际执行该操作，把返回的原文作为工具结果发送回主模型，再生成回答。单纯导入 SDK 不会自动接管聊天软件；主模型的普通上下文由宿主负责。

Worker 与 Selector 默认共用一个模型。也可分别提供适配器；不要求下载者拥有两个模型。其他接口可自行实现 `MemoryLlm.complete`。

默认使用话题组协议。Worker 返回 `{topics, assignments, links}`：卡片用简短 `scope`、`labelTerms` 和 `retrievalTerms` 帮助定位原文，分组边界允许近似；每个输入回合号必须在 `{sequence, topicIndex, change}` 中出现一次。`links` 用 `{fromTopic, toTopic, kind, sequence, quote}` 连接本批两张卡，或用 `toFamily` 指向已提供的旧组 ID；`kind` 为 `same_event`、`related`、`separate`。`quote` 必须逐字摘自该回合原文。程序核对引用、原文来源和互相冲突的关系，生成组 ID 与区间；旧卡片不重写。引文可供核查，但不能证明模型的语义判断正确。专有名称应保留原写法。

旧自定义 Worker 使用 `familyMode:false`，沿用旧分配或显式 spans 协议，不能与组协议混用。修复后，可用 `index({flush:true, retryFailed:true})` 显式重试失败批次。

短标签数量超出字段限制时，程序可无损拼接，保留全部文字；不会据此猜测分类或补写遗漏的分配。超出总长度预算的卡片仍会被拒绝。

支持 JSON 输出约束的 API 可在 `createOpenAICompatibleMemoryLlm` 配置中设置 `jsonMode:true`，原生配置命令可加 `--json-mode`。支持推理强度参数的服务还可配置 `reasoningEffort`；推理模型占用输出长度时，可分别设置 `workerMaxTokens` 和 `selectorMaxTokens`。不支持的接口或截断输出会明确报错，不自动降级或重试；格式约束不保证语义正确。

可选 `embedding:{id, embed(texts,inputType)}` 由接入者提供：新卡片生成一次向量并保存，查询时额外生成查询向量。id 必须标识提供方、模型和维度，变更后也要改 id。旧卡片不会自动重新计算。失败时提示并回退关键词，默认不需要此服务，原生插件当前使用本地关键词候选。向量用量须单独计入成本。

原文包含序号和毫秒时间戳。选中的组过长时，本地词语命中可让首包从匹配的原文开始，`unreadPrefix:true` 表示按当前顺序排在本页之前的原文未读；按最新到最早读取时，它们是更新的记录。前后对比问题可能返回最早和最新两个有预算上限的证据窗口。证据不足时用同样的问题和 `nextDirectoryOffset` 查下一页；原文未读完时用 `open([topicId], nextOffset, order)` 继续，若要读本页之前的原文则从偏移量 0 打开。`spansOmitted:true` 表示为保留原文预算而省略了冗长的交错区间列表，`spanCount` 是原区间数量，每条返回原文仍有序号和时间。Selector 请求 `includeRelated` 时，程序可用剩余名额补充直接关联组；名额不够时在 trace 中列出遗漏 ID，并标记本次结果未完整。不能把截断片段称为完整证据。分页可能截在 JSON 字符串中间，需要时按顺序拼接。`familyDirectory(query,offset)` 可检查候选组；配置向量时它也会调用查询向量服务。

默认每批 8 条，Worker 候选最多 10 组，Selector 每页候选最多 12 组、选择最多 3 组。Worker、目录、原文预算分别为 32,000、24,000、24,000 个 UTF-8 字节；模型输出上限另设，Worker 默认 2,400、Selector 默认 300，对消耗推理 token 的模型可调。Worker 为候选预留空间，因此部分低于总预算的长记录仍可能保持待索引。提供 `tokenCounter` 后才按其计数，默认字节数不能宣传为 token 数。目录预算外还有问题和指令开销，原生 Codex 输出上限是提示约束，不是硬性计费上限。

重复提交相同来源 ID 不会重复入库；修改已有原文会被拒绝。模型失败、非法 JSON、遗漏记录、重叠区间、伪造话题 ID 都有明确错误。不要把调用失败解释成“用户没说过”。同一份失败输入不会逐轮自动重试；修复后可显式重试。

过长记录可能保持“未索引”，预览无法保证覆盖末尾事实，但完整原文仍在。索引目录增长后也可能需要多次检索。返回的 `complete` 只表示本次传输和分页状态，不是语义召回率保证。

每个用户/项目使用独立存储。核心实例内部串行写入；自行开发的多进程宿主要提供事务存储或限制为单写者。原生接入增加了本地文件锁，按项目路径隔离。大型档案的文件读取性能尚未验证。

更多方法签名和边界见[英文接入说明](./USAGE.md)。
