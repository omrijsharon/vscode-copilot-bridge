import assert from "node:assert/strict";
import { DedupeCache } from "../dedupeCache";

export async function runDedupeCacheTest(): Promise<void> {
  const cache = new DedupeCache(25);
  const key = "agent:trace";

  assert.equal(cache.has(key), false);
  cache.add(key);
  assert.equal(cache.has(key), true);

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(cache.has(key), false);
}
