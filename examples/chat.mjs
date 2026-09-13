import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createMemory, InMemoryStorage } from 'topic-memory';
import { chatMessages, createProvider, memoryAdapter, readConfig } from './provider.mjs';
import { questions, seedConversation } from './scenario.mjs';

const provider = createProvider(readConfig());
const memory = createMemory({ storage: new InMemoryStorage(), llm: memoryAdapter(provider) });
const seeded = process.argv.includes('--seed');
if (seeded) {
  await seedConversation(memory);
  const run = await memory.maybeRunTopicWorker();
  console.log(`Synthetic conversation loaded; real model topic worker: ${run.reason}.`);
  if (run.reason !== 'accepted') throw new Error('The real model did not produce valid topics. Check the model response and try another compatible model.');
}
console.log('Topic Memory • live model chat (provider usage may be billed)');
console.log('Memory is temporary for this example and disappears on exit. Type /exit to quit.');
if (!seeded) console.log('Long-term topics start after 6 completed exchanges. Recent conversation works immediately.');
const rl = createInterface({ input: stdin, output: stdout });
try {
  if (seeded) console.log('Try:', questions[0].question);
  while (true) {
    let message;
    try { message = (await rl.question('\nYou: ')).trim(); } catch { break; }
    if (message === '/exit') break;
    if (!message) continue;
    const pending = await memory.begin(message);
    let completed = false;
    try {
      const retrieved = await memory.retrieve({ userMessage: message });
      const answer = await provider(chatMessages(message, retrieved.recentContext, retrieved.memoryContext));
      await memory.completeExchange({ exchangeId: pending.id, assistantText: answer });
      completed = true;
      console.log('\nAssistant:', answer);
      console.log('Retrieved topics:', retrieved.selectedTopicIds.join(', ') || '(none)');
      if (retrieved.trace.selectorError) console.log('Retrieval failed; this reply used recent context only.');
      const run = await memory.maybeRunTopicWorker();
      if (run.reason === 'failed' || run.reason === 'rejected') console.log('Topic update did not succeed; existing memory was kept.');
    } catch (error) {
      if (!completed) await memory.failExchange({ exchangeId: pending.id, failureReason: error.message });
      console.error(error.message);
    }
  }
} finally { rl.close(); }
