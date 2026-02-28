export class DedupeCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  has(key: string): boolean {
    this.gc();
    return this.seen.has(key);
  }

  add(key: string): void {
    this.gc();
    this.seen.set(key, Date.now());
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, ts] of this.seen.entries()) {
      if (now - ts > this.ttlMs) {
        this.seen.delete(key);
      }
    }
  }
}
