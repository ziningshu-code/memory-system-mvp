/** Local lexical retrieval. It makes no semantic-equivalence or accuracy claim. */
const stopWords = new Set(('a an the is are was were be been being it its i me my we our you your they their them he she his her this that these those of for to from at by in on with and or but as not no do does did have has had can could would should will please what which who where when how tell remind remember about again earlier before previous said say discussed discussion plan planning last first now know thanks thank hello hi ' +
  '我 我们 你 你们 他 她 它 他们 的 了 是 在 有 和 与 及 就 都 也 又 呢 吗 啊 吧 把 被 给 个 这 那 一个 一下 什么 哪个 哪些 多少 怎么 如何 是否 之前 以前 后来 当时 现在 今天 昨天 前天 记得 记住 记忆 说 说过 聊 聊过 聊天 讲 讲过 讨论 告诉 帮我 请 还 再 回顾 最早 开始 最初 第一次 最近 最后 目前 谢谢 好的 嗯').split(/\s+/));
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export function terms(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const result: string[] = [];
  for (const segment of segmenter.segment(normalized)) {
    const word = segment.segment.trim();
    if (!segment.isWordLike || stopWords.has(word)) continue;
    if (/\p{Script=Han}/u.test(word)) {
      if (word.length > 1) result.push(word);
      if (word.length > 2) for (let i = 0; i < word.length - 1; i++) {
        const part = word.slice(i, i + 2); if (!stopWords.has(part)) result.push(part);
      }
    } else if (word.length > 1 || /\d/.test(word)) result.push(word);
  }
  return result;
}
export function keywords(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const word of terms(text)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort((a,b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, limit).map(([word]) => word);
}
export interface SearchDocument { id: string; text: string; }
export interface SearchHit { id: string; score: number; coverage: number; matched: number; }
export class LexicalIndex {
  private readonly rows: Array<{ id: string; counts: Map<string, number>; length: number }>;
  private readonly frequencies = new Map<string, number>();
  private readonly average: number;
  constructor(documents: SearchDocument[]) {
    this.rows = documents.map(doc => {
      const words = terms(doc.text), counts = new Map<string, number>();
      for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
      for (const word of counts.keys()) this.frequencies.set(word, (this.frequencies.get(word) ?? 0) + 1);
      return { id: doc.id, counts, length: words.length };
    });
    this.average = this.rows.reduce((n, row) => n + row.length, 0) / Math.max(1, this.rows.length) || 1;
  }
  search(query: string, limit = 10): SearchHit[] {
    const queryTerms = [...new Set(terms(query))];
    if (!queryTerms.length) return [];
    return this.rows.map(row => {
      let score = 0, matched = 0;
      for (const word of queryTerms) {
        const frequency = row.counts.get(word) ?? 0;
        if (!frequency) continue;
        matched++;
        const df = this.frequencies.get(word) ?? 0;
        const idf = Math.log(1 + (this.rows.length - df + 0.5) / (df + 0.5));
        score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * row.length / this.average));
      }
      return { id: row.id, score, coverage: matched / queryTerms.length, matched };
    }).filter(hit => hit.score > 0).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }
}
export interface TimeFilter { start?: number; end?: number; order?: 'first' | 'last' | 'both'; label: string; }
/** Local calendar days (DST aware). Explicit SDK bounds take precedence. */
export function timeFilter(query: string, now: number): TimeFilter | null {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  let offset: number | undefined;
  if (/前天|day before yesterday/i.test(query)) offset = -2;
  else if (/昨天|yesterday/i.test(query)) offset = -1;
  else if (/今天|\btoday\b/i.test(query)) offset = 0;
  if (offset !== undefined) {
    day.setDate(day.getDate() + offset); const start = day.getTime(); day.setDate(day.getDate() + 1);
    return { start, end: day.getTime(), label: `calendar-day:${new Date(start).toISOString()}` };
  }
  const date = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(query);
  if (date) {
    const exact = new Date(+date[1], +date[2] - 1, +date[3]);
    if (exact.getFullYear() === +date[1] && exact.getMonth() === +date[2] - 1 && exact.getDate() === +date[3]) {
      const start = exact.getTime(); exact.setDate(exact.getDate() + 1);
      return { start, end: exact.getTime(), label: date[0] };
    }
  }
  const first = /最早|最初|第一次|一开始|聊天开始|\b(first|earliest|beginning|original)\b/i.test(query);
  const last = /最新|最后|最近|目前|\b(latest|most recent|current|revised)\b/i.test(query);
  if (first && last) return { order: 'both', label: 'both' };
  if (first) return { order: 'first', label: 'first' };
  if (last) return { order: 'last', label: 'last' };
  return null;
}
