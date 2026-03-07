export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  take(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= now) {
      const next = {
        count: 1,
        resetAt: now + this.windowMs
      };
      this.entries.set(key, next);
      return {
        allowed: true,
        remaining: Math.max(this.limit - 1, 0),
        resetAt: next.resetAt
      };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.resetAt
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(this.limit - existing.count, 0),
      resetAt: existing.resetAt
    };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.entries.entries()) {
      if (value.resetAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
