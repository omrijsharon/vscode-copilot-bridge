import * as vscode from "vscode";
import { WebSocket } from "ws";
import { loadConfig, rotateToken } from "./config";
import { BridgeLogger } from "./logger";
import { BridgeServer } from "./server";
import { BridgeRequest, BridgeErrorEvent } from "./types";

let server: BridgeServer | undefined;
const logger = new BridgeLogger();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.enabled) {
    return;
  }

  server = new BridgeServer(cfg, async (socket, req) => {
    await routeRequest(socket, req);
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

async function routeRequest(socket: WebSocket, req: BridgeRequest): Promise<void> {
  const started = Date.now();
  if (req.type === "ping") {
    socket.send(JSON.stringify({ type: "pong", requestId: req.requestId, traceId: req.traceId }));
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
        text: JSON.stringify(server?.info() ?? {})
      })
    );
    return;
  }

  if (req.type === "models") {
    socket.send(
      JSON.stringify({
        type: "done",
        requestId: req.requestId,
        traceId: req.traceId,
        text: JSON.stringify([])
      })
    );
    return;
  }

  if (req.type === "reset") {
    socket.send(JSON.stringify({ type: "done", requestId: req.requestId, traceId: req.traceId, text: "ok" }));
    return;
  }

  if (req.type === "cancel") {
    sendError(socket, req.requestId, "E_CANCELLED", "Request cancelled", req.traceId);
    return;
  }

  if (req.type === "ask") {
    socket.send(
      JSON.stringify({
        type: "error",
        requestId: req.requestId,
        traceId: req.traceId,
        code: "E_MODEL_REQUEST_FAILED",
        message: "ask is not implemented yet"
      })
    );
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
