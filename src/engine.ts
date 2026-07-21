import { MEMORY_SELECTOR_PROMPT_V1, TOPIC_WORKER_PROMPT_V1 } from './prompts.js';
import type { CanonicalExchange, CanonicalTopic, CanonicalTopicStatus, LatestTopicWorkerRun, MemoryLlm, MemoryStorage, RetrieveResult, TopicWorkerResult } from './types.js';

const INTERNAL_BUBBLE_TAG_RE = /\[\[b_m(?:S|C|E)\]\]/g;
const ALLOWED_TOPIC_STATUSES = new Set(['open', 'provisional', 'finalized']);

export interface MemoryEngineOptions {
  storage: MemoryStorage;
  llm?: MemoryLlm;
  topicWorker?: MemoryLlm;
  selector?: MemoryLlm;
  now?: () => number;
}

type TopicDraft = { topicId: string; status: CanonicalTopicStatus; labelTerms: string[]; retrievalTerms: string[]; spans: Array<{ startSequence: number; endSequence: number }> };
type ValidationResult = { ok: boolean; errors: string[]; topicDrafts: TopicDraft[] };

export class MemoryEngine {
  private readonly storage: MemoryStorage;
  private readonly topicWorker: MemoryLlm;
  private readonly selector: MemoryLlm;
  private readonly now: () => number;

  constructor(options: MemoryEngineOptions) {
    this.storage = options.storage;
    const shared = options.llm;
    if (!shared && (!options.topicWorker || !options.selector)) throw new Error('Provide llm, or provide both topicWorker and selector');
    this.topicWorker = options.topicWorker ?? shared!;
    this.selector = options.selector ?? shared!;
    this.now = options.now ?? Date.now;
  }

  async begin(userText: string): Promise<CanonicalExchange> { return this.beginExchange({ userText }); }

  async beginExchange(input: { userText: string; userSentAt?: number }): Promise<CanonicalExchange> {
    const existing = await this.storage.listExchanges();
    const sequence = existing.reduce((max, item) => Math.max(max, item.sequence), 0) + 1;
    const userSentAt = input.userSentAt ?? this.now();
    const exchange: CanonicalExchange = {
      id: `ce_${userSentAt}_${randomId()}`,
      sequence,
      userText: input.userText,
      userSentAt,
      assistantText: '',
      assistantCompletedAt: null,
      status: 'pending',
      failureReason: null,
      source: 'live',
    };
    await this.storage.putExchange(exchange);
    return exchange;
  }

  async completeExchange(input: { exchangeId: string; assistantText: string; assistantCompletedAt?: number }): Promise<CanonicalExchange> {
    const exchange = await this.requireExchange(input.exchangeId);
    const next: CanonicalExchange = {
      ...exchange,
      assistantText: stripCanonicalAssistantProtocolTags(input.assistantText),
      assistantCompletedAt: input.assistantCompletedAt ?? this.now(),
      status: 'completed',
      failureReason: null,
    };
    await this.storage.putExchange(next);
    return next;
  }

  async failExchange(input: { exchangeId: string; failureReason: string; assistantCompletedAt?: number }): Promise<CanonicalExchange> {
    const exchange = await this.requireExchange(input.exchangeId);
    const next: CanonicalExchange = {
      ...exchange,
      assistantCompletedAt: input.assistantCompletedAt ?? this.now(),
      status: 'failed',
      failureReason: input.failureReason,
    };
    await this.storage.putExchange(next);
    return next;
  }

  async maybeRunTopicWorker(): Promise<TopicWorkerResult> {
    const exchanges = await this.storage.listExchanges();
    const completed = exchanges.filter((e) => e.status === 'completed' && e.source === 'live');
    if (completed.length < 6) return { ran: false, reason: 'completed_exchange_gate', run: null };

    const previousTopics = await this.storage.listTopics();
    const finalizedTopics = previousTopics.filter((topic) => topic.status === 'finalized');
    const finalizedEnd = finalizedTopics.flatMap((topic) => topic.spans.map((span) => span.endSequence)).reduce((max, seq) => Math.max(max, seq), 0);
    const activeTail = completed.filter((e) => e.sequence > finalizedEnd);
    if (activeTail.length < 6) return { ran: false, reason: 'active_tail_gate', run: null };

    const inputText = buildWorkerInput(activeTail);
    const inputTextBySequence = new Map(activeTail.map((e) => [e.sequence, `${e.userText}\n${stripCanonicalAssistantProtocolTags(e.assistantText)}`]));
    const topicIdOffset = previousTopics.reduce((max, topic) => {
      const match = /^T(\d+)$/.exec(topic.topicId);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const runId = `twr_${this.now()}_${randomId()}`;

    try {
      const rawOutput = await this.topicWorker.complete({ system: TOPIC_WORKER_PROMPT_V1, user: inputText, maxTokens: 2200, temperature: 0.1, topP: 0.9 });
      const validation = validateTopicWorkerOutput(rawOutput, activeTail.map((e) => e.sequence), topicIdOffset, inputTextBySequence);
      const newTopics = validation.ok ? buildTopics(validation.topicDrafts, activeTail, this.now()) : [];
      const acceptedTopics = validation.ok ? [...finalizedTopics, ...newTopics] : [];
      const run: LatestTopicWorkerRun = {
        runId,
        createdAt: this.now(),
        inputText,
        rawOutput,
        validationStatus: validation.ok ? 'accepted' : 'rejected',
        validationError: validation.ok ? null : validation.errors.join('\n'),
        acceptedTopics,
        requestModel: 'memory-llm',
      };
      await this.storage.saveLatestTopicWorkerRun(run);
      if (!validation.ok) return { ran: true, reason: 'rejected', run };
      await this.storage.replaceTopics(acceptedTopics);
      return { ran: true, reason: 'accepted', run };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const run: LatestTopicWorkerRun = {
        runId,
        createdAt: this.now(),
        inputText,
        rawOutput: message,
        validationStatus: 'failed',
        validationError: message,
        acceptedTopics: [],
        requestModel: 'memory-llm',
      };
      await this.storage.saveLatestTopicWorkerRun(run).catch(() => undefined);
      return { ran: true, reason: 'failed', run };
    }
  }

  async retrieve(input: { userMessage: string; now?: number }): Promise<RetrieveResult> {
    const now = input.now ?? this.now();
    const exchanges = await this.storage.listExchanges();
    const completed = exchanges.filter((e) => e.status === 'completed' && e.source === 'live');
    const recentContext = completed.slice(-5);
    const topics = await this.storage.listTopics();
    const topicDirectory = buildTopicDirectory(topics, now);
    const selectorInput = [
      `Current time:\n${formatTopicTime(now)}`,
      `Current user message:\n${input.userMessage}`,
      `Recent 5 completed exchanges:\n${buildWorkerInput(recentContext) || '(none)'}`,
      `Topic Directory:\n${topicDirectory || '(empty)'}`,
    ].join('\n\n');

    if (topics.length === 0) return emptyRetrieve(recentContext, topicDirectory, selectorInput, '');

    try {
      const selectorRawOutput = await this.selector.complete({ system: MEMORY_SELECTOR_PROMPT_V1, user: selectorInput, maxTokens: 400, temperature: 0.1, topP: 0.9 });
      const parsed = JSON.parse(selectorRawOutput) as { needsMemory?: unknown; topicIds?: unknown; needsTimeMetadata?: unknown };
      const requestedIds = Array.isArray(parsed.topicIds) ? parsed.topicIds.filter((id): id is string => typeof id === 'string').slice(0, 3) : [];
      const selectedTopics = parsed.needsMemory === true
        ? requestedIds.map((id) => topics.find((topic) => topic.topicId === id)).filter((topic): topic is CanonicalTopic => Boolean(topic))
        : [];
      const needsTimeMetadata = (parsed.needsTimeMetadata === true || isTimeMetadataQuestion(input.userMessage)) && selectedTopics.length > 0;
      const openedTopicPackets = selectedTopics.map((topic) => buildOpenedTopicPacket(topic, exchanges, now, needsTimeMetadata));
      const memoryContext = openedTopicPackets.length
        ? ['MEMORY_SECTION_FROM_TOPIC_STORE', "Use this restored older context only if it is relevant to the user's current message.", '', openedTopicPackets.join('\n\n---\n\n')].join('\n')
        : '';
      return {
        recentContext,
        topicDirectory,
        selectedTopicIds: selectedTopics.map((topic) => topic.topicId),
        openedTopicPackets,
        memoryContext,
        needsTimeMetadata,
        trace: { selectorInput, selectorRawOutput, selectorError: null },
      };
    } catch (error) {
      return {
        ...emptyRetrieve(recentContext, topicDirectory, selectorInput, ''),
        trace: { selectorInput, selectorRawOutput: '', selectorError: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  async listExchanges(): Promise<CanonicalExchange[]> { return this.storage.listExchanges(); }
  async listTopics(): Promise<CanonicalTopic[]> { return this.storage.listTopics(); }
  async getLatestTopicWorkerRun(): Promise<LatestTopicWorkerRun | null> { return this.storage.getLatestTopicWorkerRun(); }
  async clear(): Promise<void> {
    await Promise.all([this.storage.clearExchanges(), this.storage.clearTopics(), this.storage.clearLatestTopicWorkerRun()]);
  }

  private async requireExchange(id: string): Promise<CanonicalExchange> {
    const exchange = (await this.storage.listExchanges()).find((item) => item.id === id);
    if (!exchange) throw new Error(`Canonical exchange not found: ${id}`);
    return exchange;
  }
}

export function createMemory(options: MemoryEngineOptions): MemoryEngine { return new MemoryEngine(options); }

export function stripCanonicalAssistantProtocolTags(text: string): string {
  const cleaned = text.replace(INTERNAL_BUBBLE_TAG_RE, '');
  return cleaned === text ? text : cleaned.trim();
}

function buildWorkerInput(exchanges: CanonicalExchange[]): string {
  return exchanges.map((e) => `#${e.sequence}\nuser: ${e.userText}\nassistant: ${stripCanonicalAssistantProtocolTags(e.assistantText)}`).join('\n\n');
}

function validateTopicWorkerOutput(rawOutput: string, inputSequences: number[], topicIdOffset: number, inputTextBySequence: Map<number, string>): ValidationResult {
  const errors: string[] = [];
  if (!rawOutput.trim()) return { ok: false, errors: ['raw output is empty'], topicDrafts: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(rawOutput); }
  catch (error) { return { ok: false, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`], topicDrafts: [] }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, errors: ['JSON root must be an object'], topicDrafts: [] };
  const root = parsed as Record<string, unknown>;
  const extraRootKeys = Object.keys(root).filter((key) => key !== 'topics');
  if (extraRootKeys.length) errors.push(`top-level keys are not allowed: ${extraRootKeys.join(', ')}`);
  if (!Array.isArray(root.topics)) errors.push('topics must be an array');
  const topics = Array.isArray(root.topics) ? root.topics : [];
  const inputSet = new Set(inputSequences);
  const assigned = new Map<number, string>();
  const maxSequence = inputSequences.length ? Math.max(...inputSequences) : 0;
  const topicDrafts: TopicDraft[] = [];

  topics.forEach((value, index) => {
    const topicLabel = `T${topicIdOffset + index + 1}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${topicLabel}: topic must be an object`); return; }
    const topic = value as Record<string, unknown>;
    const extraTopicKeys = Object.keys(topic).filter((key) => !['status', 'labelTerms', 'retrievalTerms', 'spans'].includes(key));
    if (extraTopicKeys.length) errors.push(`${topicLabel}: topic keys are not allowed: ${extraTopicKeys.join(', ')}`);
    if (!ALLOWED_TOPIC_STATUSES.has(String(topic.status))) errors.push(`${topicLabel}: status must be open, provisional, or finalized`);
    const labelTerms = Array.isArray(topic.labelTerms) ? topic.labelTerms.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).map((x) => x.trim()) : [];
    const retrievalTerms = Array.isArray(topic.retrievalTerms) ? topic.retrievalTerms.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).map((x) => x.trim()) : [];
    if (!Array.isArray(topic.labelTerms) || labelTerms.length < 2 || labelTerms.length > 5) errors.push(`${topicLabel}: labelTerms must contain 2–5 keyword phrases`);
    if (!Array.isArray(topic.retrievalTerms) || retrievalTerms.length < 3 || retrievalTerms.length > 12) errors.push(`${topicLabel}: retrievalTerms must contain 3–12 transcript-grounded phrases`);
    const spansRaw = Array.isArray(topic.spans) ? topic.spans : [];
    if (!spansRaw.length) errors.push(`${topicLabel}: spans must be a non-empty array`);
    const spans: Array<{ startSequence: number; endSequence: number }> = [];
    for (const [spanIndex, spanValue] of spansRaw.entries()) {
      const span = spanValue && typeof spanValue === 'object' && !Array.isArray(spanValue) ? spanValue as Record<string, unknown> : {};
      const extraSpanKeys = Object.keys(span).filter((key) => key !== 'startSequence' && key !== 'endSequence');
      if (extraSpanKeys.length) errors.push(`${topicLabel} span ${spanIndex + 1}: span keys are not allowed: ${extraSpanKeys.join(', ')}`);
      const start = Number(span.startSequence);
      const end = Number(span.endSequence);
      if (!Number.isInteger(start) || !Number.isInteger(end)) { errors.push(`${topicLabel} span ${spanIndex + 1}: startSequence/endSequence must be integers`); continue; }
      if (start > end) { errors.push(`${topicLabel} span ${spanIndex + 1}: startSequence must be <= endSequence`); continue; }
      if (!inputSet.has(start) || !inputSet.has(end)) errors.push(`${topicLabel} span ${spanIndex + 1}: sequence endpoints must exist in worker input`);
      for (let sequence = start; sequence <= end; sequence++) {
        if (!inputSet.has(sequence)) continue;
        const existing = assigned.get(sequence);
        if (existing) errors.push(`sequence ${sequence} overlaps between ${existing} and ${topicLabel}`);
        else assigned.set(sequence, topicLabel);
      }
      spans.push({ startSequence: start, endSequence: end });
    }
    topicDrafts.push({
      topicId: topicLabel,
      status: ALLOWED_TOPIC_STATUSES.has(String(topic.status)) ? String(topic.status) as CanonicalTopicStatus : 'provisional',
      labelTerms,
      retrievalTerms,
      spans,
    });
  });

  for (const sequence of inputSequences) if (!assigned.has(sequence)) errors.push(`sequence ${sequence} is not assigned to any topic span`);
  const singles = topicDrafts.filter((topic) => topic.spans.reduce((n, span) => n + span.endSequence - span.startSequence + 1, 0) === 1);
  if (singles.length > 1) errors.push('too many one-exchange topics; likely over-splitting');
  const lowContent = /^[\s嗯啊哦哈好行对是的继续等等一下\.。!！?？~～-]{1,8}$/;
  for (const topic of singles) {
    const seq = topic.spans[0]?.startSequence;
    const text = seq ? inputTextBySequence.get(seq) ?? '' : '';
    if (lowContent.test(text.trim())) errors.push(`${topic.topicId}: low-content single-exchange topic must be merged into a neighboring substantive topic`);
  }
  for (const topic of topicDrafts) {
    const latestEnd = topic.spans.length ? Math.max(...topic.spans.map((span) => span.endSequence)) : 0;
    if (topic.status === 'finalized' && maxSequence - latestEnd < 4) errors.push(`${topic.topicId}: finalized topic needs at least four later completed exchanges outside the topic`);
  }
  return { ok: errors.length === 0, errors, topicDrafts: errors.length === 0 ? topicDrafts : [] };
}

function buildTopics(drafts: TopicDraft[], exchanges: CanonicalExchange[], updatedAt: number): CanonicalTopic[] {
  const bySequence = new Map(exchanges.map((e) => [e.sequence, e]));
  return drafts.map((draft) => {
    const records = draft.spans.flatMap((span) => {
      const result: CanonicalExchange[] = [];
      for (let sequence = span.startSequence; sequence <= span.endSequence; sequence++) {
        const exchange = bySequence.get(sequence);
        if (exchange) result.push(exchange);
      }
      return result;
    }).sort((a, b) => a.sequence - b.sequence);
    return {
      topicId: draft.topicId,
      status: draft.status,
      labelTerms: draft.labelTerms,
      retrievalTerms: draft.retrievalTerms,
      spans: draft.spans,
      startedAt: records[0]?.userSentAt ?? null,
      endedAt: records.at(-1)?.assistantCompletedAt ?? null,
      updatedAt,
      source: 'topic_worker_v1',
    };
  });
}

function buildTopicDirectory(topics: CanonicalTopic[], now: number): string {
  const blocks = topics.map((topic) => [
    `Topic ID: ${topic.topicId}`,
    `Keywords: ${topic.labelTerms.join('｜')}`,
    `Includes: ${(topic.retrievalTerms.length ? topic.retrievalTerms : topic.labelTerms).join('｜')}`,
    `Started: ${formatTopicTime(topic.startedAt)}`,
    `Ended: ${formatTopicTime(topic.endedAt)}`,
    `Relative time: ${formatRelative(topic.endedAt, now)}`,
    `Status: ${topic.status}`,
  ].join('\n')).join('\n\n');
  return [`Current time: ${formatTopicTime(now)}`, blocks].filter(Boolean).join('\n\n');
}

function buildOpenedTopicPacket(topic: CanonicalTopic, exchanges: CanonicalExchange[], now: number, includeTimes: boolean): string {
  const bySequence = new Map(exchanges.map((e) => [e.sequence, e]));
  const sequenceSet = new Set<number>();
  for (const span of topic.spans) for (let sequence = span.startSequence; sequence <= span.endSequence; sequence++) if (bySequence.has(sequence)) sequenceSet.add(sequence);
  const transcript = [...sequenceSet].sort((a, b) => a - b).map((sequence) => bySequence.get(sequence)!).map((exchange) => {
    const lines = [`#${exchange.sequence}`];
    if (includeTimes) {
      lines.push(`userSentAt: ${formatTopicTime(exchange.userSentAt)}`);
      lines.push(`assistantCompletedAt: ${formatTopicTime(exchange.assistantCompletedAt)}`);
    }
    lines.push(`user: ${exchange.userText}`);
    lines.push(`assistant: ${stripCanonicalAssistantProtocolTags(exchange.assistantText)}`);
    return lines.join('\n');
  }).join('\n\n');
  return [
    `Current time: ${formatTopicTime(now)}`,
    '',
    `Topic ID: ${topic.topicId}`,
    `Keywords: ${topic.labelTerms.join('｜')}`,
    `Includes: ${(topic.retrievalTerms.length ? topic.retrievalTerms : topic.labelTerms).join('｜')}`,
    `Started: ${formatTopicTime(topic.startedAt)}`,
    `Ended: ${formatTopicTime(topic.endedAt)}`,
    `Relative time: ${formatRelative(topic.endedAt, now)}`,
    '',
    transcript,
  ].join('\n');
}

function formatTopicTime(value: number | null): string { return value ? new Date(value).toISOString() : '—'; }
function formatRelative(value: number | null, now: number): string {
  if (!value) return 'unknown';
  const minutes = Math.floor(Math.max(0, now - value) / 60000);
  if (minutes < 1) return 'less than 1 minute ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
function isTimeMetadataQuestion(text: string): boolean { return /几点|什么时候|当时|那时候|几分钟前|多久前|时间/.test(text); }
function emptyRetrieve(recentContext: CanonicalExchange[], topicDirectory: string, selectorInput: string, selectorRawOutput: string): RetrieveResult {
  return { recentContext, topicDirectory, selectedTopicIds: [], openedTopicPackets: [], memoryContext: '', needsTimeMetadata: false, trace: { selectorInput, selectorRawOutput, selectorError: null } };
}
function randomId(): string { return Math.random().toString(36).slice(2, 8); }
