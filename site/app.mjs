import { createMemory, InMemoryStorage } from './sdk/index.js';
import { createScriptedLlm, questions, scenario, seedConversation } from './examples/scenario.mjs';

const translations = {
  eyebrow: ['CONVERSATION MEMORY / TYPESCRIPT SDK', '对话记忆 / TYPESCRIPT SDK'],
  title: ['Go back to what<br>was actually said.', '找回当时<br>真正说过的话。'],
  lead: ['Keep the conversation. Find the topic. Reopen the original words when they matter again.', '保留完整对话，按话题查找，在需要时重新打开当时的原文。'],
  install: ['Add to your application', '接入你的应用'], guide: ['Open the quick start ↗', '查看快速上手 ↗'],
  walkthrough: ['INTERACTIVE WALKTHROUGH', '交互演示'], labTitle: ['24 exchanges later. The details are still there.', '聊过 24 轮，旧细节仍然可以找回。'],
  badge: ['No API key', '无需 API Key'], disclosure: ['Scripted model responses + the real SDK. This demonstrates retrieval mechanics, not AI answer quality. All conversations are synthetic.', '使用预设的模型响应和真实 SDK，展示检索流程，不代表真实模型的回答质量。对话内容均为虚构示例。'],
  ask: ['ASK AGAIN', '再次提问'], retrieve: ['Retrieve memory', '找回记忆'],
  recent: ['Recent context', '最近对话'], lastFive: ['Last 5 exchanges', '最近 5 轮'], recentNote: ['The conversation has moved on to astronomy.', '最近的话题已经变成了天文学。'],
  directory: ['Topic directory', '话题目录'], directoryNote: ['The selector chooses topic IDs. The SDK then opens their original transcript spans.', '选择器先选出话题 ID，SDK 再按照记录的位置打开原始对话。'],
  evidence: ['Recovered evidence', '找回的原文'], inspect: ['Inspect the exact SDK output', '查看 SDK 的完整输出'],
  verification: ['WHAT HAS BEEN VERIFIED', '已经验证的部分'], verifiedTitle: ['Inspect the evidence.<br>Keep the claims small.', '展示可检查的证据，<br>说明实际的边界。'],
  verifiedBody: ['The published package can be installed in a fresh Node project. Four scripted cases check original-text recovery and empty memory for an unknown fact. Real-model accuracy, speed and token costs need a separate evaluation.', '已在全新 Node 项目中安装并运行公开软件包。四个预设场景检查原文恢复，以及信息不存在时返回空记忆。真实模型的准确率、速度和 token 消耗需要单独测试。'],
  results: ['Read the recorded checks ↗', '查看已记录的检查结果 ↗'], method: ['Run the real-model comparison ↗', '运行真实模型对照测试 ↗'],
  limitsTitle: ['Designed for a clear, narrow job.', '只负责一件明确的事。'], limits: ['Topic Memory returns context to your existing model. Topics begin after six completed exchanges. In-memory storage is temporary; browser persistence uses IndexedDB, and backend persistence needs your own storage adapter. The topic directory grows with the archive.', 'Topic Memory 为你已有的模型提供上下文。完成六轮对话后才开始生成长期话题。内存存储会在退出后清空；浏览器可使用 IndexedDB，后端持久化需要实现存储适配器。话题目录会随着历史增加而增长。'],
  feedback: ['Tried it? Share what happened ↗', '用过之后，告诉我们体验 ↗'],
};
let chinese = false;
let current = questions[0];
let lastResult = null;
let memory;
let ready = false;
const $ = id => document.getElementById(id);
const text = (en, zh) => chinese ? zh : en;

function renderExchange(exchange, showAnswer = true) {
  const el = document.createElement('article'); el.className = 'exchange';
  const label = document.createElement('small'); label.textContent = `${text('EXCHANGE', '原始对话')} ${String(exchange.sequence).padStart(2, '0')}`;
  const user = document.createElement('p'); user.textContent = exchange.userText;
  el.append(label, user);
  if (showAnswer) { const reply = document.createElement('p'); reply.className = 'reply'; reply.textContent = exchange.assistantText; el.append(reply); }
  return el;
}

async function render() {
  document.documentElement.lang = chinese ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = translations[el.dataset.i18n][chinese ? 1 : 0]; });
  $('language').textContent = chinese ? 'English' : '中文';
  $('copy').textContent = text('Copy', '复制');
  $('question').textContent = chinese ? current.questionZh : current.question;
  $('questions').replaceChildren(...questions.map(q => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = chinese ? q.zh : q.label; button.setAttribute('aria-pressed', String(current.id === q.id));
    button.addEventListener('click', () => { current = q; lastResult = null; void render(); });
    return button;
  }));
  $('recent').replaceChildren(...scenario.slice(-5).map(e => renderExchange(e, false)));
  const topics = memory ? await memory.listTopics() : [];
  $('topics').replaceChildren(...topics.map(topic => {
    const el = document.createElement('div'); el.className = `topic${lastResult?.selectedTopicIds.includes(topic.topicId) ? ' selected' : ''}`;
    const label = document.createElement('strong'); label.textContent = topic.labelTerms.join(' / ');
    const id = document.createElement('span'); id.className = 'topic-id'; id.textContent = topic.topicId;
    const detail = document.createElement('small'); detail.textContent = `${text('Exchanges', '原始对话')} ${topic.spans.map(s => `${s.startSequence}–${s.endSequence}`).join(', ')} · ${topic.retrievalTerms.join(', ')}`;
    el.append(id, label, detail); return el;
  }));
  $('selection').textContent = lastResult ? lastResult.selectedTopicIds.join(', ') || text('No topic', '无话题') : '';
  $('evidence').replaceChildren();
  if (!lastResult) {
    const el = document.createElement('p'); el.className = 'empty'; el.textContent = text('Choose “Retrieve memory” to open the evidence for this question.', '点击“找回记忆”，查看这个问题对应的原文。'); $('evidence').append(el);
    $('status').textContent = text('Ready. The walkthrough runs entirely in your browser.', '准备就绪。整个预设演示都在你的浏览器中运行。');
    $('raw').textContent = '';
  } else if (!lastResult.selectedTopicIds.length) {
    const el = document.createElement('p'); el.className = 'empty'; el.textContent = text('No passport number was recorded. The scripted selector chooses no topic, so the SDK returns empty long-term memory.', '对话里没有记录护照号码。预设选择器没有选出话题，因此 SDK 返回空的长期记忆。'); $('evidence').append(el);
    $('status').textContent = text('No evidence → empty memoryContext. Your main model decides how to answer.', '没有证据 → memoryContext 为空。最终如何回答由你的主模型决定。');
  } else {
    const info = document.createElement('p'); info.className = 'evidence-label'; info.textContent = text('Relevant source excerpts from the recovered packet. Open the exact output below to inspect the full packet.', '以下是恢复出的对话包中与问题有关的原文。下方可以展开完整输出。'); $('evidence').append(info);
    // Only show text that the SDK actually restored, not a fabricated model answer.
    for (const sequence of current.evidence) {
      const exchange = scenario[sequence - 1];
      if (lastResult.memoryContext.includes(exchange.userText)) $('evidence').append(renderExchange(exchange));
    }
    $('status').textContent = text('Outside the recent 5 exchanges → located by topic → original text restored.', '已经不在最近 5 轮中 → 通过话题定位 → 找回原始对话。');
  }
  if (lastResult) $('raw').textContent = JSON.stringify({ selectedTopicIds: lastResult.selectedTopicIds, memoryContext: lastResult.memoryContext, selectorResponse: lastResult.trace.selectorRawOutput }, null, 2);
  $('retrieve').disabled = !ready;
}

$('language').addEventListener('click', () => { chinese = !chinese; void render(); });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('npm install topic-memory'); $('copy').textContent = text('Copied', '已复制'); }
  catch { $('copy').textContent = text('Select text', '请选中文本'); }
});
$('retrieve').addEventListener('click', async () => {
  $('retrieve').disabled = true;
  try { lastResult = await memory.retrieve({ userMessage: current.question }); await render(); }
  catch { $('status').textContent = text('Could not retrieve memory. Reload to try again.', '检索未成功，请刷新页面重试。'); }
  finally { $('retrieve').disabled = false; }
});

try {
  memory = createMemory({ storage: new InMemoryStorage(), llm: createScriptedLlm(), now: () => Date.UTC(2026, 0, 11) });
  await seedConversation(memory);
  const worker = await memory.maybeRunTopicWorker();
  if (worker.reason !== 'accepted') throw new Error('Topic construction failed');
  ready = true;
  lastResult = await memory.retrieve({ userMessage: current.question });
  await render();
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
    try {
      await document.modelContext.registerTool({
        name: 'run_scripted_memory_case', title: 'Run a scripted memory case',
        description: 'Select a preset question, run the real SDK with scripted model responses, and show the recovered original text. No network or real model calls.',
        inputSchema: { type: 'object', properties: { caseId: { type: 'string', enum: questions.map(q => q.id) } }, required: ['caseId'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          if (!input || typeof input !== 'object' || Object.keys(input).some(k => k !== 'caseId')) throw new Error('Provide only a supported caseId.');
          const selected = questions.find(q => q.id === input.caseId);
          if (!selected) throw new Error('Unknown caseId.');
          current = selected;
          lastResult = await memory.retrieve({ userMessage: current.question });
          await render();
          return { mode: 'scripted-mechanics', caseId: current.id, selectedTopicIds: lastResult.selectedTopicIds, memoryContext: lastResult.memoryContext };
        },
      }, { signal: lifecycle.signal });
    } catch { /* The visible walkthrough works without WebMCP support. */ }
  }
} catch {
  $('status').textContent = 'Demo could not load. Please reload, or use the runnable example linked on GitHub.';
  $('retrieve').disabled = true;
}
