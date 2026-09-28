import type { MemoryLlm, MemoryLlmRequest } from './types.js';

export class MemoryLlmTransportError extends Error {
  readonly transient = true;
  constructor(message: string) { super(message); this.name = 'MemoryLlmTransportError'; }
}

export interface OpenAICompatibleMemoryLlmOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Opt in only if the endpoint supports response_format: json_object. No automatic downgrade/retry. */
  jsonMode?: boolean;
  /** Provider-specific; omitted unless explicitly configured. */
  reasoningEffort?: string;
}

export function createOpenAICompatibleMemoryLlm(options: OpenAICompatibleMemoryLlmOptions): MemoryLlm {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch is not available in this environment');
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    async complete(input: MemoryLlmRequest): Promise<string> {
      let response: Response;
      try { response = await fetchImpl(endpoint, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
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
          ...(options.jsonMode ? {response_format:{type:'json_object'}} : {}),
          ...(options.reasoningEffort ? {reasoning_effort:options.reasoningEffort} : {}),
        }),
      }); }
      catch (error) {
        if (['TimeoutError','AbortError','TypeError'].includes((error as Error)?.name))
          throw new MemoryLlmTransportError('Memory LLM transport unavailable or timed out; request usage is unknown');
        throw error;
      }
      const text = await response.text();
      if (!response.ok) {
        if ([408,429,500,502,503,504].includes(response.status))
          throw new MemoryLlmTransportError(`Memory LLM temporary HTTP ${response.status}; request usage is unknown`);
        throw new Error(`Memory LLM HTTP ${response.status}`);
      }
      let json: unknown;
      try { json = JSON.parse(text); }
      catch { throw new Error('Memory LLM returned invalid JSON'); }
      const choice = (json as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> })?.choices?.[0];
      if(choice?.finish_reason==='length')throw new Error('Memory LLM output was truncated; review the model output allowance');
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('Memory LLM returned empty content');
      return content;
    },
  };
}
