import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import { AppServerClient } from "./appServerClient";
import { loadRelayConfig } from "./config";
import { RelayLogger } from "./logger";
import {
  maskIpAddress,
  sanitizeOperatorAlerts,
  sanitizeOperatorLogs,
  sanitizeOperatorSessions,
  summarizeOperatorState,
  toOperatorSessionDetail
} from "./operatorView";
import { FixedWindowRateLimiter } from "./rateLimiter";
import { PairingStore, SessionStore } from "./state";
import { ThreadMetadataStore } from "./threadMetadataStore";
import { RelayChatMessage, RelayClientMessage, RelayLogEntry, RelayMessageSegment, RelayServerEvent } from "./types";

const remoteClientPath = path.resolve(__dirname, "../../relay-client/index.html");
const operatorClientPath = path.resolve(__dirname, "../../relay-client/operator.html");
const allowedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const imageMimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function renderOperatorLoginShell(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex Relay Operator</title>
    <style>
      :root {
        --bg: #efe7da;
        --panel: #fffaf3;
        --ink: #201813;
        --muted: #77685d;
        --line: #d7c8b9;
        --accent: #225d4a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: linear-gradient(180deg, #f6ede2, var(--bg));
        color: var(--ink);
      }
      .shell {
        max-width: 720px;
        margin: 48px auto;
        padding: 0 16px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 22px;
      }
      .muted {
        color: var(--muted);
      }
      input[type="password"] {
        border: 1px solid var(--line);
        background: #fffdf9;
        color: var(--ink);
        border-radius: 10px;
        padding: 10px 14px;
        font: inherit;
        min-width: 260px;
      }
      button {
        border: 1px solid var(--accent);
        background: var(--accent);
        color: #fffaf3;
        border-radius: 10px;
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
      }
      .row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      pre {
        white-space: pre-wrap;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #fffdf9;
        padding: 12px;
        font-family: Consolas, "Courier New", monospace;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <h1>Codex Relay Operator</h1>
        <p class="muted">Operator access is required.</p>
        <p id="authStatus" class="muted">Checking operator access...</p>
        <div id="loginRow" class="row" hidden>
          <input id="operatorSecretInput" type="password" placeholder="Enter operator secret" />
          <button id="operatorLoginBtn">Login</button>
        </div>
      </div>
    </div>
    <script>
      const el = (id) => document.getElementById(id);
      async function getJson(url, options = {}) {
        const response = await fetch(url, {
          credentials: "include",
          headers: { "content-type": "application/json" },
          ...options
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};
        if (!response.ok) {
          throw new Error(JSON.stringify(payload, null, 2));
        }
        return payload;
      }
      async function refreshAuth() {
        const auth = await getJson("/api/operator/auth-state");
        if (auth.authenticated) {
          location.reload();
          return;
        }
        el("authStatus").textContent = auth.mode === "secret"
          ? "Operator secret required."
          : "Operator access is local-only. Open this page from the relay host.";
        el("loginRow").hidden = auth.mode !== "secret";
      }
      async function login() {
        try {
          const secret = el("operatorSecretInput").value;
          await getJson("/api/operator/login", {
            method: "POST",
            body: JSON.stringify({ secret })
          });
          location.reload();
        } catch (error) {
          el("authStatus").textContent = "Operator login failed.";
        }
      }
      el("operatorLoginBtn")?.addEventListener("click", () => void login());
      el("operatorSecretInput")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void login();
        }
      });
      void refreshAuth();
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function operatorCookieAttributes(baseUrl: string): string {
  return relayCookieAttributes(baseUrl);
}

function operatorCookieValue(secret: string): string {
  return SessionStore.signSession("operator", secret);
}

function operatorMode(config: { operatorSecret: string }): "local-only" | "secret" {
  return config.operatorSecret ? "secret" : "local-only";
}

function inferOs(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android")) {
    return "Android";
  }
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) {
    return "iOS";
  }
  if (ua.includes("windows")) {
    return "Windows";
  }
  if (ua.includes("mac os") || ua.includes("macintosh")) {
    return "macOS";
  }
  if (ua.includes("linux")) {
    return "Linux";
  }
  return "Unknown";
}

function inferBrowserFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) {
    return "Edge";
  }
  if (ua.includes("opr/") || ua.includes("opera")) {
    return "Opera";
  }
  if (ua.includes("samsungbrowser/")) {
    return "Samsung Internet";
  }
  if (ua.includes("firefox/")) {
    return "Firefox";
  }
  if (ua.includes("chrome/") || ua.includes("crios/")) {
    return "Chrome";
  }
  if (ua.includes("safari/")) {
    return "Safari";
  }
  return "Browser";
}

function inferDeviceLabel(userAgent: string, os: string): string {
  const browser = inferBrowserFamily(userAgent);
  if (os && os !== "Unknown") {
    return `${browser} on ${os}`;
  }
  return browser;
}

function getClientIp(req: IncomingMessage): string {
  const cfConnectingIp = req.headers["cf-connecting-ip"];
  if (typeof cfConnectingIp === "string" && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }

  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() || req.socket.remoteAddress || "";
  }

  return req.socket.remoteAddress ?? "";
}

function isLoopbackIp(ipAddress: string): boolean {
  const normalized = ipAddress.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isLocalRequest(req: IncomingMessage): boolean {
  const directIp = req.socket.remoteAddress ?? "";
  const hasForwardedHeaders =
    Boolean(req.headers["cf-connecting-ip"]) || Boolean(req.headers["x-forwarded-for"]);
  return isLoopbackIp(directIp) && !hasForwardedHeaders;
}

function sameOriginAllowed(req: IncomingMessage, publicBaseUrl: string): boolean {
  const expectedOrigin = new URL(publicBaseUrl).origin;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
  if (origin) {
    return origin === expectedOrigin;
  }

  const referer = typeof req.headers.referer === "string" ? req.headers.referer.trim() : "";
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return isLocalRequest(req);
}

function requireSameOriginPost(req: IncomingMessage, res: ServerResponse, publicBaseUrl: string): boolean {
  if (sameOriginAllowed(req, publicBaseUrl)) {
    return true;
  }
  sendJson(res, 403, { error: "origin_not_allowed" });
  return false;
}

function hasOperatorCookie(req: IncomingMessage, secret: string): boolean {
  if (!secret) {
    return false;
  }
  const cookies = parseCookies(req);
  return cookies.codex_relay_operator === operatorCookieValue(secret);
}

function hasOperatorAccess(req: IncomingMessage, config: { operatorSecret: string }): boolean {
  if (config.operatorSecret) {
    return hasOperatorCookie(req, config.operatorSecret);
  }
  return isLocalRequest(req);
}

function requireOperatorAccess(
  req: IncomingMessage,
  res: ServerResponse,
  config: { operatorSecret: string }
): boolean {
  if (hasOperatorAccess(req, config)) {
    return true;
  }
  sendJson(res, 401, {
    error: "operator_auth_required",
    mode: operatorMode(config)
  });
  return false;
}

function buildSessionAlerts(logs: RelayLogEntry[]): Array<Record<string, string>> {
  const successfulPairings = logs
    .filter((entry) => entry.action === "pairingConsume" && entry.status === "ok" && entry.sessionId)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

  const alerts: Array<Record<string, string>> = [];
  let lastMaskedIp = "";
  let lastOs = "";

  for (const entry of successfulPairings) {
    const currentMaskedIp = entry.maskedIp || "";
    const currentOs = entry.os || "";

    if (lastMaskedIp && currentMaskedIp && currentMaskedIp !== lastMaskedIp) {
      alerts.push({
        type: "ipChange",
        ts: entry.ts,
        sessionId: entry.sessionId || "",
        message: `New client network detected: ${currentMaskedIp} (previous ${lastMaskedIp})`
      });
    }

    if (lastOs && currentOs && currentOs !== lastOs) {
      alerts.push({
        type: "osChange",
        ts: entry.ts,
        sessionId: entry.sessionId || "",
        message: `New client OS detected: ${currentOs} (previous ${lastOs})`
      });
    }

    if (
      lastMaskedIp &&
      lastOs &&
      ((currentMaskedIp && currentMaskedIp !== lastMaskedIp) || (currentOs && currentOs !== lastOs))
    ) {
      alerts.push({
        type: "fingerprintChange",
        ts: entry.ts,
        sessionId: entry.sessionId || "",
        message: `Client fingerprint changed to ${currentMaskedIp || "unknown network"} / ${currentOs || "unknown OS"}`
      });
    }

    if (currentMaskedIp) {
      lastMaskedIp = currentMaskedIp;
    }
    if (currentOs) {
      lastOs = currentOs;
    }
  }

  return alerts.reverse().slice(0, 20);
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

function getThreadWorkspace(thread: Record<string, unknown>): string {
  const runtime = thread.runtime && typeof thread.runtime === "object"
    ? (thread.runtime as Record<string, unknown>)
    : {};
  if (typeof runtime.cwd === "string" && runtime.cwd.trim()) {
    return path.resolve(runtime.cwd);
  }
  if (typeof thread.cwd === "string" && thread.cwd.trim()) {
    return path.resolve(thread.cwd);
  }
  return "";
}

function resolveImagePath(
  thread: Record<string, unknown>,
  referencedPath: string
): { ok: true; workspace: string; resolvedPath: string; ext: string } | { ok: false; reason: string } {
  const workspace = getThreadWorkspace(thread);
  if (!workspace) {
    return { ok: false, reason: "thread workspace is unavailable" };
  }

  const candidate = referencedPath.trim();
  if (!candidate) {
    return { ok: false, reason: "image path is empty" };
  }

  const resolvedPath = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspace, candidate);
  const relative = path.relative(workspace, resolvedPath);
  if (!relative || relative === "") {
    return { ok: false, reason: "image path must point to a file inside the workspace" };
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "image path is outside the workspace" };
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!allowedImageExtensions.has(ext)) {
    return { ok: false, reason: "file is not a supported image type" };
  }

  return { ok: true, workspace, resolvedPath, ext };
}

async function buildImageSegment(
  threadId: string,
  thread: Record<string, unknown>,
  referencedPath: string
): Promise<RelayMessageSegment> {
  const resolved = resolveImagePath(thread, referencedPath);
  if (!resolved.ok) {
    return {
      type: "image-error",
      path: referencedPath,
      reason: resolved.reason
    };
  }

  try {
    const fileStat = await stat(resolved.resolvedPath);
    if (!fileStat.isFile()) {
      return {
        type: "image-error",
        path: referencedPath,
        reason: "image path does not point to a regular file"
      };
    }
  } catch {
    return {
      type: "image-error",
      path: referencedPath,
      reason: "image file does not exist"
    };
  }

  return {
    type: "image",
    path: referencedPath,
    url: `/api/thread/image?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(referencedPath)}`
  };
}

async function parseAssistantSegments(
  threadId: string,
  thread: Record<string, unknown>,
  text: string
): Promise<RelayMessageSegment[]> {
  const segments: RelayMessageSegment[] = [];
  const pattern = /<img>([\s\S]*?)<\/img>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [fullMatch, rawPath = ""] = match;
    const start = match.index;
    if (start > cursor) {
      const prefix = text.slice(cursor, start);
      if (prefix) {
        segments.push({ type: "text", text: prefix });
      }
    }

    segments.push(await buildImageSegment(threadId, thread, rawPath.trim()));
    cursor = start + fullMatch.length;
  }

  if (cursor < text.length) {
    const suffix = text.slice(cursor);
    if (suffix) {
      segments.push({ type: "text", text: suffix });
    }
  }

  return segments.length ? segments : [{ type: "text", text }];
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

async function threadToMessages(
  thread: Record<string, unknown>
): Promise<RelayChatMessage[]> {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const out: RelayChatMessage[] = [];
  const threadId = typeof thread.id === "string" ? thread.id : "";

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
            phase: typeof item.phase === "string" ? item.phase : undefined,
            segments: await parseAssistantSegments(threadId, thread, text)
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
  const publicHost = new URL(config.publicBaseUrl).hostname;
  if (!config.operatorSecret && !isLocalHostname(publicHost)) {
    throw new Error(
      "CODEX_RELAY_OPERATOR_SECRET is required when CODEX_RELAY_BASE_URL is not localhost/127.0.0.1"
    );
  }
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
    let activeThread: Record<string, unknown> | null = null;
    let currentAssistantText = "";

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
        currentAssistantText = "";
        sendWs(ws, { type: "turnStarted", threadId: activeThreadId });
        return;
      }

      if (method === "item/agentMessage/delta") {
        currentAssistantText +=
          (typeof params.delta === "string" && params.delta) ||
          (typeof params.textDelta === "string" && params.textDelta) ||
          (typeof params.text === "string" && params.text) ||
          "";
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
        void (async () => {
          if (activeThreadId && currentAssistantText) {
            try {
              const result = await appServer.call<{ thread?: Record<string, unknown> }>("thread/read", {
                threadId: activeThreadId,
                includeTurns: false
              });
              activeThread = await enrichThread(result?.thread ?? { id: activeThreadId }, metadataStore);
              sendWs(ws, {
                type: "assistantMessage",
                threadId: activeThreadId,
                message: {
                  role: "assistant",
                  text: currentAssistantText,
                  segments: await parseAssistantSegments(activeThreadId, activeThread, currentAssistantText)
                }
              });
            } catch (error) {
              sendWs(ws, {
                type: "assistantMessage",
                threadId: activeThreadId,
                message: {
                  role: "assistant",
                  text: currentAssistantText,
                  segments: [
                    { type: "text", text: currentAssistantText },
                    {
                      type: "image-error",
                      path: "",
                      reason: error instanceof Error ? error.message : String(error)
                    }
                  ]
                }
              });
            }
          }
          currentAssistantText = "";
          sendWs(ws, { type: "turnCompleted", threadId: activeThreadId });
        })();
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
          activeThread = thread;
          sendWs(ws, {
            type: "threadLoaded",
            thread,
            messages: await threadToMessages(thread)
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
          activeThread = thread;
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
        const html = hasOperatorAccess(req, config)
          ? await readFile(operatorClientPath, "utf8")
          : renderOperatorLoginShell();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/operator/auth-state") {
        sendJson(res, 200, {
          mode: operatorMode(config),
          authenticated: hasOperatorAccess(req, config)
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/operator/login") {
        if (!requireSameOriginPost(req, res, config.publicBaseUrl)) {
          return;
        }
        if (!config.operatorSecret) {
          if (!isLocalRequest(req)) {
            sendJson(res, 401, { error: "operator_auth_required", mode: operatorMode(config) });
            return;
          }
          sendJson(res, 200, { ok: true, mode: operatorMode(config), authenticated: true });
          return;
        }

        const body = await readBody(req);
        const parsed = body ? (JSON.parse(body) as { secret?: string }) : {};
        if ((parsed.secret ?? "").trim() !== config.operatorSecret) {
          logger.record({
            ts: new Date().toISOString(),
            kind: "http",
            action: "operatorLogin",
            status: "error",
            maskedIp: maskIpAddress(getClientIp(req)),
            message: "invalid operator secret"
          });
          sendJson(res, 401, { error: "invalid_operator_secret", mode: operatorMode(config) });
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `codex_relay_operator=${operatorCookieValue(config.operatorSecret)}; ${operatorCookieAttributes(config.publicBaseUrl)}`
        });
        res.end(JSON.stringify({ ok: true, mode: operatorMode(config), authenticated: true }, null, 2));
        logger.record({
          ts: new Date().toISOString(),
          kind: "http",
          action: "operatorLogin",
          status: "ok",
          maskedIp: maskIpAddress(getClientIp(req))
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/operator/logout") {
        if (!requireSameOriginPost(req, res, config.publicBaseUrl)) {
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `codex_relay_operator=; Max-Age=0; ${operatorCookieAttributes(config.publicBaseUrl)}`
        });
        res.end(JSON.stringify({ ok: true }, null, 2));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pairing/start") {
        if (!requireSameOriginPost(req, res, config.publicBaseUrl)) {
          return;
        }
        if (!requireOperatorAccess(req, res, config)) {
          return;
        }
        const rate = pairingRateLimiter.take(getClientIp(req) || "unknown");
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

        const userAgent = String(req.headers["user-agent"] ?? "");
        const ipAddress = getClientIp(req);
        const os = inferOs(userAgent);
        const deviceLabel = inferDeviceLabel(userAgent, os);
        const session = sessions.create(pairing.pairingId, config.sessionTtlMs, {
          ipAddress,
          os,
          deviceLabel
        });
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
          status: "ok",
          maskedIp: maskIpAddress(ipAddress),
          os,
          message: deviceLabel
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
            { label: "Workspace Write", value: "workspaceWrite", payload: { type: "workspaceWrite" } },
            { label: "Danger Full Access", value: "dangerFullAccess", payload: { type: "dangerFullAccess" } },
            { label: "External Sandbox", value: "externalSandbox", payload: { type: "externalSandbox" } }
          ]
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/thread/image") {
        const session = getSession(req, config.sessionSecret, sessions);
        if (!session) {
          sendJson(res, 401, { error: "unauthenticated" });
          return;
        }

        const threadId = url.searchParams.get("threadId") ?? "";
        const referencedPath = url.searchParams.get("path") ?? "";
        if (!threadId || !validateThreadId(threadId)) {
          sendJson(res, 400, { error: "invalid threadId" });
          return;
        }
        if (!referencedPath.trim()) {
          sendJson(res, 400, { error: "path is required" });
          return;
        }

        await appServer.call("thread/resume", { threadId });
        const result = await appServer.call<{ thread?: Record<string, unknown> }>("thread/read", {
          threadId,
          includeTurns: false
        });
        const thread = await enrichThread(result?.thread ?? { id: threadId }, metadataStore);
        const resolved = resolveImagePath(thread, referencedPath);
        if (!resolved.ok) {
          sendJson(res, 403, { error: resolved.reason });
          return;
        }

        try {
          const fileStat = await stat(resolved.resolvedPath);
          if (!fileStat.isFile()) {
            sendJson(res, 404, { error: "image file does not exist" });
            return;
          }
        } catch {
          sendJson(res, 404, { error: "image file does not exist" });
          return;
        }

        const mimeType = imageMimeTypes[resolved.ext];
        if (!mimeType) {
          sendJson(res, 415, { error: "unsupported image type" });
          return;
        }

        const data = await readFile(resolved.resolvedPath);
        res.writeHead(200, {
          "content-type": mimeType,
          "cache-control": "private, max-age=60"
        });
        res.end(data);
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
        if (!requireOperatorAccess(req, res, config)) {
          return;
        }
        const events = sanitizeOperatorLogs(logger.list());
        const sessionSummaries = sanitizeOperatorSessions(sessions.list());
        const alerts = sanitizeOperatorAlerts(buildSessionAlerts(logger.list()));
        sendJson(res, 200, {
          sessions: sessionSummaries,
          events,
          alerts,
          relay: {
            baseUrl: config.publicBaseUrl,
            cookieMode: config.publicBaseUrl.startsWith("https://") ? "secure" : "non-secure"
          },
          summary: summarizeOperatorState({
            sessions: sessionSummaries,
            events,
            alerts,
            baseUrl: config.publicBaseUrl,
            cookieMode: config.publicBaseUrl.startsWith("https://") ? "secure" : "non-secure"
          })
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/operator/session") {
        if (!requireOperatorAccess(req, res, config)) {
          return;
        }
        const sessionId = url.searchParams.get("sessionId") ?? "";
        if (!sessionId) {
          sendJson(res, 400, { error: "sessionId is required" });
          return;
        }
        const session = sessions.get(sessionId);
        if (!session) {
          sendJson(res, 404, { error: "session not found" });
          return;
        }
        sendJson(res, 200, {
          session: toOperatorSessionDetail(session)
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/operator/pairings") {
        if (!requireOperatorAccess(req, res, config)) {
          return;
        }
        sendJson(res, 200, {
          pairings: pairings.listSummaries()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/operator/session/revoke") {
        if (!requireSameOriginPost(req, res, config.publicBaseUrl)) {
          return;
        }
        if (!requireOperatorAccess(req, res, config)) {
          return;
        }
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
        if (!requireSameOriginPost(req, res, config.publicBaseUrl)) {
          return;
        }
        if (!requireOperatorAccess(req, res, config)) {
          return;
        }
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
        sendJson(res, 200, { ...result, thread, messages: await threadToMessages(thread) });
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
        `  operator surface: protected`,
        `  pairing endpoint: POST ${config.publicBaseUrl}/api/pairing/start`,
        `  relay websocket: ws://${config.host}:${config.port}/ws`
      ].join("\n") + "\n"
    );
  });
}

void main();
