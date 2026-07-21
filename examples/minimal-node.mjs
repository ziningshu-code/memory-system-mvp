import { createMemory, InMemoryStorage } from 'topic-memory';

const fakeMemoryLlm = {
  async complete({ system }) {
    if (system.includes('Topic Worker')) {
      return JSON.stringify({
        topics: [{
          status: 'provisional',
          labelTerms: ['travel', 'Tokyo'],
          retrievalTerms: ['Tokyo', 'hotel', 'Shibuya'],
          spans: [{ startSequence: 1, endSequence: 6 }],
        }],
      });
    }
    return JSON.stringify({ needsMemory: true, topicIds: ['T1'], needsTimeMetadata: false });
  },
};

const memory = createMemory({ storage: new InMemoryStorage(), llm: fakeMemoryLlm });

for (let i = 1; i <= 6; i++) {
  const pending = await memory.begin(`user message ${i}`);
  await memory.completeExchange({ exchangeId: pending.id, assistantText: `assistant reply ${i}` });
}

await memory.maybeRunTopicWorker();
const retrieved = await memory.retrieve({ userMessage: 'What did we decide about Tokyo?' });

// Replace this function with your existing Main LLM call.
async function myOwnMainLlm({ userMessage, memoryContext }) {
  return `Main LLM received ${memoryContext.length} memory characters for: ${userMessage}`;
}

console.log(await myOwnMainLlm({ userMessage: 'What did we decide about Tokyo?', memoryContext: retrieved.memoryContext }));
