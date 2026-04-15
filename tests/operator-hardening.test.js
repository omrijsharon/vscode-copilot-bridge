const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeOperatorMessage,
  sanitizeOperatorUserAgent,
  sanitizeOperatorLogs,
  sanitizeOperatorSessions
} = require("../out/relay/operatorView.js");

test("sanitizeOperatorMessage redacts pairing tokens and relay cookies", () => {
  const input =
    "visit https://host/pair?token=abc123&x=1 and cookie codex_relay_session=session.secret value";
  const output = sanitizeOperatorMessage(input);
  assert.equal(output.includes("token=abc123"), false);
  assert.equal(output.includes("token=[redacted]"), true);
  assert.equal(output.includes("codex_relay_session=session.secret"), false);
  assert.equal(output.includes("codex_relay_session=[redacted]"), true);
});

test("sanitizeOperatorUserAgent truncates long user agents", () => {
  const longUserAgent = "Mozilla/5.0 ".repeat(20);
  const output = sanitizeOperatorUserAgent(longUserAgent);
  assert.ok(output.length <= 120);
});

test("sanitizeOperatorLogs keeps useful metadata but sanitizes message and userAgent", () => {
  const [entry] = sanitizeOperatorLogs([
    {
      ts: "2026-04-15T00:00:00.000Z",
      kind: "http",
      action: "pairingStart",
      status: "ok",
      sessionId: "session-1",
      threadId: "thread-1",
      ipAddress: "1.2.3.4",
      os: "Android",
      userAgent: "Mozilla/5.0 ".repeat(20),
      message: "https://host/pair?token=abc123"
    }
  ]);

  assert.equal(entry.sessionId, "session-1");
  assert.equal(entry.threadId, "thread-1");
  assert.equal(entry.ipAddress, "1.2.3.4");
  assert.equal(entry.os, "Android");
  assert.equal(entry.message.includes("abc123"), false);
  assert.ok(entry.userAgent.length <= 120);
});

test("sanitizeOperatorSessions truncates userAgent without removing session metadata", () => {
  const [session] = sanitizeOperatorSessions([
    {
      sessionId: "session-1",
      pairingId: "pairing-1",
      createdAt: 1,
      expiresAt: 2,
      ipAddress: "1.2.3.4",
      userAgent: "Mozilla/5.0 ".repeat(20),
      os: "Android",
      country: "IL",
      city: "Tel Aviv",
      asn: "AS1234",
      isp: "Example ISP"
    }
  ]);

  assert.equal(session.sessionId, "session-1");
  assert.equal(session.pairingId, "pairing-1");
  assert.equal(session.ipAddress, "1.2.3.4");
  assert.equal(session.os, "Android");
  assert.ok(session.userAgent.length <= 120);
});
