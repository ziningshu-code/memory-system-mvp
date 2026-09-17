import { createMemory, InMemoryStorage } from '../dist/index.js';
import { questions, scenario } from '../examples/scenario.mjs';
import { chatMessages } from '../examples/provider.mjs';
import { completion, memoryLlm } from './provider.mjs';

// Real worker, selector and answering requests; only the public conversation material is synthetic.
export async function evaluateLive(config) {
  const calls = [], workerRuns = [];
  const memory = createMemory({ storage: new InMemoryStorage(), llm: memoryLlm(config, call => calls.push(call)) });
  for (const exchange of scenario) {
    const pending = await memory.beginExchange(exchange);
    await memory.completeExchange({ exchangeId: pending.id, assistantText: exchange.assistantText });
    if (exchange.sequence >= 6 && exchange.sequence % 3 === 0) {
      const run = await memory.maybeRunTopicWorker();
      workerRuns.push({ afterExchange: exchange.sequence, reason: run.reason, error: run.run?.validationError });
    }
  }
  const cases = [];
  for (const question of questions) {
    const retrieved = await memory.retrieve({ userMessage: question.question });
    const row = { question: question.question, selectedTopicIds: retrieved.selectedTopicIds, selectorError: retrieved.trace.selectorError, evidence: retrieved.memoryContext, answers: [] };
    for (const method of ['recent-5', 'full-transcript', 'topic-memory']) {
      const messages = chatMessages(question.question, method === 'full-transcript' ? scenario : retrieved.recentContext, method === 'topic-memory' ? retrieved.memoryContext : '');
      try {
        const answer = (await completion(config, { messages, temperature: 0, max_tokens: 4096 }, call => calls.push({ ...call, method }))).choices[0].message.content;
        const normalized = answer.toLowerCase();
        const passed = question.unknown
          ? /do not know|don't know|not (?:have|provided|shared|mentioned)|haven.t (?:provided|shared|mentioned)|no .*passport/.test(normalized) && !/\d{5,}/.test(answer)
          : question.answerGroups.every(group => group.some(term => normalized.includes(term)));
        row.answers.push({ method, answer, literalCheckPassed: passed });
      } catch (error) { row.answers.push({ method, error: error.message, literalCheckPassed: false }); }
    }
    cases.push(row);
  }
  return { generatedAt: new Date().toISOString(), mode: 'live-model', model: config.model, memoryModel: config.memoryModel || config.model,
    limitations: ['24 synthetic exchanges; 4 questions; one run per method.', 'Topic worker is called repeatedly during ingestion; this is a small diagnostic, not a production benchmark.', 'Literal answer checks can misgrade paraphrases. Read the raw answers.', 'All provider calls, including indexing and selection, are listed; absent usage is unknown.'],
    summary: Object.fromEntries(['recent-5','full-transcript','topic-memory'].map(method => [method, { passed: cases.filter(c => c.answers.find(a => a.method === method)?.literalCheckPassed).length, total: cases.length }])), workerRuns, cases, calls };
}
