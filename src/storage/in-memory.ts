import type { CanonicalExchange, CanonicalTopic, LatestTopicWorkerRun, MemoryStorage } from '../types.js';

export class InMemoryStorage implements MemoryStorage {
  private exchanges = new Map<string, CanonicalExchange>();
  private topics = new Map<string, CanonicalTopic>();
  private latestRun: LatestTopicWorkerRun | null = null;

  async listExchanges(): Promise<CanonicalExchange[]> {
    return [...this.exchanges.values()].sort((a, b) => a.sequence - b.sequence).map(clone);
  }
  async putExchange(exchange: CanonicalExchange): Promise<void> { this.exchanges.set(exchange.id, clone(exchange)); }
  async clearExchanges(): Promise<void> { this.exchanges.clear(); }
  async listTopics(): Promise<CanonicalTopic[]> {
    return [...this.topics.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.topicId.localeCompare(b.topicId)).map(clone);
  }
  async replaceTopics(topics: CanonicalTopic[]): Promise<void> {
    this.topics.clear();
    for (const topic of topics) this.topics.set(topic.topicId, clone(topic));
  }
  async clearTopics(): Promise<void> { this.topics.clear(); }
  async getLatestTopicWorkerRun(): Promise<LatestTopicWorkerRun | null> { return this.latestRun ? clone(this.latestRun) : null; }
  async saveLatestTopicWorkerRun(run: LatestTopicWorkerRun): Promise<void> { this.latestRun = clone(run); }
  async clearLatestTopicWorkerRun(): Promise<void> { this.latestRun = null; }
}

function clone<T>(value: T): T { return structuredClone(value); }
