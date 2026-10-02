import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataset, allInputs, exchanges, queries } from './dataset.mjs';
import { config } from './config.mjs';
import { here, sha, sourceIdentity } from './build.mjs';

export const json = value => JSON.stringify(value, null, 2) + '\n';
export function planEmbeddings() {
  const batches = ['document', 'query'].flatMap(purpose => {
    const size = config[`${purpose}BatchSize`];
    return Array.from({ length: Math.ceil(allInputs[purpose].length / size) }, (_, index) => {
      const texts = allInputs[purpose].slice(index * size, (index + 1) * size);
      const inputSha256 = sha(JSON.stringify({ model: config.model, baseUrl: config.baseUrl,
        dimension: config.dimension, purpose, texts }));
      return { purpose, inputs: texts.length, characters: texts.reduce((n, s) => n + [...s].length, 0),
        utf8Bytes: texts.reduce((n, s) => n + Buffer.byteLength(s), 0), inputSha256 };
    });
  });
  if (batches.length > config.maxPhysicalRequests) throw new Error('Frozen embedding request cap exceeded');
  return { uniqueDocumentInputs: allInputs.document.length, uniqueQueryInputs: allInputs.query.length,
    maximumRequests: config.maxPhysicalRequests, plannedRequests: batches.length, batches,
    tokenUsage: 'Provider usage recorded when returned; characters are not token estimates' };
}
export function validateDataset() {
  if (exchanges.length !== 200 || queries.length !== 50) throw new Error('Expected 200 exchanges and 50 pre-labeled queries');
  const sources = new Map();
  for (const turn of exchanges) {
    if (!turn.user.trim() || !turn.assistant.trim()) throw new Error('Completed exchanges require both nonempty messages');
    for (const role of ['user', 'assistant']) {
      const key = `${turn.ownerId}/${turn.sessionId}/${turn.turnId}:${role}`;
      if (sources.has(key)) throw new Error('Duplicate scoped source');
      sources.set(key, { ...turn, role, text: turn[role] });
    }
    if (turn.supersedesSourceId) {
      const prior = sources.get(`${turn.ownerId}/${turn.sessionId}/${turn.supersedesSourceId}`);
      if (!prior || prior.recordedAt >= turn.recordedAt) throw new Error('Invalid correction chain');
    }
  }
  if (new Set(queries.map(q => q.id)).size !== queries.length) throw new Error('Duplicate query ID');
  for (const query of queries) {
    for (const sourceId of [...query.expected, ...query.relevant]) {
      if (!sources.has(sourceId)) throw new Error('Query label names a missing source');
    }
  }
  return { exchanges: exchanges.length, visibleMessages: sources.size, queries: queries.length,
    owners: new Set(exchanges.map(t => t.ownerId)).size,
    ownerSessions: new Set(exchanges.map(t => `${t.ownerId}/${t.sessionId}`)).size,
    exchangesPerOwnerSession: Object.fromEntries([...new Set(exchanges.map(t => `${t.ownerId}/${t.sessionId}`))]
      .map(scope => [scope, exchanges.filter(t => `${t.ownerId}/${t.sessionId}` === scope).length])),
    correctionExchanges: exchanges.filter(t => t.supersedesSourceId).length };
}
function candidate() {
  const identity = sourceIdentity();
  const harness = readdirSync(here).filter(n => n.endsWith('.mjs')).sort()
    .map(name => ({ name, sha256: sha(readFileSync(join(here, name))) }));
  const manifest = { version: 1, benchmark: 'blind-synthetic-200-v1', syntheticOnly: true,
    freezePolicy: 'Labels, settings, input plan, harness, and runtime source hashes fixed before live evaluation. No post-result tuning.',
    datasetSha256: sha(json(dataset)), configSha256: sha(json(config)),
    harnessSha256: sha(JSON.stringify(harness)), harness,
    runtime: identity, corpus: validateDataset(), embeddingPlan: planEmbeddings(),
    fairness: [
      'Same exact completed messages, scoped IDs, roles, sequence, timestamps, and real vectors for both systems.',
      'Product explicit source-ID corrections and upstream native conflict_behavior=supersede differ in API hints and are labeled accordingly.',
      'Upstream unsupported native transcript history, erase, rebuild, and transcript-only failure recovery are N/A.',
      'Upstream exact source inspection uses externally retained synthetic fixture IDs with explain(); no native transcript enumeration is claimed.',
      'Retrieval metrics use gold user sources; paired assistant sources count as relevant for precision and are reported separately.',
      'Returned relevant precision divides relevant returned sources by all returned sources; it is not conventional fixed-denominator precision@5.',
      'Isolation is graded from actual stored node user_id/conversation_id and product transcript ownership, independently of caller-qualified IDs.',
      'Native provenance contracts differ: upstream traces scoped user IDs; product traces exact source IDs. Ref, timestamp, and metadata source ID must match for either.',
      'Historical checks reject all future and already superseded sources; forbidden source labels expand to both roles of their completed exchange.',
      'No Main LLM answers or generative evaluations. This measures retrieval and persistence on manually authored synthetic chats.',
    ],
  };
  return { ...manifest, manifestSha256: sha(json(manifest)) };
}
export function prepareFreeze() {
  const manifest = candidate();
  const paths = ['dataset.json', 'config.json', 'manifest.json'];
  const contents = [json(dataset), json(config), json(manifest)];
  for (let index = 0; index < paths.length; index++) {
    const path = join(here, paths[index]);
    if (existsSync(path) && readFileSync(path, 'utf8') !== contents[index]) {
      throw new Error('Existing frozen artifact differs; refuse to overwrite. Create a new version for a new evaluation.');
    }
  }
  paths.forEach((name, index) => { if (!existsSync(join(here, name))) writeFileSync(join(here, name), contents[index], { flag: 'wx' }); });
  return manifest;
}
export function verifyFreeze() {
  const frozen = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
  if (json(frozen) !== json(candidate()) || readFileSync(join(here, 'dataset.json'), 'utf8') !== json(dataset)
    || readFileSync(join(here, 'config.json'), 'utf8') !== json(config)) {
    throw new Error('Frozen dataset, settings, harness, or runtime changed; live evaluation refused');
  }
  return frozen;
}
