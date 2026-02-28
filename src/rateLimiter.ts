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
    if (!this.bump(this.globalWindow, now, this.perMinuteGlobal)) {
      return false;
    }
    const entry = this.perKey.get(key) ?? { startedAt: 0, count: 0 };
    const allowed = this.bump(entry, now, this.perMinutePerKey);
    this.perKey.set(key, entry);
    return allowed;
  }

  private bump(window: CounterWindow, now: number, cap: number): boolean {
    if (!window.startedAt || now - window.startedAt >= 60_000) {
      window.startedAt = now;
      window.count = 0;
    }
    window.count += 1;
    return window.count <= cap;
  }
}
