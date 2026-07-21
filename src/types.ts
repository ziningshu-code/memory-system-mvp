export type CanonicalExchangeStatus = 'pending' | 'completed' | 'failed';
export type CanonicalTopicStatus = 'open' | 'provisional' | 'finalized';

export interface CanonicalExchange {
  id: string;
  sequence: number;
  userText: string;
  userSentAt: number;
  assistantText: string;
  assistantCompletedAt: number | null;
  status: CanonicalExchangeStatus;
  failureReason: string | null;
  source: 'live';
}

export interface CanonicalTopicSpan { startSequence: number; endSequence: number; }

export interface CanonicalTopic {
  topicId: string;
  status: CanonicalTopicStatus;
  labelTerms: string[];
  retrievalTerms: string[];
  spans: CanonicalTopicSpan[];
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  source: 'topic_worker_v1';
}

export type TopicWorkerRunValidationStatus = 'accepted' | 'rejected' | 'failed';

export interface LatestTopicWorkerRun {
  runId: string;
  createdAt: number;
  inputText: string;
  rawOutput: string;
  validationStatus: TopicWorkerRunValidationStatus;
  validationError: string | null;
  acceptedTopics: CanonicalTopic[];
  requestModel: string;
}

export interface MemoryLlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
}

export interface MemoryLlm { complete(input: MemoryLlmRequest): Promise<string>; }

export interface MemoryStorage {
  listExchanges(): Promise<CanonicalExchange[]>;
  putExchange(exchange: CanonicalExchange): Promise<void>;
  clearExchanges(): Promise<void>;
  listTopics(): Promise<CanonicalTopic[]>;
  replaceTopics(topics: CanonicalTopic[]): Promise<void>;
  clearTopics(): Promise<void>;
  getLatestTopicWorkerRun(): Promise<LatestTopicWorkerRun | null>;
  saveLatestTopicWorkerRun(run: LatestTopicWorkerRun): Promise<void>;
  clearLatestTopicWorkerRun(): Promise<void>;
}

export interface RetrieveResult {
  recentContext: CanonicalExchange[];
  topicDirectory: string;
  selectedTopicIds: string[];
  openedTopicPackets: string[];
  memoryContext: string;
  needsTimeMetadata: boolean;
  trace: { selectorInput: string; selectorRawOutput: string; selectorError: string | null };
}

export interface TopicWorkerResult {
  ran: boolean;
  reason: 'completed_exchange_gate' | 'active_tail_gate' | 'accepted' | 'rejected' | 'failed';
  run: LatestTopicWorkerRun | null;
}
