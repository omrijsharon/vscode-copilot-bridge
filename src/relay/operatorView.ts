import { RelayLogEntry, RelaySession } from "./types";

const MAX_OPERATOR_USER_AGENT_LENGTH = 120;
const MAX_OPERATOR_MESSAGE_LENGTH = 240;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function sanitizeOperatorUserAgent(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  return truncate(userAgent, MAX_OPERATOR_USER_AGENT_LENGTH);
}

export function sanitizeOperatorMessage(message: string | undefined): string | undefined {
  if (!message) {
    return undefined;
  }
  let sanitized = message;
  sanitized = sanitized.replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]");
  sanitized = sanitized.replace(/codex_relay_(session|operator)=[^;\s]+/gi, "codex_relay_$1=[redacted]");
  return truncate(sanitized, MAX_OPERATOR_MESSAGE_LENGTH);
}

export function sanitizeOperatorLog(entry: RelayLogEntry): RelayLogEntry {
  return {
    ...entry,
    userAgent: sanitizeOperatorUserAgent(entry.userAgent),
    message: sanitizeOperatorMessage(entry.message)
  };
}

export function sanitizeOperatorLogs(entries: RelayLogEntry[]): RelayLogEntry[] {
  return entries.map(sanitizeOperatorLog);
}

export function sanitizeOperatorSession(session: RelaySession): RelaySession {
  return {
    ...session,
    userAgent: sanitizeOperatorUserAgent(session.userAgent)
  };
}

export function sanitizeOperatorSessions(sessions: RelaySession[]): RelaySession[] {
  return sessions.map(sanitizeOperatorSession);
}

export function summarizeOperatorState(input: {
  sessions: RelaySession[];
  logs: RelayLogEntry[];
  alerts: Array<Record<string, string>>;
  baseUrl: string;
  cookieMode: string;
}): Record<string, unknown> {
  return {
    relay: {
      baseUrl: input.baseUrl,
      cookieMode: input.cookieMode
    },
    sessionsCount: input.sessions.length,
    alertsCount: input.alerts.length,
    logsCount: input.logs.length
  };
}
