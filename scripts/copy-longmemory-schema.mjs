import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('build-product/longmemory/stores/sqlite', { recursive: true });
copyFileSync('src/longmemory/stores/sqlite/schema.sql', 'build-product/longmemory/stores/sqlite/schema.sql');
