import { WebSocket } from "ws";
import { RpcRequest, RpcResponse } from "./types";

export class AppServerClient {
  private socket: WebSocket | null = null;
  private initialized = false;
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; method: string }>();
  private readonly notificationHandlers = new Set<(message: Record<string, unknown>) => void>();

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    await this.openSocket();
    await this.initialize();
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return await this.callWithRetry<T>(method, params, 0);
  }

  async disconnect(): Promise<void> {
    this.initialized = false;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("app-server socket closed"));
    }
    this.pending.clear();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  onNotification(handler: (message: Record<string, unknown>) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  private async openSocket(): Promise<void> {
    this.socket = new WebSocket(this.wsUrl);
    this.socket.on("message", (raw) => this.handleMessage(raw.toString()));
    this.socket.on("close", () => {
      this.initialized = false;
      this.socket = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("app-server socket closed"));
      }
      this.pending.clear();
    });

    await new Promise<void>((resolve, reject) => {
      this.socket!.once("open", () => resolve());
      this.socket!.once("error", (error) => reject(error));
    });
  }

  private async callWithRetry<T>(
    method: string,
    params: Record<string, unknown>,
    attempt: number
  ): Promise<T> {
    try {
      await this.connect();
      const id = ++this.nextId;
      const payload: RpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };

      this.socket!.send(JSON.stringify(payload));
      return await new Promise<T>((resolve, reject) => {
        this.pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
          method
        });
        setTimeout(() => {
          if (!this.pending.has(id)) {
            return;
          }
          this.pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }, 45000);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        message.includes("ECONNREFUSED") ||
        message.includes("socket closed") ||
        message.includes("timeout waiting") ||
        message.includes("Server overloaded");

      if (!retryable || attempt >= 1) {
        throw error;
      }

      await this.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return await this.callWithRetry<T>(method, params, attempt + 1);
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.call("initialize", {
      clientInfo: {
        name: "codex-remote-relay",
        title: "Codex Remote Relay",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });

    this.socket!.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      })
    );

    this.initialized = true;
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw) as RpcResponse & Record<string, unknown>;
    if (typeof msg.id === "undefined") {
      for (const handler of this.notificationHandlers) {
        handler(msg);
      }
      return;
    }

    const pending = this.pending.get(msg.id);
    if (!pending) {
      return;
    }
    this.pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      return;
    }
    pending.resolve(msg.result);
  }
}
