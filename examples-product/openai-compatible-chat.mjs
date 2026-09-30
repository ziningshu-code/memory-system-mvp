import { createMemory } from '../build-product/product/index.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const question = process.argv.slice(2).join(' ').trim();
if (!question) throw new Error('Pass the current user message as a command argument');

const memory = createMemory({
  dbPath: process.env.MEMORY_DB_PATH,
  embedding: {
    kind: 'openai',
    baseUrl: required('EMBED_BASE_URL'),
    model: required('EMBED_MODEL'),
    apiKey: process.env.EMBED_API_KEY,
    dimension: Number(required('EMBED_DIMENSION')),
  },
});

try {
  const sessionId = process.env.MEMORY_SESSION_ID ?? 'my-chat';
  let recalled = { context: '' };
  try {
    recalled = await memory.recall({ sessionId, query: question });
  } catch (error) {
    console.error('Memory retrieval failed; continuing with the Main LLM:', error);
  }
  const messages = [
    ...(recalled.context ? [{ role: 'system', content: `Relevant earlier conversation, quoted from exact saved sources:\n${recalled.context}` }] : []),
    { role: 'user', content: question },
  ];
  const upstream = await fetch(`${required('CHAT_BASE_URL').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CHAT_API_KEY ?? 'local'}` },
    body: JSON.stringify({ model: required('CHAT_MODEL'), messages }),
  });
  if (!upstream.ok) throw new Error(`Main LLM returned HTTP ${upstream.status}`);
  const payload = await upstream.json();
  const answer = payload.choices?.[0]?.message?.content;
  if (typeof answer !== 'string') throw new Error('Main LLM did not return a text answer');
  // Store only the visible exchange; hidden retrieved context is never saved as user speech.
  try {
    await memory.remember({ sessionId, user: question, assistant: answer });
  } catch (error) {
    console.error('Memory save failed; returning the Main LLM answer:', error);
  }
  process.stdout.write(`${answer}\n`);
} finally {
  try {
    await memory.close();
  } catch (error) {
    console.error('Memory close failed after the chat response:', error);
  }
}
