import OpenAI from 'openai';
import { createMemoryChat } from 'memory-system-v2/chat';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

// Create once when your Node.js backend starts. Reuse your existing client if you have one.
const client = new OpenAI({
  baseURL: required('CHAT_BASE_URL'),
  apiKey: process.env.CHAT_API_KEY || 'local',
});

const embeddingKind = process.env.EMBED_PROVIDER ?? 'openai';
if (!['openai', 'nvidia'].includes(embeddingKind)) {
  throw new Error('EMBED_PROVIDER must be openai or nvidia');
}
const chat = createMemoryChat({
  client,
  memory: {
    dbPath: process.env.MEMORY_DB_PATH ?? './data/memory.sqlite',
    embedding: {
      kind: embeddingKind,
      baseUrl: required('EMBED_BASE_URL'),
      model: required('EMBED_MODEL'),
      dimension: Number(required('EMBED_DIMENSION')),
      apiKey: required('EMBED_API_KEY'),
    },
  },
});

// Call from your existing authenticated chat route.
// Supply userId from authentication and verify that the user owns sessionId.
// messages is the same text-message array your app already sends to its model.
export function reply({ userId, sessionId, personaId, messages, stream = false, signal }) {
  return chat.create({
    userId,
    sessionId,
    personaId,
    model: required('CHAT_MODEL'),
    messages,
    stream,
  }, { signal });
}

// Call from your backend's shutdown handler, after active requests finish.
export function close() {
  return chat.close();
}
