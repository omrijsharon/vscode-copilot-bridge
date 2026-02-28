import { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { WebSocket, WebSocketServer } from "ws";
import { BridgeConfig, BridgeErrorEvent, BridgeRequest } from "./types";
import { parseRequest } from "./protocol";

export interface BridgeRuntimeInfo {
  bridgeId: string;
  windowId: string;
  workspaceRoot: string;
  workspaceRole: string;
  port: number;
  capabilities: string[];
}

export interface RequestHandler {
  (socket: WebSocket, req: BridgeRequest): Promise<void>;
}

export class BridgeServer implements vscode.Disposable {
  private readonly bridgeId = randomUUID();
  private readonly windowId = randomUUID();
  private httpServer = createServer();
  private wsServer: WebSocketServer | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly cfg: BridgeConfig,
    private readonly handleRequest: RequestHandler
  ) {}

  info(): BridgeRuntimeInfo {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const address = this.httpServer.address() as AddressInfo | null;
    return {
      bridgeId: this.bridgeId,
      windowId: this.windowId,
      workspaceRoot: root,
      workspaceRole: this.cfg.workspaceRole,
      port: address?.port ?? this.cfg.port,
      capabilities: ["streaming", "resetSession", "modelSelection", "traceHops", "dedupe"]
    };
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.listen(this.cfg.port, "127.0.0.1", () => resolve());
      this.httpServer.once("error", (err) => reject(err));
    });

    this.wsServer = new WebSocketServer({
      server: this.httpServer,
      path: "/bridge/v1"
    });

    this.wsServer.on("connection", (socket, req) => {
      const authHeader = req.headers.authorization ?? "";
      const token = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice("bearer ".length).trim()
        : "";
      if (!this.cfg.authToken || token !== this.cfg.authToken) {
        socket.send(JSON.stringify(buildError("unknown", "E_UNAUTHORIZED", "Invalid bearer token")));
        socket.close(1008, "Unauthorized");
        return;
      }

      socket.on("message", async (raw) => {
        const parsed = parseRequest(raw.toString());
        if (!parsed) {
          socket.send(JSON.stringify(buildError("unknown", "E_BAD_REQUEST", "Malformed request envelope")));
          return;
        }
        try {
          await this.handleRequest(socket, parsed);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Internal error";
          socket.send(JSON.stringify(buildError(parsed.requestId, "E_INTERNAL", message, parsed.traceId)));
        }
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wsServer?.close(() => resolve());
      if (!this.wsServer) {
        resolve();
      }
    });

    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    void this.stop();
  }
}

function buildError(
  requestId: string,
  code: BridgeErrorEvent["code"],
  message: string,
  traceId?: string
): BridgeErrorEvent {
  return { type: "error", requestId, code, message, traceId };
}
