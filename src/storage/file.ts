import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanonicalExchange, CanonicalTopic, LatestTopicWorkerRun, MemoryStorage } from '../types.js';

type State = { version: 1; exchanges: CanonicalExchange[]; topics: CanonicalTopic[]; latestRun: LatestTopicWorkerRun | null };
/** Durable local storage. One owner per file; serialize complete turns in the host. */
export class FileMemoryStorage implements MemoryStorage {
  private readonly path: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(path: string) { this.path = resolve(path); }
  private async read(): Promise<State> {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')) as State;
      if (data.version !== 1 || !Array.isArray(data.exchanges) || !Array.isArray(data.topics)) throw new Error('Invalid memory store');
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, exchanges: [], topics: [], latestRun: null };
      throw error;
    }
  }
  private change(update: (state: State) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const state = await this.read(); update(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async snapshot(): Promise<State> { await this.queue; return this.read(); }
  async listExchanges(): Promise<CanonicalExchange[]> { return (await this.snapshot()).exchanges.sort((a,b) => a.sequence-b.sequence); }
  async putExchange(exchange: CanonicalExchange): Promise<void> {
    const record = structuredClone(exchange);
    return this.change(s => { const i = s.exchanges.findIndex(e => e.id === record.id); if (i < 0) s.exchanges.push(record); else s.exchanges[i] = record; });
  }
  async clearExchanges(): Promise<void> { return this.change(s => { s.exchanges = []; }); }
  async listTopics(): Promise<CanonicalTopic[]> { return (await this.snapshot()).topics; }
  async replaceTopics(topics: CanonicalTopic[]): Promise<void> { const records = structuredClone(topics); return this.change(s => { s.topics = records; }); }
  async clearTopics(): Promise<void> { return this.change(s => { s.topics = []; }); }
  async getLatestTopicWorkerRun(): Promise<LatestTopicWorkerRun | null> { return (await this.snapshot()).latestRun; }
  async saveLatestTopicWorkerRun(run: LatestTopicWorkerRun): Promise<void> { const record = structuredClone(run); return this.change(s => { s.latestRun = record; }); }
  async clearLatestTopicWorkerRun(): Promise<void> { return this.change(s => { s.latestRun = null; }); }
}
