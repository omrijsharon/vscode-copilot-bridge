const test = require("node:test");
const assert = require("node:assert/strict");

const {
  maskIpAddress,
  sanitizeOperatorMessage,
  sanitizeOperatorLogs,
  sanitizeOperatorSessions,
  toOperatorSessionDetail
} = require("../out/relay/operatorView.js");

test("maskIpAddress returns stable masked values for operator summaries", () => {
  assert.equal(maskIpAddress("1.2.3.4"), "1.2.x.x");
  assert.equal(maskIpAddress("2001:db8:abcd:0012::1"), "2001:db8::x");
});

test("sanitizeOperatorMessage redacts pairing tokens and relay cookies", () => {
  const input =
    "visit https://host/pair?token=abc123&x=1 and cookie codex_relay_session=session.secret value";
  const output = sanitizeOperatorMessage(input);
  assert.equal(output.includes("token=abc123"), false);
  assert.equal(output.includes("token=[redacted]"), true);
  assert.equal(output.includes("codex_relay_session=session.secret"), false);
  assert.equal(output.includes("codex_relay_session=[redacted]"), true);
});

test("sanitizeOperatorLogs exposes only minimal event fields", () => {
  const [entry] = sanitizeOperatorLogs([
    {
      ts: "2026-04-15T00:00:00.000Z",
      kind: "http",
      action: "pairingConsume",
      status: "ok",
      sessionId: "session-1",
      threadId: "thread-1",
      maskedIp: "1.2.x.x",
      os: "Android",
      message: "https://host/pair?token=abc123"
    }
  ]);

  assert.deepEqual(entry, {
    ts: "2026-04-15T00:00:00.000Z",
    kind: "http",
    action: "pairingConsume",
    status: "ok",
    sessionId: "session-1",
    threadId: "thread-1",
    maskedIp: "1.2.x.x",
    os: "Android",
    message: "https://host/pair?token=[redacted]"
  });
});

test("sanitizeOperatorSessions returns masked summaries instead of raw session metadata", () => {
  const [session] = sanitizeOperatorSessions([
    {
      sessionId: "session-1",
      pairingId: "pairing-1",
      createdAt: 1,
      expiresAt: 2,
      ipAddress: "1.2.3.4",
      os: "Android",
      deviceLabel: "Chrome on Android"
    }
  ]);

  assert.deepEqual(session, {
    sessionId: "session-1",
    pairingId: "pairing-1",
    createdAt: 1,
    expiresAt: 2,
    os: "Android",
    deviceLabel: "Chrome on Android",
    maskedIp: "1.2.x.x"
  });
});

test("toOperatorSessionDetail keeps full IP only in explicit session detail view", () => {
  const detail = toOperatorSessionDetail({
    sessionId: "session-1",
    pairingId: "pairing-1",
    createdAt: 1,
    expiresAt: 2,
    ipAddress: "1.2.3.4",
    os: "Android",
    deviceLabel: "Chrome on Android"
  });

  assert.deepEqual(detail, {
    sessionId: "session-1",
    pairingId: "pairing-1",
    createdAt: 1,
    expiresAt: 2,
    ipAddress: "1.2.3.4",
    os: "Android",
    deviceLabel: "Chrome on Android"
  });
});
