import { randomBytes } from "node:crypto";
import { RelayConfig } from "./types";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadRelayConfig(): RelayConfig {
  const host = (process.env.CODEX_RELAY_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = envNumber("CODEX_RELAY_PORT", 8787);
  const publicBaseUrl =
    (process.env.CODEX_RELAY_BASE_URL ?? `http://${host}:${port}`).trim() || `http://${host}:${port}`;
  const appServerUrl =
    (process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:4500").trim() || "ws://127.0.0.1:4500";
  const sessionSecret =
    (process.env.CODEX_RELAY_SESSION_SECRET ?? "").trim() ||
    randomBytes(24).toString("base64url");
  const pairingTtlMs = envNumber("CODEX_RELAY_PAIRING_TTL_MS", 5 * 60 * 1000);
  const promptMaxChars = envNumber("CODEX_RELAY_PROMPT_MAX_CHARS", 10000);
  const sessionRequestsPerMinute = envNumber("CODEX_RELAY_SESSION_REQ_PER_MIN", 30);
  const pairingRequestsPerHour = envNumber("CODEX_RELAY_PAIRING_REQ_PER_HOUR", 20);

  return {
    host,
    port,
    publicBaseUrl,
    appServerUrl,
    sessionSecret,
    pairingTtlMs,
    promptMaxChars,
    sessionRequestsPerMinute,
    pairingRequestsPerHour
  };
}
