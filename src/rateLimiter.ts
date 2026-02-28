interface CounterWindow {
  startedAt: number;
  count: number;
}

export class RateLimiter {
  private readonly globalWindow: CounterWindow = { startedAt: 0, count: 0 };
  private readonly perKey = new Map<string, CounterWindow>();

  constructor(
    private readonly perMinuteGlobal: number,
    private readonly perMinutePerKey: number
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    this.ensureFresh(this.globalWindow, now);
    const entry = this.perKey.get(key) ?? { startedAt: 0, count: 0 };
    this.ensureFresh(entry, now);

    if (this.globalWindow.count + 1 > this.perMinuteGlobal) {
      return false;
    }
    if (entry.count + 1 > this.perMinutePerKey) {
      return false;
    }

    this.globalWindow.count += 1;
    entry.count += 1;
    this.perKey.set(key, entry);
    return true;
  }

  private ensureFresh(window: CounterWindow, now: number): void {
    if (!window.startedAt || now - window.startedAt >= 60_000) {
      window.startedAt = now;
      window.count = 0;
    }
  }
}
