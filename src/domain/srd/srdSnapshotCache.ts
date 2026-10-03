/**
 * Rendered SRD snapshots, keyed by fingerprint (see srdSnapshotPlan.ts).
 *
 * Kept in memory on this device only - never in the document, which stays
 * small. Bounded by total size rather than count, since one image can be many
 * times another, and evicted least-recently-used first: the snapshots of the
 * document on screen are read on every render, so they stay; ones belonging
 * to framing or content that has since changed age out.
 */
export class SnapshotCache {
  private readonly entries = new Map<string, string>();
  private readonly maxChars: number;
  private size = 0;

  /** @param maxChars total size budget, in data-URL characters. */
  constructor(maxChars: number) {
    this.maxChars = maxChars;
  }

  get(fingerprint: string): string | undefined {
    const value = this.entries.get(fingerprint);
    if (value === undefined) return undefined;
    // Re-inserting moves the entry to the most-recently-used end.
    this.entries.delete(fingerprint);
    this.entries.set(fingerprint, value);
    return value;
  }

  has(fingerprint: string): boolean {
    return this.entries.has(fingerprint);
  }

  set(fingerprint: string, dataUrl: string): void {
    this.delete(fingerprint);
    // An image larger than the whole budget would evict everything and then
    // itself; it is simply not cached.
    if (dataUrl.length > this.maxChars) return;
    this.entries.set(fingerprint, dataUrl);
    this.size += dataUrl.length;
    for (const [key, value] of this.entries) {
      if (this.size <= this.maxChars) break;
      this.entries.delete(key);
      this.size -= value.length;
    }
  }

  delete(fingerprint: string): void {
    const existing = this.entries.get(fingerprint);
    if (existing === undefined) return;
    this.entries.delete(fingerprint);
    this.size -= existing.length;
  }

  get totalChars(): number {
    return this.size;
  }
}

/**
 * The cache shared by every SRD view in this tab, so leaving the view and
 * coming back, or switching documents and back, reuses what was rendered.
 * About 64 MB of data URLs: dozens of high-resolution snapshots.
 */
export const srdSnapshotCache = new SnapshotCache(64 * 1024 * 1024);
