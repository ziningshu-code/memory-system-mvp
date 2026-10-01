# 本地对话记忆 SDK（开发版）

这个 Node.js/TypeScript SDK 基于已注明来源的 [LongMemory 源码版本](https://github.com/CaviraOSS/LongMemory/tree/9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5)。当前版本只在本地开发，**尚未发布到 npm，也没有推送到 GitHub**。它是供应用接入的 SDK；本版没有一键配置页面或透明聊天代理。

应用继续使用自己的主聊天模型。SDK 先将用户和助手实际可见的原文保存到本机 SQLite，再建立可重建的向量索引。检索命中后，它按来源 ID 取回原文并在限定预算内返回，供应用放入主模型的内部上下文。SDK 不为记忆管理额外调用生成模型，但**需要配置 embedding 模型**；外部 embedding 服务可能产生费用。

```js
import { createMemory } from 'memory-system-mvp';

const memory = createMemory({
  embedding: {
    kind: 'openai',
    baseUrl: 'https://your-embedding-provider.example/v1',
    model: 'your-embedding-model',
    apiKey: process.env.EMBED_API_KEY,
    dimension: 1024, // 填入该模型实际输出维度
  },
});

const sessionId = 'stable-chat-id';
const recalled = await memory.recall({ sessionId, query: '我选了哪家酒店？' });
// 应用把 recalled.context 放入独立的内部上下文，再调用自己的主模型。
const answer = await yourChatModel(recalled.context);
await memory.remember({ sessionId, user: '我选了哪家酒店？', assistant: answer });
await memory.close();
```

`recall()` 返回带来源 ID 的原文、可注入的 `context` 和检索 `trace`。`maxEvidenceTokens` 限制实际返回的证据文字；超长来源如被截取，会标明精确字符范围，不会冒充完整原文。默认数据库位置是 `~/.memory-system-mvp/memory.sqlite`，可通过 `dbPath` 修改。除了 OpenAI 兼容 embedding 接口，还支持 NVIDIA、Ollama 和应用自定义 embedder；聊天接口不一定提供 embedding 接口。

如果应用已经把最近对话送给主模型，可在 `recall()` 中传入这些回合的稳定 ID（`excludeTurnIds`），避免再次注入同一段原文。

`remember()` 先原子保存完整可见回合，再尝试 embedding。embedding 失败时原文仍在，可用 `rebuild(sessionId)` 从原文重建派生索引。`erase()` 在产品层面逻辑删除包含该来源的完整用户/助手回合并修复显式纠错关系；它**不保证**清除 SQLite 空闲页、WAL 文件或备份中的物理痕迹。`supersedesSourceId` 可显式指出被新回合纠正的旧来源；系统不会自行推断所有矛盾。

本地验证运行 `npm install`、`npm test`、`npm pack`。确定性测试使用固定 embedder；另有独立的真实 NVIDIA embedding 对照测试，不属于日常 `npm test`，其密钥不打入安装包。源码来源和修改见 [ATTRIBUTION.md](ATTRIBUTION.md)；上游许可见 [UPSTREAM-LONGMEMORY-LICENSE](UPSTREAM-LONGMEMORY-LICENSE)。

已知限制：本地向量搜索随会话记忆量线性增长；除已测试的 NVIDIA 模型外，相关性阈值还需按服务商验证；安装依赖原生 `better-sqlite3`，所用 Node 版本须有可用二进制或本机构建工具。
