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
export type TopicChange = 'continuation' | 'addition' | 'revision' | 'negation';
export interface TopicLinkEvidence {
  kind: 'same_event' | 'related' | 'separate';
  targetFamilyId: string;
  sequence: number;
  /** Exact source excerpt supporting the model's relation claim, not proof of its semantic correctness. */
  quote: string;
}
export interface TopicFamilyMembership {
  id: string;
  /** Stable real-world goal; never a rolling replacement of historical evidence. */
  scope: string;
  relatedIds: string[];
  changes: Array<{sequence: number; kind: TopicChange}>;
  linkEvidence?: TopicLinkEvidence[];
}
export interface TopicEmbedding { model: string; text: string; vector: number[]; }

export interface CanonicalTopic {
  topicId: string;
  status: CanonicalTopicStatus;
  labelTerms: string[];
  retrievalTerms: string[];
  spans: CanonicalTopicSpan[];
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  relatedTopicIds?: string[];
  family?: TopicFamilyMembership;
  embedding?: TopicEmbedding;
  source: 'topic_worker_v1' | 'topic_worker_v2' | 'local_lexical_v1';
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
  inputSequences?: number[];
  modelCalls?: number;
  budgetUnit?: 'tokens' | 'utf8-bytes';
  warnings?: string[];
  /** Only explicit temporary transport failures may receive one delayed automatic retry. */
  transportTransient?: boolean;
  transportRetryCount?: number;
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
  commitIndex?(topics: CanonicalTopic[], run: LatestTopicWorkerRun): Promise<void>;
}

export interface RetrieveResult {
  recentContext: CanonicalExchange[];
  topicDirectory: string;
  selectedTopicIds: string[];
  openedTopicPackets: string[];
  memoryContext: string;
  needsTimeMetadata: boolean;
  trace: {
    selectorInput: string; selectorRawOutput: string; selectorError: string | null;
    strategy?: 'local' | 'model' | 'local-fallback' | 'empty';
    candidateTopicIds?: string[]; recoveredSequences?: number[]; selectorCalls?: number;
    budgetUnit?: 'tokens' | 'utf8-bytes'; memoryUnits?: number; budgetLimit?: number;
    truncated?: boolean; temporalFilter?: string | null;
    candidateSequences?: number[]; recentUnits?: number; recentTruncated?: boolean;
  };
}

export interface TopicWorkerResult {
  ran: boolean;
  reason: 'completed_exchange_gate' | 'active_tail_gate' | 'unchanged_input' | 'batch_gate' | 'accepted' | 'rejected' | 'failed' | 'budget_gate' | 'cooldown' | 'disabled';
  run: LatestTopicWorkerRun | null;
}
