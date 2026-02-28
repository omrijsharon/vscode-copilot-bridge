import assert from "node:assert/strict";
import { RateLimiter } from "../rateLimiter";

export function runRateLimiterTest(): void {
  const limiter = new RateLimiter(3, 2);

  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);

  assert.equal(limiter.allow("b"), true);
  assert.equal(limiter.allow("c"), false);
}
