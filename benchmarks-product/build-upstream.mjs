import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const product = resolve(here, '..');
const upstream = resolve(product, '..', 'upstream-longmemory-audit');
const output = join(here, '.upstream-build');
const require = createRequire(import.meta.url);
const ts = require('typescript');

export function buildUpstream() {
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${upstream.replaceAll('\\', '/')}`, ...args],
    { cwd: upstream, encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  if (head !== '9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5') {
    throw new Error(`Expected upstream commit 9ee2c8e1ed42d83eb788afb9ffc3a82b84405da5, found ${head}`);
  }
  const status = git('status', '--porcelain', '--', 'src/core', 'src/stores');
  if (status) throw new Error('Upstream core/stores have local changes; refusing an ambiguous comparison');
  const rootDir = join(upstream, 'src');
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2022.d.ts'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmitOnError: true,
    rootDir,
    outDir: output,
    baseUrl: product,
    paths: { stemmer: [join(product, 'node_modules', 'stemmer', 'index.d.ts')] },
    typeRoots: [join(product, 'node_modules', '@types')],
    types: ['node'],
  };
  const program = ts.createProgram([join(rootDir, 'core', 'create_memory.ts')], options);
  const emit = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics);
  if (diagnostics.length) {
    const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => product,
      getNewLine: () => '\n',
    });
    throw new Error(`Upstream compilation failed:\n${message}`);
  }
  const schema = join(rootDir, 'stores', 'sqlite', 'schema.sql');
  mkdirSync(join(output, 'stores', 'sqlite'), { recursive: true });
  copyFileSync(schema, join(output, 'stores', 'sqlite', 'schema.sql'));
  return { head, source: rootDir, output,
    entry: join(output, 'core', 'create_memory.js'),
    sourceBytes: readFileSync(join(rootDir, 'core', 'create_memory.ts')).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(buildUpstream(), null, 2));
}
