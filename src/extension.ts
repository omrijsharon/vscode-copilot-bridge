import * as vscode from "vscode";
import { WebSocket } from "ws";
import { loadConfig, rotateToken } from "./config";
import { BridgeLogger } from "./logger";
import { BridgeServer } from "./server";
import { BridgeRequest, BridgeErrorEvent } from "./types";
import { BridgeService } from "./bridgeService";
import { SessionStore } from "./sessionStore";
import { DedupeCache } from "./dedupeCache";
import { RateLimiter } from "./rateLimiter";

let server: BridgeServer | undefined;
const logger = new BridgeLogger();
const sessions = new SessionStore();
const bridge = new BridgeService(sessions);
const dedupe = new DedupeCache(2 * 60 * 1000);
const limiter = new RateLimiter(120, 20);
const inFlight = new Map<string, vscode.CancellationTokenSource>();
const startTime = Date.now();
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_PROMPT_CHARS = 50_000;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.enabled) {
    return;
  }

  server = new BridgeServer(cfg, async (socket, req, clientId) => {
    await routeRequest(socket, req, clientId);
  });
  await server.start();

  context.subscriptions.push(server);
  context.subscriptions.push(
    vscode.commands.registerCommand("copilotBridge.rotateToken", async () => {
      const token = await rotateToken();
      void vscode.window.showInformationMessage(`Copilot Bridge token rotated. New token: ${token}`);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("copilotBridge.exportLogs", async () => {
      await logger.exportToFile();
      void vscode.window.showInformationMessage("Copilot Bridge logs exported.");
    })
  );

  const info = server.info();
  void vscode.window.showInformationMessage(
    `Copilot Bridge listening on ws://127.0.0.1:${info.port}/bridge/v1`
  );
}

export function deactivate(): Thenable<void> | undefined {
  return server?.stop();
}

async function routeRequest(socket: WebSocket, req: BridgeRequest, clientId = "local"): Promise<void> {
  const info = server?.info();
  if (!info) {
    sendError(socket, req.requestId, "E_INTERNAL", "Bridge not initialized", req.traceId);
    return;
  }

  if (req.toRole && req.toRole !== info.workspaceRole) {
    sendError(
      socket,
      req.requestId,
      "E_BAD_REQUEST",
      `Request routed to role '${req.toRole}', but this bridge serves '${info.workspaceRole}'`,
      req.traceId
    );
    return;
  }

  const hops = req.hops ?? 0;
  const maxHops = req.maxHops ?? 2;
  if (hops > maxHops) {
    sendError(socket, req.requestId, "E_BAD_REQUEST", "Hop count exceeded maxHops", req.traceId);
    return;
  }

  if (req.originBridgeId && req.originBridgeId === info.bridgeId && hops > 0) {
    sendError(socket, req.requestId, "E_BAD_REQUEST", "Immediate bounce-back is blocked", req.traceId);
    return;
  }

  if (req.traceId && req.fromAgent) {
    const key = `${req.fromAgent}:${req.traceId}`;
    if (dedupe.has(key)) {
      sendError(socket, req.requestId, "E_BAD_REQUEST", "Duplicate traceId", req.traceId);
      return;
    }
    dedupe.add(key);
  }

  const started = Date.now();
  if (req.type === "ping") {
    socket.send(
      JSON.stringify({
        type: "pong",
        requestId: req.requestId,
        traceId: req.traceId,
        status: "ok",
        uptimeMs: Date.now() - startTime
      })
    );
    logger.record({
      ts: new Date().toISOString(),
      requestId: req.requestId,
      sessionHash: BridgeLogger.hashSessionId(req.sessionId),
      status: "ok",
      durationMs: Date.now() - started
    });
    return;
  }

  if (req.type === "info") {
    socket.send(
      JSON.stringify({
        type: "done",
        requestId: req.requestId,
        traceId: req.traceId,
        text: JSON.stringify(info)
      })
    );
    return;
  }

  if (req.type === "models") {
    const models = await bridge.listModels();
    socket.send(
      JSON.stringify({
        type: "done",
        requestId: req.requestId,
        traceId: req.traceId,
        text: JSON.stringify(models)
      })
    );
    return;
  }

  if (req.type === "reset") {
    const count = bridge.reset(req.sessionId);
    socket.send(
      JSON.stringify({
        type: "done",
        requestId: req.requestId,
        traceId: req.traceId,
        text: JSON.stringify({ cleared: count })
      })
    );
    return;
  }

  if (req.type === "cancel") {
    const running = inFlight.get(req.requestId);
    if (running) {
      running.cancel();
    }
    sendError(socket, req.requestId, "E_CANCELLED", "Request cancelled", req.traceId);
    return;
  }

  if (req.type === "ask") {
    if (!req.sessionId || !req.prompt) {
      sendError(socket, req.requestId, "E_BAD_REQUEST", "ask requires sessionId and prompt", req.traceId);
      return;
    }
    if (req.prompt.length > MAX_PROMPT_CHARS) {
      sendError(socket, req.requestId, "E_BAD_REQUEST", `prompt exceeds ${MAX_PROMPT_CHARS} chars`, req.traceId);
      return;
    }
    if (!limiter.allow(`${clientId}:${req.sessionId}`)) {
      sendError(socket, req.requestId, "E_RATE_LIMIT", "Rate limit exceeded", req.traceId);
      return;
    }

    const timeoutMs = clampTimeout(req.timeoutMs);
    const cts = new vscode.CancellationTokenSource();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      cts.cancel();
    }, timeoutMs);
    inFlight.set(req.requestId, cts);

    socket.send(JSON.stringify({ type: "ack", requestId: req.requestId, traceId: req.traceId }));

    try {
      const result = await bridge.ask(
        { sessionId: req.sessionId, prompt: req.prompt, modelId: req.modelId, token: cts.token },
        (chunk) => {
          socket.send(JSON.stringify({ type: "delta", requestId: req.requestId, traceId: req.traceId, chunk }));
        }
      );

      socket.send(
        JSON.stringify({
          type: "done",
          requestId: req.requestId,
          traceId: req.traceId,
          text: result.text,
          modelId: result.modelId
        })
      );
      logger.record({
        ts: new Date().toISOString(),
        requestId: req.requestId,
        sessionHash: BridgeLogger.hashSessionId(req.sessionId),
        status: "ok",
        durationMs: Date.now() - started,
        modelId: result.modelId
      });
    } catch (err) {
      const cancelled = cts.token.isCancellationRequested;
      const msg = err instanceof Error ? err.message : "";
      if (msg === "E_NO_MODEL") {
        sendError(
          socket,
          req.requestId,
          "E_NO_MODEL",
          "No Copilot model available. Sign in to Copilot and ensure model access.",
          req.traceId
        );
      } else if (cancelled && timedOut) {
        sendError(socket, req.requestId, "E_TIMEOUT", `Request timed out after ${timeoutMs}ms`, req.traceId);
      } else if (cancelled) {
        sendError(socket, req.requestId, "E_CANCELLED", "Request cancelled", req.traceId);
      } else {
        sendError(
          socket,
          req.requestId,
          "E_MODEL_REQUEST_FAILED",
          err instanceof Error ? err.message : "Model request failed",
          req.traceId
        );
      }
      logger.record({
        ts: new Date().toISOString(),
        requestId: req.requestId,
        sessionHash: BridgeLogger.hashSessionId(req.sessionId),
        status: "error",
        durationMs: Date.now() - started,
        errorCode: msg === "E_NO_MODEL" ? "E_NO_MODEL" : cancelled && timedOut ? "E_TIMEOUT" : cancelled ? "E_CANCELLED" : "E_MODEL_REQUEST_FAILED"
      });
    } finally {
      clearTimeout(timer);
      inFlight.delete(req.requestId);
      cts.dispose();
    }
  }
}

function sendError(
  socket: WebSocket,
  requestId: string,
  code: BridgeErrorEvent["code"],
  message: string,
  traceId?: string
): void {
  socket.send(JSON.stringify({ type: "error", requestId, code, message, traceId }));
}

function clampTimeout(timeoutMs?: number): number {
  if (!timeoutMs || Number.isNaN(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (timeoutMs < 1) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, MAX_TIMEOUT_MS);
}
