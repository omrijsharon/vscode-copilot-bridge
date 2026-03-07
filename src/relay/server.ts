import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import { AppServerClient } from "./appServerClient";
import { loadRelayConfig } from "./config";
import { RelayLogger } from "./logger";
import { FixedWindowRateLimiter } from "./rateLimiter";
import { PairingStore, SessionStore } from "./state";
import { ThreadMetadataStore } from "./threadMetadataStore";
import { RelayClientMessage, RelayServerEvent } from "./types";

const remoteClientPath = path.resolve(__dirname, "../../relay-client/index.html");
const operatorClientPath = path.resolve(__dirname, "../../relay-client/operator.html");

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function relayCookieAttributes(baseUrl: string): string {
  const isHttps = baseUrl.startsWith("https://");
  return [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    isHttps ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) {
    return {};
  }
  return Object.fromEntries(
    raw.split(";").map((entry) => {
      const [key, ...rest] = entry.trim().split("=");
      return [key, rest.join("=")];
    })
  );
}

function getSession(req: IncomingMessage, secret: string, sessions: SessionStore) {
  const cookies = parseCookies(req);
  return SessionStore.readSignedSession(cookies.codex_relay_session, secret, sessions);
}

function sendWs(ws: WebSocket, payload: RelayServerEvent): void {
  ws.send(JSON.stringify(payload));
}

function validateThreadId(threadId: string): boolean {
  return /^[a-zA-Z0-9-]{10,}$/.test(threadId);
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readLatestThreadContext(threadPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(threadPath, "utf8");
    const lines = raw.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      const parsed = safeJsonParse<Record<string, unknown>>(line);
      if (!parsed || parsed.type !== "turn_context") {
        continue;
      }
      const payload =
        parsed.payload && typeof parsed.payload === "object"
          ? (parsed.payload as Record<string, unknown>)
          : null;
      if (payload) {
        return payload;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function loadAvailableModels(): Promise<Array<Record<string, unknown>>> {
  try {
    const file = path.join(os.homedir(), ".codex", "models_cache.json");
    const raw = await readFile(file, "utf8");
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    return models
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          slug: typeof record.slug === "string" ? record.slug : "",
          displayName: typeof record.display_name === "string" ? record.display_name : "",
          description: typeof record.description === "string" ? record.description : "",
          defaultReasoningLevel:
            typeof record.default_reasoning_level === "string" ? record.default_reasoning_level : "",
          supportedReasoningLevels: Array.isArray(record.supported_reasoning_levels)
            ? record.supported_reasoning_levels
            : []
        };
      })
      .filter((entry) => entry.slug);
  } catch {
    return [];
  }
}

async function enrichThread(
  thread: Record<string, unknown>,
  metadataStore: ThreadMetadataStore
): Promise<Record<string, unknown>> {
  const out = { ...thread };
  const threadId = typeof thread.id === "string" ? thread.id : "";
  const metadata = threadId ? metadataStore.get(threadId) : undefined;
  if ((!out.name || typeof out.name !== "string" || !out.name.trim()) && metadata?.title) {
    out.name = metadata.title;
  }

  const threadPath = typeof thread.path === "string" ? thread.path : "";
  const context = threadPath ? await readLatestThreadContext(threadPath) : null;
  if (context) {
    out.runtime = {
      model: typeof context.model === "string" ? context.model : null,
      cwd: typeof context.cwd === "string" ? context.cwd : null,
      approvalPolicy: typeof context.approval_policy === "string" ? context.approval_policy : null,
      sandboxPolicy:
        context.sandbox_policy && typeof context.sandbox_policy === "object"
          ? context.sandbox_policy
          : null
    };
  }

  return out;
}

async function makePairingQrSvg(pairUrl: string): Promise<string> {
  return QRCode.toString(pairUrl, {
    type: "svg",
    margin: 1,
    width: 280,
    color: {
      dark: "#201813",
      light: "#fffdf8"
    }
  });
}

function flattenTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") {
          return record.text;
        }
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function threadToMessages(thread: Record<string, unknown>): Array<{ role: "user" | "assistant"; text: string; phase?: string }> {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const out: Array<{ role: "user" | "assistant"; text: string; phase?: string }> = [];

  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }
    const items = Array.isArray((turn as Record<string, unknown>).items)
      ? ((turn as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [];
    for (const item of items) {
      if (item.type === "userMessage") {
        const text = flattenTextContent(item.content);
        if (text) {
          out.push({ role: "user", text });
        }
      } else if (item.type === "agentMessage") {
        const text = typeof item.text === "string" ? item.text : flattenTextContent(item.content);
        if (text) {
          out.push({
            role: "assistant",
            text,
            phase: typeof item.phase === "string" ? item.phase : undefined
          });
        }
      }
    }
  }

  return out;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const config = loadRelayConfig();
  const pairings = new PairingStore();
  const sessions = new SessionStore();
  const appServer = new AppServerClient(config.appServerUrl);
  const logger = new RelayLogger();
  const metadataStore = new ThreadMetadataStore(path.resolve(process.cwd(), "diagnostics"));
  const pairingRateLimiter = new FixedWindowRateLimiter(config.pairingRequestsPerHour, 60 * 60 * 1000);
  const sessionRateLimiter = new FixedWindowRateLimiter(config.sessionRequestsPerMinute, 60 * 1000);
  const wsServer = new WebSocketServer({ noServer: true });
  await metadataStore.load();
  const cleanupTimer = setInterval(() => {
    pairings.cleanup();
    sessions.cleanup();
    pairingRateLimiter.cleanup();
    sessionRateLimiter.cleanup();
  }, 60_000);
  cleanupTimer.unref();

  wsServer.on("connection", (ws, req) => {
    const session = getSession(req, config.sessionSecret, sessions);
    if (!session) {
      ws.close(1008, "unauthenticated");
      return;
    }

    let activeThreadId = "";

    sendWs(ws, {
      type: "session",
      authenticated: true,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt
    });

    const unsubscribe = appServer.onNotification((message) => {
      const method = typeof message.method === "string" ? message.method : "";
      const params =
        message.params && typeof message.params === "object"
          ? (message.params as Record<string, unknown>)
          : {};

      if (method === "turn/started") {
        sendWs(ws, { type: "turnStarted", threadId: activeThreadId });
        return;
      }

      if (method === "item/agentMessage/delta") {
        sendWs(ws, {
          type: "assistantDelta",
          threadId: activeThreadId,
          delta:
            (typeof params.delta === "string" && params.delta) ||
            (typeof params.textDelta === "string" && params.textDelta) ||
            (typeof params.text === "string" && params.text) ||
            ""
        });
        return;
      }

      if (method === "turn/completed") {
        sendWs(ws, { type: "turnCompleted", threadId: activeThreadId });
        return;
      }

      if (method === "turn/failed" || method === "turn/error") {
        sendWs(ws, {
          type: "error",
          threadId: activeThreadId,
          message: typeof params.message === "string" ? params.message : method
        });
      }
    });

    ws.on("message", async (raw) => {
      try {
        const rate = sessionRateLimiter.take(`ws:${session.sessionId}`);
        if (!rate.allowed) {
          logger.record({
            ts: new Date().toISOString(),
            kind: "ws",
            action: "rateLimit",
            sessionId: session.sessionId,
            status: "error",
            message: "session websocket rate limit exceeded"
          });
          sendWs(ws, { type: "error", message: "rate limit exceeded" });
          return;
        }

        const msg = JSON.parse(raw.toString()) as RelayClientMessage;

        if (msg.type === "refreshThreads") {
          const result = await appServer.call<{ data?: unknown[] }>("thread/list", {});
          const data = Array.isArray(result?.data) ? result.data : [];
          const enriched = await Promise.all(
            data.map(async (entry) => {
              const thread = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
              return await enrichThread(thread, metadataStore);
            })
          );
          logger.record({
            ts: new Date().toISOString(),
            kind: "ws",
            action: "refreshThreads",
            sessionId: session.sessionId,
            status: "ok"
          });
          sendWs(ws, {
            type: "threads",
            data: enriched
          });
          return;
        }

        if (msg.type === "loadThread") {
          if (!msg.threadId || !validateThreadId(msg.threadId)) {
            logger.record({
              ts: new Date().toISOString(),
              kind: "ws",
              action: "loadThread",
              sessionId: session.sessionId,
              status: "error",
              message: "invalid threadId"
            });
            sendWs(ws, { type: "error", message: "threadId is required" });
            return;
          }
          activeThreadId = msg.threadId;
          await appServer.call("thread/resume", { threadId: msg.threadId });
          const result = await appServer.call<{ thread?: Record<string, unknown> }>("thread/read", {
            threadId: msg.threadId,
            includeTurns: true
          });
          const thread = await enrichThread(result?.thread ?? {}, metadataStore);
          sendWs(ws, {
            type: "threadLoaded",
            thread,
            messages: threadToMessages(thread)
          });
          logger.record({
            ts: new Date().toISOString(),
            kind: "ws",
            action: "loadThread",
            sessionId: session.sessionId,
            threadId: msg.threadId,
            status: "ok"
          });
          return;
        }

        if (msg.type === "startThread") {
          const startParams: Record<string, unknown> = {};
          if (typeof msg.cwd === "string" && msg.cwd.trim()) {
            startParams.cwd = msg.cwd.trim();
          }
          if (typeof msg.model === "string" && msg.model.trim()) {
            startParams.model = msg.model.trim();
          }
          if (typeof msg.approvalPolicy === "string" && msg.approvalPolicy.trim()) {
            startParams.approvalPolicy = msg.approvalPolicy.trim();
          }
          if (msg.sandboxPolicy && typeof msg.sandboxPolicy === "object") {
            startParams.sandboxPolicy = msg.sandboxPolicy;
          }

          const result = await appServer.call<Record<string, unknown>>("thread/start", startParams);
          const threadId =
            (typeof result.threadId === "string" && result.threadId) ||
            (result.thread && typeof (result.thread as Record<string, unknown>).id === "string"
              ? ((result.thread as Record<string, unknown>).id as string)
              : "") ||
            (typeof result.id === "string" ? result.id : "");
          if (threadId && typeof msg.title === "string" && msg.title.trim()) {
            await metadataStore.setTitle(threadId, msg.title.trim());
          }
          activeThreadId = threadId;
          const thread =
            result.thread && typeof result.thread === "object"
              ? await enrichThread(result.thread as Record<string, unknown>, metadataStore)
              : await enrichThread({ id: threadId }, metadataStore);
          sendWs(ws, { type: "threadLoaded", thread, messages: [], settings: result });
          logger.record({
            ts: new Date().toISOString(),
            kind: "ws",
            action: "startThread",
            sessionId: session.sessionId,
            threadId,
            status: "ok"
          });
          return;
        }

        if (msg.type === "sendPrompt") {
          const prompt = (msg.prompt ?? "").trim();
          if (!prompt || prompt.length > config.promptMaxChars) {
            logger.record({
              ts: new Date().toISOString(),
              kind: "ws",
              action: "sendPrompt",
              sessionId: session.sessionId,
              threadId: msg.threadId,
              status: "error",
              message: "invalid prompt"
            });
            sendWs(ws, { type: "error", message: "prompt is required and must be within max length" });
            return;
          }

          if (msg.threadId) {
            if (!validateThreadId(msg.threadId)) {
              logger.record({
                ts: new Date().toISOString(),
                kind: "ws",
                action: "sendPrompt",
                sessionId: session.sessionId,
                status: "error",
                message: "invalid threadId"
              });
              sendWs(ws, { type: "error", message: "invalid threadId" });
              return;
            }
            activeThreadId = msg.threadId;
          }

          if (!activeThreadId) {
            const result = await appServer.call<Record<string, unknown>>("thread/start", {});
            activeThreadId =
              (typeof result.threadId === "string" && result.threadId) ||
              (result.thread && typeof (result.thread as Record<string, unknown>).id === "string"
                ? ((result.thread as Record<string, unknown>).id as string)
                : "") ||
              (typeof result.id === "string" ? result.id : "");
          }

          await appServer.call("thread/resume", { threadId: activeThreadId });
          const turnStartParams: Record<string, unknown> = {
            threadId: activeThreadId,
            input: [{ type: "text", text: prompt }]
          };
          if (typeof msg.model === "string" && msg.model.trim()) {
            turnStartParams.model = msg.model.trim();
          }
          if (typeof msg.approvalPolicy === "string" && msg.approvalPolicy.trim()) {
            turnStartParams.approvalPolicy = msg.approvalPolicy.trim();
          }
          if (msg.sandboxPolicy && typeof msg.sandboxPolicy === "object") {
            turnStartParams.sandboxPolicy = msg.sandboxPolicy;
          }
          await appServer.call("turn/start", turnStartParams);
          logger.record({
            ts: new Date().toISOString(),
            kind: "ws",
            action: "sendPrompt",
            sessionId: session.sessionId,
            threadId: activeThreadId,
            status: "ok"
          });
          return;
        }

        sendWs(ws, { type: "error", message: "unsupported relay message" });
      } catch (error) {
        logger.record({
          ts: new Date().toISOString(),
          kind: "ws",
          action: "message",
          sessionId: session.sessionId,
          threadId: activeThreadId,
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
        sendWs(ws, {
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    ws.on("close", () => {
      unsubscribe();
    });
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", config.publicBaseUrl);

      if (req.method === "GET" && url.pathname === "/health") {
        let appServerStatus = "unknown";
        try {
          await appServer.call("thread/list", {});
          appServerStatus = "ok";
        } catch (error) {
          appServerStatus = error instanceof Error ? error.message : String(error);
        }

        sendJson(res, 200, {
          ok: true,
          relay: {
            host: config.host,
            port: config.port
          },
          appServer: {
            url: config.appServerUrl,
            status: appServerStatus
          }
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        const html = await readFile(remoteClientPath, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/operator") {
        const html = await readFile(operatorClientPath, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pairing/start") {
        const rate = pairingRateLimiter.take(req.socket.remoteAddress ?? "unknown");
        if (!rate.allowed) {
          logger.record({
            ts: new Date().toISOString(),
            kind: "http",
            action: "pairingStart",
            status: "error",
            message: "pairing rate limit exceeded"
          });
          sendJson(res, 429, { error: "pairing rate limit exceeded" });
          return;
        }
        const pairing = pairings.create(config.pairingTtlMs);
        const pairUrl = `${config.publicBaseUrl}/pair?token=${pairing.token}`;
        const qrSvg = await makePairingQrSvg(pairUrl);
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "pairingStart",
          status: "ok"
        });
        sendJson(res, 200, {
          pairingId: pairing.pairingId,
          token: pairing.token,
          expiresAt: pairing.expiresAt,
          pairUrl,
          qrSvg
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/pair") {
        const token = url.searchParams.get("token") ?? "";
        const pairing = pairings.consume(token);
        if (!pairing) {
          logger.record({
            ts: new Date().toISOString(),
            kind: "http",
            action: "pairingConsume",
            status: "error",
            message: "invalid or expired pairing token"
          });
          sendText(res, 400, "Pairing token is invalid or expired.");
          return;
        }

        const session = sessions.create(pairing.pairingId, config.pairingTtlMs * 12);
        const signature = SessionStore.signSession(session.sessionId, config.sessionSecret);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": `codex_relay_session=${session.sessionId}.${signature}; ${relayCookieAttributes(config.publicBaseUrl)}`
        });
        res.end(
          `<!doctype html><html><body><h1>Pairing complete</h1><p>Session created.</p><p>Redirecting to <a href="/">remote chat</a>...</p><script>setTimeout(()=>location.href='/',800)</script></body></html>`
        );
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "pairingConsume",
          sessionId: session.sessionId,
          status: "ok"
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/session") {
        const session = getSession(req, config.sessionSecret, sessions);
        sendJson(res, 200, {
          authenticated: Boolean(session),
          sessionId: session?.sessionId ?? null,
          expiresAt: session?.expiresAt ?? null
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/options") {
        const models = await loadAvailableModels();
        sendJson(res, 200, {
          models,
          approvalPolicies: ["on-request", "never", "untrusted"],
          sandboxPolicies: [
            { label: "Read Only", value: "readOnly", payload: { type: "readOnly" } },
            { label: "Workspace Write", value: "workspaceWrite", payload: { type: "workspace-write" } },
            { label: "Danger Full Access", value: "dangerFullAccess", payload: { type: "danger-full-access" } }
          ]
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/logout") {
        const cookies = parseCookies(req);
        const signed = cookies.codex_relay_session;
        const session = SessionStore.readSignedSession(signed, config.sessionSecret, sessions);
        if (session) {
          sessions.delete(session.sessionId);
        }
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `codex_relay_session=; Max-Age=0; ${relayCookieAttributes(config.publicBaseUrl)}`
        });
        res.end(JSON.stringify({ ok: true }, null, 2));
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "logout",
          sessionId: session?.sessionId,
          status: "ok"
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/session/revoke-current") {
        const cookies = parseCookies(req);
        const signed = cookies.codex_relay_session;
        const session = SessionStore.readSignedSession(signed, config.sessionSecret, sessions);
        if (!session) {
          sendJson(res, 401, { error: "unauthenticated" });
          return;
        }
        sessions.delete(session.sessionId);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `codex_relay_session=; Max-Age=0; ${relayCookieAttributes(config.publicBaseUrl)}`
        });
        res.end(JSON.stringify({ ok: true, revokedSessionId: session.sessionId }, null, 2));
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "revokeCurrentSession",
          sessionId: session.sessionId,
          status: "ok"
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/operator/state") {
        sendJson(res, 200, {
          pairings: pairings.list(),
          sessions: sessions.list(),
          logs: logger.list(),
          relay: {
            baseUrl: config.publicBaseUrl,
            appServerUrl: config.appServerUrl,
            cookieMode: config.publicBaseUrl.startsWith("https://") ? "secure" : "non-secure"
          },
          guidance: {
            ifAppServerDown: [
              "Start Codex app-server on ws://127.0.0.1:4500",
              "Use scripts/start-codex-relay.ps1 to launch app-server and relay together"
            ],
            ifPortBusy: [
              "Check whether relay is already running on CODEX_RELAY_PORT",
              "Change CODEX_RELAY_PORT or stop the previous relay process"
            ],
            ifPhoneCannotConnect: [
              "Verify the phone can reach the relay host URL",
              "Use a public/tunneled HTTPS URL in CODEX_RELAY_BASE_URL",
              "Do not expose raw app-server; expose only the relay"
            ],
            forDifferentNetwork: [
              "Set CODEX_RELAY_HOST=0.0.0.0 if the relay itself must bind beyond localhost",
              "Set CODEX_RELAY_BASE_URL to the real public HTTPS URL used by the phone",
              "Keep CODEX_APP_SERVER_URL local on ws://127.0.0.1:4500",
              "Prefer a tunnel or reverse proxy in front of the relay"
            ]
          }
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/operator/session/revoke") {
        const body = await readBody(req);
        const parsed = body ? (JSON.parse(body) as { sessionId?: string }) : {};
        if (!parsed.sessionId) {
          sendJson(res, 400, { error: "sessionId is required" });
          return;
        }
        sessions.delete(parsed.sessionId);
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "operatorRevokeSession",
          sessionId: parsed.sessionId,
          status: "ok"
        });
        sendJson(res, 200, { ok: true, revokedSessionId: parsed.sessionId });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/operator/session/revoke-all") {
        const revokedCount = sessions.deleteAll();
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "operatorRevokeAllSessions",
          status: "ok",
          message: `revoked ${revokedCount} sessions`
        });
        sendJson(res, 200, { ok: true, revokedCount });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/thread/list") {
        const body = await readBody(req);
        const session = getSession(req, config.sessionSecret, sessions);
        if (!session) {
          sendJson(res, 401, { error: "unauthenticated" });
          return;
        }
        const rate = sessionRateLimiter.take(`http:${session.sessionId}`);
        if (!rate.allowed) {
          sendJson(res, 429, { error: "session rate limit exceeded" });
          return;
        }

        void body;
        const result = await appServer.call<{ data?: unknown[] }>("thread/list", {});
        const data = Array.isArray(result.data) ? result.data : [];
        const enriched = await Promise.all(
          data.map(async (entry) => {
            const thread = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
            return await enrichThread(thread, metadataStore);
          })
        );
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "threadList",
          sessionId: session.sessionId,
          status: "ok"
        });
        sendJson(res, 200, { ...result, data: enriched });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/thread/read") {
        const body = await readBody(req);
        const session = getSession(req, config.sessionSecret, sessions);
        if (!session) {
          sendJson(res, 401, { error: "unauthenticated" });
          return;
        }
        const parsed = body ? (JSON.parse(body) as { threadId?: string }) : {};
        const rate = sessionRateLimiter.take(`http:${session.sessionId}`);
        if (!rate.allowed) {
          sendJson(res, 429, { error: "session rate limit exceeded" });
          return;
        }
        if (!parsed.threadId || !validateThreadId(parsed.threadId)) {
          sendJson(res, 400, { error: "threadId is required" });
          return;
        }
        await appServer.call("thread/resume", { threadId: parsed.threadId });
        const result = await appServer.call<{ thread?: Record<string, unknown> }>("thread/read", {
          threadId: parsed.threadId,
          includeTurns: true
        });
        const thread = await enrichThread(result.thread ?? {}, metadataStore);
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "threadRead",
          sessionId: session.sessionId,
          threadId: parsed.threadId,
          status: "ok"
        });
        sendJson(res, 200, { ...result, thread });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", config.publicBaseUrl);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit("connection", ws, req);
    });
  });

  server.listen(config.port, config.host, () => {
    process.stdout.write(
      [
        "codex-remote-relay",
        `  relay: ${config.publicBaseUrl}`,
        `  app-server: ${config.appServerUrl}`,
        `  remote client: ${config.publicBaseUrl}/`,
        `  operator page: ${config.publicBaseUrl}/operator`,
        `  pairing endpoint: POST ${config.publicBaseUrl}/api/pairing/start`,
        `  relay websocket: ws://${config.host}:${config.port}/ws`
      ].join("\n") + "\n"
    );
  });
}

void main();
