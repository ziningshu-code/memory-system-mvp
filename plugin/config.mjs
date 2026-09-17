import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
export async function loadConfig(dataDir) {
  await mkdir(dataDir, { recursive: true });
  try {
    const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
    if (config.version !== 1 || typeof config.localToken !== 'string' || config.localToken.length < 32) throw new Error('Invalid local configuration. Restore config.json from your backup.');
    return config;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const config = { version: 1, baseUrl: '', model: '', memoryModel: '', apiKey: '', localToken: randomBytes(32).toString('hex') };
    await writeJson(join(dataDir, 'config.json'), config);
    return config;
  }
}
export function validateConfig(input, previous) {
  const baseUrl = String(input.baseUrl ?? '').trim().replace(/\/+$/, '');
  let url; try { url = new URL(baseUrl); } catch { throw new Error('模型地址需要是完整的 http(s) URL，并通常以 /v1 结尾。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('模型地址不支持用户名、密码、查询参数或片段。');
  if (url.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('远程模型请使用 HTTPS；HTTP 仅限本机模型。');
  if (/\/chat\/completions\/?$/.test(url.pathname)) throw new Error('请填写 Base URL（通常以 /v1 结尾），不要包含 /chat/completions。');
  const model = String(input.model ?? '').trim();
  const memoryModel = String(input.memoryModel ?? '').trim() || model;
  if (!model || model.length > 200 || memoryModel.length > 200) throw new Error('请填写服务商提供的模型名称。');
  const apiKey = input.clearKey === true ? '' : (typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : previous.apiKey);
  if (url.origin !== (previous.baseUrl ? new URL(previous.baseUrl).origin : '') && previous.apiKey && !input.apiKey?.trim() && !input.clearKey) throw new Error('更换服务商时请重新填写 Key，或选择无需 Key，避免向新地址发送旧 Key。');
  return { ...previous, baseUrl, model, memoryModel, apiKey };
}
