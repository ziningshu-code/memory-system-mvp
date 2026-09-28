export type TokenCounter = (text: string) => number;
/** UTF-8 bytes are an explicit conservative budgeting unit, not measured tokens. */
export class TextBudget {
  readonly unit: 'tokens' | 'utf8-bytes';
  constructor(private readonly counter?: TokenCounter) { this.unit = counter ? 'tokens' : 'utf8-bytes'; }
  count(text: string): number {
    const value = this.counter ? this.counter(text) : new TextEncoder().encode(text).length;
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid token counter result');
    return Math.ceil(value);
  }
  clip(text: string, limit: number): string {
    if (limit <= 0) return '';
    if (this.count(text) <= limit) return text;
    const chars = Array.from(text);
    let low = 0, high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.count(chars.slice(0, mid).join('') + '…') <= limit) low = mid; else high = mid - 1;
    }
    let clipped = chars.slice(0, low).join('') + '…';
    while (this.count(clipped) > limit && low > 0) clipped = chars.slice(0, --low).join('') + '…';
    return this.count(clipped) <= limit ? clipped : '';
  }
}
