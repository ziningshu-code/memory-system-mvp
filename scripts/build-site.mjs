import { cp, mkdir } from 'node:fs/promises';
// Keep output separate from authored sources; no remote assets or API keys.
await mkdir('.site-dist', { recursive: true });
await cp('site', '.site-dist', { recursive: true });
await cp('dist', '.site-dist/sdk', { recursive: true });
await mkdir('.site-dist/examples', { recursive: true });
await cp('examples/scenario.mjs', '.site-dist/examples/scenario.mjs');
await mkdir('.site-dist/evaluation', { recursive: true });
await cp('docs/evaluation/scripted.json', '.site-dist/evaluation/scripted.json');
console.log('Static demo ready in .site-dist');

