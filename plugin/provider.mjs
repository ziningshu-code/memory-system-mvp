export async function completion(config, body, onCall = () => {}, role = 'main') {
  const start = performance.now();
  const record = (extra = {}) => onCall({ role, model: role === 'main' ? config.model : config.memoryModel || config.model, elapsedMs: Math.round(performance.now()-start), promptTokens: null, completionTokens: null, ...extra });
  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ ...body, model: role === 'main' ? config.model : config.memoryModel || config.model, stream: false }),
      signal: AbortSignal.timeout(90000),
    });
  } catch { record({error:'network_or_timeout'}); throw new Error('模型请求失败或超过 90 秒。请检查 URL 和网络。'); }
  if (!response.ok) { record({error:`http_${response.status}`}); throw new Error(`模型服务返回 HTTP ${response.status}。请检查地址、Key、模型权限和额度。`); }
  let json; try { json = await response.json(); } catch { record({error:'invalid_json'}); throw new Error('模型服务没有返回有效 JSON。'); }
  const content = json.choices?.[0]?.message?.content;
  const invalid = json.choices?.[0]?.message?.tool_calls?.length || typeof content !== 'string' || !content.trim();
  record({ promptTokens: json.usage?.prompt_tokens ?? null, completionTokens: json.usage?.completion_tokens ?? null, ...(invalid ? {error:'no_text_content'} : {}) });
  if (invalid) throw new Error('模型没有返回纯文本回答。此版本支持文本聊天；推理模型可能需要更大的输出额度。');
  return json;
}
export function memoryLlm(config, onCall) {
  return { async complete(input) {
    const result = await completion(config, { messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }], max_tokens: input.maxTokens, temperature: 0 }, onCall, input.system.includes('Topic Worker') ? 'worker' : 'selector');
    return result.choices[0].message.content;
  } };
}
