# Memory System MVP — 第二代

这是一个在用户本地运行的 Node.js 对话记忆 SDK，**使用并扩展了经过修改的 LongMemory 核心**。它先保存用户与助手的原话，再建立语义索引；检索结果回到原文，返回带来源编号的历史证据。应用继续使用自己的聊天模型。

正常记忆流程没有额外的生成模型调用，但**需要真实 embedding 服务或自定义本地 embedding 模型**。外部 embedding 会接收待索引的原文和查询，并可能产生费用。当前版本没有附带代理服务器、配置页面或浏览器 SDK。

## 安装

使用 Node.js 22 或 24。SQLite 原生依赖需要对应预编译文件或编译工具。当前安装包已经在本地准备，尚未公开发布：

```sh
npm install ./memory-system-mvp-0.5.0-beta.1.tgz
```

```js
import { createMemory } from 'memory-system-mvp';
const memory = createMemory({
  embedding: {
    kind: 'openai', baseUrl: 'https://your-embedding-provider.example/v1',
    model: 'your-embedding-model', apiKey: process.env.EMBED_API_KEY,
    dimension: 1024, // 必须填写模型真实的向量维度
  },
});
await memory.remember({ sessionId: 'chat', turnId: 'turn-1',
  user: '我的预约是周二上午九点十五分。', assistant: '收到，周二九点十五分。' });
const recalled = await memory.recall({ sessionId: 'chat', query: '预约在什么时候？' });
console.log(recalled.context);
await memory.close();
```

完整接入见[通用聊天示例](examples-product/openai-compatible-chat.mjs)与 [SDK 文档](docs/sdk.md)。数据库默认保存在 `~/.memory-system-mvp/memory.sqlite`。`remember` 先保存原文，embedding 失败会返回失败来源编号；`rebuild` 可以从原文恢复索引，可能产生重新 embedding 的费用。

## 两代之间的关系

第一代是独立设计的话题记忆架构：Topic Worker 整理短话题索引，Selector 选择候选，再展开原文。后续实验发现生成调用成本、话题边界和稳定找回等限制。真实历史保留在本地 `legacy-v1` 标签，标签尚未推送；见[第一代历史](docs/generation-1.md)。

第二代继承的是第一代形成的需求和经验，**并非第一代代码继续加层**。当前核心来自 LongMemory，项目新增的是精确对话保存、来源回溯、显式更正、失败恢复与应用接入。上游固定版本为 `9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5`；[归属说明](ATTRIBUTION.md)区分原创与上游代码。没有集成 Mem0。

## 能力边界与验证

更正需要应用传入 `supersedesSourceId`，不会自动推断所有矛盾。`erase` 删除一整轮用户/助手对话的正常可见记录，并修复更正链；不保证清除备份或 SQLite 空闲页。历史证据预算使用多语言 token 估算，超长来源可能只返回标明范围的原文前缀。

[最终固定验证集](https://github.com/ziningshu-code/memory-system-mvp/tree/main/benchmarks-product/blind)包含 200 轮人工编写的合成对话、400 条消息、8 个用户/会话范围和 50 道标注查询。每个范围只有 25 轮，因此没有证明单一会话 200 轮的找回能力。使用真实 NVIDIA embeddings，配置提前冻结，结果出来后没有调参。

在共同的 35 道排序检索题中，前五条结果找到指定用户原文的数量为本产品 **33/35**、固定版本上游 **21/35**。双方均完整保存 400 条原文，没有发现跨范围泄漏。本产品在 4 道无相关记忆题中全部返回空结果；上游返回了范围内的无关近邻。本产品总检查通过 **48/50**，包括更正和恢复等功能；两次失败是中文历史被英文查询检索。这个数字不是主模型回答准确率，也不证明普遍优于上游。两边的事实校验默认策略与更正参数不同；[分类结果和原始数据](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/blind/RESULTS.md)记录了这些差异。上述仓库链接要到本次发布后才可访问。

旧的 [50 轮结果](https://github.com/ziningshu-code/memory-system-mvp/blob/main/benchmarks-product/REAL-RESULTS.md)属于同一数据上的阈值校准，不能冒充独立验证。

检索仍可能漏掉信息或找出干扰项，阈值取决于模型和数据。本地检索随会话大小线性增长。会话隔离不是身份认证。隐私、费用与删除范围见[隐私文档](docs/privacy.md)。完整英文说明见 [README](README.md)。本阶段没有推送 GitHub，也没有发布 npm。
