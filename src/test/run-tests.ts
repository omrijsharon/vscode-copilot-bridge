import { runDedupeCacheTest } from "./dedupeCache.test";
import { runRateLimiterTest } from "./rateLimiter.test";

async function main(): Promise<void> {
  await runDedupeCacheTest();
  runRateLimiterTest();
  console.log("All tests passed.");
}

void main().catch((err) => {
  console.error("Tests failed:", err);
  process.exitCode = 1;
});
