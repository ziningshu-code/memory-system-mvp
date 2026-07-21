import type { CanonicalExchange, CanonicalTopic, LatestTopicWorkerRun, MemoryStorage } from '../types.js';

const EXCHANGE_STORE = 'canonical_exchanges';
const TOPIC_STORE = 'topics';
const RUN_STORE = 'latest_topic_worker_run';

export interface IndexedDbMemoryStorageOptions { dbName?: string; indexedDB?: IDBFactory; }

export class IndexedDbMemoryStorage implements MemoryStorage {
  private readonly dbName: string;
  private readonly idb: IDBFactory;

  constructor(options: IndexedDbMemoryStorageOptions = {}) {
    this.dbName = options.dbName ?? 'topic-memory:v1';
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB is not available in this environment');
    this.idb = factory;
  }

  async listExchanges(): Promise<CanonicalExchange[]> {
    const records = await this.getAll<CanonicalExchange>(EXCHANGE_STORE);
    return records.sort((a, b) => a.sequence - b.sequence);
  }
  async putExchange(exchange: CanonicalExchange): Promise<void> { await this.write(EXCHANGE_STORE, (store) => store.put(exchange)); }
  async clearExchanges(): Promise<void> { await this.write(EXCHANGE_STORE, (store) => store.clear()); }
  async listTopics(): Promise<CanonicalTopic[]> {
    const records = await this.getAll<CanonicalTopic>(TOPIC_STORE);
    return records.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.topicId.localeCompare(b.topicId));
  }
  async replaceTopics(topics: CanonicalTopic[]): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TOPIC_STORE, 'readwrite');
      const store = tx.objectStore(TOPIC_STORE);
      store.clear();
      for (const topic of topics) store.put(topic);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB topic transaction failed')); };
      tx.onabort = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB topic transaction aborted')); };
    });
  }
  async clearTopics(): Promise<void> { await this.write(TOPIC_STORE, (store) => store.clear()); }
  async getLatestTopicWorkerRun(): Promise<LatestTopicWorkerRun | null> {
    const records = await this.getAll<LatestTopicWorkerRun>(RUN_STORE);
    return records.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  async saveLatestTopicWorkerRun(run: LatestTopicWorkerRun): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RUN_STORE, 'readwrite');
      const store = tx.objectStore(RUN_STORE);
      store.clear();
      store.put(run);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB run transaction failed')); };
      tx.onabort = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB run transaction aborted')); };
    });
  }
  async clearLatestTopicWorkerRun(): Promise<void> { await this.write(RUN_STORE, (store) => store.clear()); }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.open();
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll() as IDBRequest<T[]>;
      tx.oncomplete = () => { db.close(); resolve(request.result ?? []); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB read failed')); };
      tx.onabort = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB read aborted')); };
    });
  }

  private async write(storeName: string, action: (store: IDBObjectStore) => IDBRequest | void): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      action(tx.objectStore(storeName));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB write failed')); };
      tx.onabort = () => { const error = tx.error; db.close(); reject(error ?? new Error('IndexedDB write aborted')); };
    });
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.idb.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EXCHANGE_STORE)) {
          const store = db.createObjectStore(EXCHANGE_STORE, { keyPath: 'id' });
          store.createIndex('sequence', 'sequence', { unique: true });
          store.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(TOPIC_STORE)) db.createObjectStore(TOPIC_STORE, { keyPath: 'topicId' });
        if (!db.objectStoreNames.contains(RUN_STORE)) db.createObjectStore(RUN_STORE, { keyPath: 'runId' });
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB memory database'));
      request.onsuccess = () => resolve(request.result);
    });
  }
}
