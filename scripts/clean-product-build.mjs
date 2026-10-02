import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'build-product');
if (dirname(build) !== root) throw new Error('Refusing to clean outside package build directory');
// Windows can briefly hold freshly generated files (e.g. a filesystem scanner).
// Retry only the filesystem's transient removal errors; a persistent failure throws.
rmSync(build, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
