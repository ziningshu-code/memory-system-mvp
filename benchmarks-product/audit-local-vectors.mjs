import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allEmbeddingInputs, correctionQueries } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', 'validation-nvidia');
const wanted = {
  passage: new Set(allEmbeddingInputs.document),
  query: new Set([...allEmbeddingInputs.query,
    'Do I currently live in Beijing?', 'Do I currently live in Shenzhen?',
    'Do I currently live in Shanghai?', ...Object.values(correctionQueries)]),
};
const found = { passage: new Set(), query: new Set() };
let scanned = 0;
let suitable = 0;
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) { if (item.name !== 'node_modules') walk(path); continue; }
    if (!item.name.endsWith('.json') || !path.includes(`${join('results', 'requests')}`)) continue;
    scanned++;
    let row;
    try { row = JSON.parse(readFileSync(path, 'utf8')); }
    catch { continue; }
    const body = row.request;
    if (row.status !== 'complete' || body?.model !== 'nvidia/nemotron-3-embed-1b'
      || !['passage', 'query'].includes(body?.input_type)
      || !Array.isArray(body.input) || !Array.isArray(row.response?.data)
      || body.input.length !== row.response.data.length) continue;
    suitable++;
    for (const text of body.input) if (wanted[body.input_type].has(text)) found[body.input_type].add(text);
  }
}
walk(root);
console.log(JSON.stringify({ scannedRequestRecords: scanned, suitableRealModelRecords: suitable,
  exactInputCoverage: {
    document: { found: found.passage.size, required: wanted.passage.size },
    query: { found: found.query.size, required: wanted.query.size },
  }, fullOfflineReplayPossible: found.passage.size === wanted.passage.size
    && found.query.size === wanted.query.size }, null, 2));
