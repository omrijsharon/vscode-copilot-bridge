import {
  OperatorAlertSummary,
  OperatorEventSummary,
  OperatorSessionDetail,
  OperatorSessionSummary,
  RelayLogEntry,
  RelaySession
} from "./types";

const MAX_OPERATOR_MESSAGE_LENGTH = 240;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function maskIpAddress(ipAddress: string | undefined): string | undefined {
  if (!ipAddress) {
    return undefined;
  }
  const trimmed = ipAddress.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.x.x`;
    }
  }

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}::x`;
    }
    return `${trimmed.slice(0, 4)}::x`;
  }

  return "[masked]";
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

export function toOperatorSessionSummary(session: RelaySession): OperatorSessionSummary {
  return {
    sessionId: session.sessionId,
    pairingId: session.pairingId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    os: session.os,
    deviceLabel: session.deviceLabel,
    maskedIp: maskIpAddress(session.ipAddress)
  };
}

export function toOperatorSessionDetail(session: RelaySession): OperatorSessionDetail {
  return {
    sessionId: session.sessionId,
    pairingId: session.pairingId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    os: session.os,
    deviceLabel: session.deviceLabel,
    ipAddress: session.ipAddress
  };
}

export function sanitizeOperatorSessions(sessions: RelaySession[]): OperatorSessionSummary[] {
  return sessions.map(toOperatorSessionSummary);
}

export function sanitizeOperatorLog(entry: RelayLogEntry): OperatorEventSummary {
  return {
    ts: entry.ts,
    kind: entry.kind,
    action: entry.action,
    sessionId: entry.sessionId,
    threadId: entry.threadId,
    status: entry.status,
    maskedIp: entry.maskedIp,
    os: entry.os,
    message: sanitizeOperatorMessage(entry.message)
  };
}

export function sanitizeOperatorLogs(entries: RelayLogEntry[]): OperatorEventSummary[] {
  return entries.map(sanitizeOperatorLog);
}

export function sanitizeOperatorAlerts(alerts: Array<Record<string, string>>): OperatorAlertSummary[] {
  return alerts.map((alert) => ({
    type: String(alert.type || "alert"),
    ts: String(alert.ts || ""),
    sessionId: alert.sessionId ? String(alert.sessionId) : undefined,
    message: String(alert.message || "")
  }));
}

export function summarizeOperatorState(input: {
  sessions: OperatorSessionSummary[];
  events: OperatorEventSummary[];
  alerts: OperatorAlertSummary[];
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
    eventsCount: input.events.length
  };
}
