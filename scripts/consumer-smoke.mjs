import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const folder = mkdtempSync(join(tmpdir(), 'memory-consumer-'));
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const packOutput = runNpm(['pack', '--json', '--pack-destination', folder], root);
const pack = JSON.parse(packOutput.slice(packOutput.indexOf('[\n')))[0];
writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'clean-sdk-consumer', private: true, type: 'module' }));
runNpm(['install', '--no-audit', '--no-fund', '--package-lock=false', join(folder, pack.filename)], folder);
writeFileSync(join(folder, 'consumer.ts'), `import { createMemory, type MemoryConfig } from 'memory-system-mvp';
const config: MemoryConfig = { embedding: { kind: 'custom', id: 'compile', dimension: 2, embed: async () => [1, 0] } };
const memory = createMemory(config); void memory.close();\n`);
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', join(folder, 'consumer.ts')], { cwd: folder, stdio: 'pipe' });
writeFileSync(join(folder, 'consumer.mjs'), `import assert from 'node:assert/strict';
import { createMemory } from 'memory-system-mvp';
import { join } from 'node:path';
import { createServer } from 'node:http';
const cfg = { dbPath: join(process.cwd(), 'memory.sqlite'), minSemanticSimilarity: 0.8,
  embedding: { kind: 'custom', id: 'deterministic-install-check', dimension: 2, embed: async () => [1, 0] } };
assert.throws(() => createMemory({}), /real embedding provider/);
let memory = createMemory(cfg);
const saved = await memory.remember({sessionId:'one',turnId:'turn',user:'My appointment is at 09:15.',assistant:'Understood: 09:15.'});
assert.deepEqual(saved.failed, []);
assert.ok((await memory.recall({sessionId:'one',query:'appointment'})).sources.some(s => s.sourceId === 'turn:user'));
await memory.close(); memory = createMemory(cfg);
assert.equal((await memory.history('one')).length, 2);
assert.deepEqual(await memory.rebuild('one'), {indexed:2,failed:0});
assert.equal((await memory.erase({sessionId:'one',sourceId:'turn:user'})).erased, true);
assert.equal((await memory.history('one')).length, 0); await memory.close();
// Unauthorized/missing remote credentials never create synthetic production vectors.
const server = createServer((_req, res) => {res.writeHead(401, {'content-type':'application/json'});res.end(JSON.stringify({error:{message:'API key required'}}));});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
memory = createMemory({dbPath:join(process.cwd(),'missing.sqlite'),embedding:{kind:'openai',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'test',dimension:2}});
const failed = await memory.remember({sessionId:'failed',turnId:'failed',user:'Keep original.',assistant:'Visible response.'});
assert.equal(failed.failed.length,2); assert.equal((await memory.history('failed'))[0].exactText,'Keep original.');
const recalled = await memory.recall({sessionId:'failed',query:'original'});
assert.equal(recalled.sources.length,0); assert.match(recalled.trace.error, /401|API key/); await memory.close();
await new Promise(resolve => server.close(resolve));
console.log('fresh consumer: import, TypeScript, native SQLite, remember/recall/restart/history/rebuild/erase/close, failure persistence passed');
`);
const output = execFileSync(process.execPath, [join(folder, 'consumer.mjs')], { cwd: folder, encoding: 'utf8' });
const files = pack.files.map((file) => file.path);
assert.ok(files.includes('build-product/longmemory/stores/sqlite/schema.sql'));
assert.ok(!files.some((file) => /^(?:src|plugin|site|benchmarks|tests)\//.test(file) || /(?:\.env|\.sqlite|\.tgz)$/.test(file)));
const manifest = { version: JSON.parse(readFileSync(join(root, 'package.json'))).version,
  fileCount: files.length, packageBytes: pack.size, unpackedBytes: pack.unpackedSize,
  sha512: pack.integrity, checks: output.trim(), node: process.version };
console.log(JSON.stringify(manifest, null, 2));
