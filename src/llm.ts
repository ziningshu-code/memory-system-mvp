import type { MemoryLlm, MemoryLlmRequest } from './types.js';

export interface OpenAICompatibleMemoryLlmOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export function createOpenAICompatibleMemoryLlm(options: OpenAICompatibleMemoryLlmOptions): MemoryLlm {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch is not available in this environment');
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    async complete(input: MemoryLlmRequest): Promise<string> {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          ...(options.headers ?? {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
          temperature: input.temperature,
          top_p: input.topP,
          max_tokens: input.maxTokens,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Memory LLM HTTP ${response.status}: ${text.slice(0, 500)}`);
      let json: unknown;
      try { json = JSON.parse(text); }
      catch { throw new Error('Memory LLM returned invalid JSON'); }
      const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('Memory LLM returned empty content');
      return content;
    },
  };
}
