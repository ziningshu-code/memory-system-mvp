import { mkdir, writeFile } from 'node:fs/promises';
import { createMemory, InMemoryStorage } from 'topic-memory';
import { createScriptedLlm, questions, scenario, seedConversation } from '../examples/scenario.mjs';
import { chatMessages, createProvider, memoryAdapter, readConfig } from '../examples/provider.mjs';

const live = process.argv.includes('--live');
const calls = [];
const config = live ? readConfig() : null;
const provider = live ? createProvider(config, call => calls.push(call)) : null;
const memory = createMemory({ storage: new InMemoryStorage(), llm: live ? memoryAdapter(provider) : createScriptedLlm() });
await seedConversation(memory);
const worker = await memory.maybeRunTopicWorker();
const result = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), mode: live ? 'live-model' : 'scripted-mechanics',
  model: config?.model ?? null, dataset: 'synthetic-24-exchanges-v1', exchanges: scenario.length,
  worker: { reason: worker.reason, error: worker.run?.validationError ?? null },
  limitations: [
    'Four hand-authored questions over 24 synthetic exchanges; not a long-conversation benchmark.',
    'One model run per method; no statistical significance or production-quality claim.',
    'Topic construction is a single batch over the archive; continuous ingestion is not evaluated.',
    'Character counts are not token counts. Provider token usage is reported only when supplied.',
    ...(live ? ['Answer scoring is a literal fact check with an explicit abstention check, not a semantic judge. Review raw answers.'] : ['Worker and selector responses are fixed. No real model answer quality, latency or cost is measured.']),
  ], cases: [],
};
let failed = worker.reason !== 'accepted';
const hasEvidence = (text, q) => q.evidence.every(sequence => text.includes(scenario[sequence - 1].userText));
for (const question of questions) {
  const callStart = calls.length;
  const retrievalStart = performance.now();
  const retrieved = await memory.retrieve({ userMessage: question.question });
  const retrievalMs = Math.round(performance.now() - retrievalStart);
  const retrievalCalls = calls.slice(callStart);
  const evidencePresent = hasEvidence(retrieved.memoryContext, question);
  const mechanicsPass = question.unknown ? retrieved.memoryContext === '' : evidencePresent;
  if (!live && !mechanicsPass) failed = true;
  const row = {
    id: question.id, question: question.question, expectedEvidenceSequences: question.evidence,
    selectedTopicIds: retrieved.selectedTopicIds, selectorError: retrieved.trace.selectorError,
    evidencePresent: question.unknown ? null : evidencePresent, mechanicsPass,
    recentContextHasEvidence: question.unknown ? null : hasEvidence(retrieved.recentContext.map(e => e.userText).join('\n'), question),
    memoryCharacters: retrieved.memoryContext.length,
    selectorInputCharacters: retrieved.trace.selectorInput.length,
    retrievedMemory: retrieved.memoryContext,
    retrievalMs: live ? retrievalMs : null, retrievalCalls: live ? retrievalCalls : [], answers: [],
  };
  if (live) {
    // Same final-answer model, system instruction and question for all three methods.
    for (const method of ['recent-5', 'full-transcript', 'topic-memory']) {
      const history = method === 'full-transcript' ? scenario : retrieved.recentContext;
      const context = method === 'topic-memory' ? retrieved.memoryContext : '';
      const start = calls.length;
      let answer;
      try { answer = await provider(chatMessages(question.question, history, context)); }
      catch (error) {
        failed = true;
        row.answers.push({ method, answer: null, passed: false, error: error.message, usage: calls.slice(start) });
        continue;
      }
      const normalized = answer.toLowerCase();
      const passed = question.unknown
        ? /do not know|don't know|not (?:have|provided|shared|mentioned)|haven.t (?:provided|shared|mentioned)|no .*passport/.test(normalized) && !/\d{5,}/.test(answer)
        : question.answerGroups.every(group => group.some(term => normalized.includes(term)));
      row.answers.push({ method, answer, passed, usage: calls.slice(start) });
    }
  }
  result.cases.push(row);
  console.log(`${question.id}: ${live ? row.answers.map(a => `${a.method}=${a.passed ? 'pass' : 'miss'}`).join(', ') : mechanicsPass ? 'mechanics pass' : 'mechanics FAIL'}`);
}
result.calls = calls;
result.summary = live ? Object.fromEntries(['recent-5', 'full-transcript', 'topic-memory'].map(method => [method, {
  passed: result.cases.filter(row => row.answers.find(a => a.method === method)?.passed).length,
  total: questions.length,
}])) : { mechanicsPassed: result.cases.filter(row => row.mechanicsPass).length, total: questions.length };
const output = live ? 'benchmark-results/live.json' : 'docs/evaluation/scripted.json';
await mkdir(output.slice(0, output.lastIndexOf('/')), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log('Result:', output);
if (failed) process.exitCode = 1;
