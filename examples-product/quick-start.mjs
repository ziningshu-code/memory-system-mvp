import { createMemory } from 'memory-system-v2';

if (!process.env.EMBED_API_KEY) {
  throw new Error('Set EMBED_API_KEY in .env first');
}

const memory = createMemory({
  dbPath: './memory.sqlite',
  embedding: {
    kind: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-embed-1b',
    dimension: 2048,
    apiKey: process.env.EMBED_API_KEY,
  },
});

try {
  const saved = await memory.remember({
    sessionId: 'flight-demo',
    turnId: 'flight-1',
    user: 'My flight leaves at 7:40 tomorrow morning.',
    assistant: 'Understood: your flight leaves at 7:40 tomorrow morning.',
  });
  if (saved.failed.length) throw new Error('Embedding failed; original messages were saved. Check your provider/key and rerun.');

  const recalled = await memory.recall({
    sessionId: 'flight-demo',
    query: 'What time is my flight?',
  });
  if (recalled.trace.error) throw new Error(recalled.trace.error);
  const original = recalled.sources.find(source => source.sourceId === 'flight-1:user');
  if (!original) throw new Error('The flight message was not retrieved');
  console.log('Source:', original.sourceId);
  console.log('Original message:', original.text);
} finally {
  await memory.close();
}
