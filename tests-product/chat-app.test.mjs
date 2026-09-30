import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const example = fileURLToPath(new URL('../examples-product/openai-compatible-chat.mjs', import.meta.url));

function runChat(input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [example, input], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`chat example failed (${code}): ${error}`)));
  });
}

test('a real app-style OpenAI-compatible request injects exact evidence but saves only visible speech', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'memory-app-')), 'memory.sqlite');
  const chatRequests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/embeddings') {
      response.end(JSON.stringify({ data: (Array.isArray(body.input) ? body.input : [body.input])
        .map((_, index) => ({ index, embedding: [1, 0, 0] })) }));
      return;
    }
    if (request.url === '/v1/chat/completions') {
      chatRequests.push(body);
      const answer = chatRequests.length === 1 ? '好的，我记下了。' : 'Sakura Hotel。';
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }] }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    const env = { MEMORY_DB_PATH: dbPath, MEMORY_SESSION_ID: 'app-test',
      EMBED_BASE_URL: url, EMBED_MODEL: 'fixed-test-provider', EMBED_API_KEY: 'local', EMBED_DIMENSION: '3',
      CHAT_BASE_URL: url, CHAT_MODEL: 'mock-main-model', CHAT_API_KEY: 'local' };
    await runChat('我在东京住 Sakura Hotel。', env);
    const second = await runChat('我刚才住哪家酒店？', env);
    assert.equal(second, 'Sakura Hotel。');
    assert.equal(chatRequests.length, 2);
    assert.ok(chatRequests[1].messages[0].content.includes('我在东京住 Sakura Hotel。'));
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT exact_text FROM conversation_sources ORDER BY sequence').all();
    db.close();
    assert.deepEqual(rows.map((row) => row.exact_text), [
      '我在东京住 Sakura Hotel。', '好的，我记下了。', '我刚才住哪家酒店？', 'Sakura Hotel。',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an embedding outage preserves the Main LLM answer and exact transcript', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'memory-app-outage-')), 'memory.sqlite');
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain body */ }
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/embeddings') {
      response.statusCode = 503;
      response.end('{"error":"embedding service unavailable"}');
    } else {
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '正常回答仍然返回。' } }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    const answer = await runChat('东京旅行有哪些建议？', {
      MEMORY_DB_PATH: dbPath, MEMORY_SESSION_ID: 'outage',
      EMBED_BASE_URL: url, EMBED_MODEL: 'outage-model', EMBED_API_KEY: 'local', EMBED_DIMENSION: '3',
      CHAT_BASE_URL: url, CHAT_MODEL: 'mock-main-model', CHAT_API_KEY: 'local',
    });
    assert.equal(answer, '正常回答仍然返回。');
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT exact_text, derivation_status FROM conversation_sources ORDER BY sequence').all();
    db.close();
    assert.deepEqual(rows.map((row) => row.exact_text), ['东京旅行有哪些建议？', '正常回答仍然返回。']);
    assert.ok(rows.every((row) => row.derivation_status === 'failed'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
