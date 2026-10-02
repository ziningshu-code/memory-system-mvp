import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { config } from './config.mjs';

export const here = dirname(fileURLToPath(import.meta.url));
export const productRoot = resolve(here, '../..');
export const upstreamRoot = process.env.LONGMEMORY_UPSTREAM_DIR
  ? resolve(process.env.LONGMEMORY_UPSTREAM_DIR) : resolve(productRoot, '../upstream-longmemory-audit');
const ts = createRequire(import.meta.url)('typescript');
export const sha = value => createHash('sha256').update(value).digest('hex');
export function git(root, ...args) {
  return execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}
export function treeFiles(root) {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap(item => item.isDirectory() ? treeFiles(join(root, item.name)) : [join(root, item.name)]);
}
export function sourceIdentity() {
  const upstreamCommit = git(upstreamRoot, 'rev-parse', 'HEAD');
  if (upstreamCommit !== config.upstreamCommit) throw new Error('Upstream revision differs from the frozen baseline');
  if (git(upstreamRoot, 'status', '--porcelain', '--', 'src')) throw new Error('Unmodified upstream source is required');
  const files = [
    ...treeFiles(join(productRoot, 'src/product')).map(path => [`product/${relative(productRoot, path).replaceAll('\\', '/')}`, path]),
    ...treeFiles(join(productRoot, 'src/longmemory')).map(path => [`product/${relative(productRoot, path).replaceAll('\\', '/')}`, path]),
    ['product/tsconfig.product.json', join(productRoot, 'tsconfig.product.json')],
    ...treeFiles(join(upstreamRoot, 'src')).map(path => [`upstream/${relative(upstreamRoot, path).replaceAll('\\', '/')}`, path]),
  ].map(([name, path]) => ({ name, sha256: sha(readFileSync(path)) }));
  return { productBaseCheckpoint: 'e913dcba8dc6ea8117962b2adadd0c0f832ff9e4', upstreamCommit,
    sourceTreeSha256: sha(JSON.stringify(files)), files };
}
function compile(rootNames, options, output, schema, schemaRelative) {
  const program = ts.createProgram(rootNames, { ...options, outDir: output, noEmitOnError: true });
  const emit = program.emit();
  if (ts.getPreEmitDiagnostics(program).concat(emit.diagnostics).length) {
    throw new Error('Local benchmark compilation failed; run the project typecheck for detailed diagnostics');
  }
  const schemaTarget = join(output, schemaRelative);
  mkdirSync(schemaTarget, { recursive: true });
  copyFileSync(schema, join(schemaTarget, 'schema.sql'));
}
export function buildRuntimes() {
  sourceIdentity(); // Fail before compiling or contacting any provider.
  const productOutput = join(here, '.product-build');
  const parsed = ts.parseJsonConfigFileContent(JSON.parse(readFileSync(join(productRoot, 'tsconfig.product.json'), 'utf8')),
    ts.sys, productRoot);
  compile(parsed.fileNames, { ...parsed.options, declaration: false, sourceMap: false }, productOutput,
    join(productRoot, 'src/longmemory/stores/sqlite/schema.sql'), 'longmemory/stores/sqlite');
  const upstreamOutput = join(here, '.upstream-build');
  const upstreamSource = join(upstreamRoot, 'src');
  compile([join(upstreamSource, 'core/create_memory.ts')], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2022.d.ts'], strict: true, esModuleInterop: true, skipLibCheck: true, rootDir: upstreamSource,
    baseUrl: productRoot, paths: { stemmer: [join(productRoot, 'node_modules/stemmer/index.d.ts')] },
    typeRoots: [join(productRoot, 'node_modules/@types')], types: ['node'],
  }, upstreamOutput, join(upstreamSource, 'stores/sqlite/schema.sql'), 'stores/sqlite');
  return { productEntry: join(productOutput, 'product/index.js'),
    storeEntry: join(productOutput, 'longmemory/stores/sqlite/sqlite_store.js'),
    upstreamEntry: join(upstreamOutput, 'core/create_memory.js') };
}
