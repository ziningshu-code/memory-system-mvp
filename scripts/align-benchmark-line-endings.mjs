// Release reproducibility: align LF/CRLF only, retaining the original frozen hashes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const benchmark = join(root, 'benchmarks-product/blind');
const upstream = resolve(process.env.LONGMEMORY_UPSTREAM_DIR ?? join(root, '../upstream-longmemory-audit'));
const manifest = JSON.parse(readFileSync(join(benchmark, 'manifest.json'), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const files = [...manifest.runtime.files.map(file => {
  const isProduct = file.name.startsWith('product/');
  if (!isProduct && !file.name.startsWith('upstream/')) throw new Error('Unexpected frozen path');
  const targetRoot = isProduct ? root : upstream;
  const relative = file.name.slice(isProduct ? 8 : 9);
  const path = resolve(targetRoot, relative);
  if (!path.startsWith(targetRoot + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Invalid frozen path');
  return { path, sha256: file.sha256 };
}), ...manifest.harness.map(file => ({ path: join(benchmark, file.name), sha256: file.sha256 }))];
const changes = [];
for (const file of files) {
  const current = readFileSync(file.path);
  if (sha(current) === file.sha256) continue;
  const text = current.toString('utf8');
  if (!Buffer.from(text).equals(current)) throw new Error('Non-text frozen input differs');
  const lf = text.replaceAll('\r\n', '\n');
  const match = [lf, lf.replaceAll('\n', '\r\n')].find(candidate => sha(candidate) === file.sha256);
  if (match === undefined) throw new Error('Frozen source differs beyond LF/CRLF; refusing changes');
  changes.push({ ...file, text: match });
}
// Verify all files before modifying any. No code, threshold, labels, or hashes change.
for (const file of changes) writeFileSync(file.path, file.text);
console.log(JSON.stringify({ alignedLineEndings: changes.length, verifiedFrozenFiles: files.length,
  manifestSha256: manifest.manifestSha256, externalRequests: 0 }));
