export interface RelayConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  appServerUrl: string;
  sessionSecret: string;
  pairingTtlMs: number;
  promptMaxChars: number;
  sessionRequestsPerMinute: number;
  pairingRequestsPerHour: number;
}

export interface PairingRecord {
  pairingId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

export interface RelaySession {
  sessionId: string;
  pairingId: string;
  createdAt: number;
  expiresAt: number;
}

export interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export interface RelayClientMessage {
  type: "loadThread" | "sendPrompt" | "startThread" | "refreshThreads";
  threadId?: string;
  prompt?: string;
  cwd?: string;
  model?: string;
  title?: string;
  approvalPolicy?: string;
  sandboxPolicy?: Record<string, unknown>;
}

export interface RelayServerEvent {
  type:
    | "session"
    | "threads"
    | "threadLoaded"
    | "assistantDelta"
    | "turnStarted"
    | "turnCompleted"
    | "error";
  [key: string]: unknown;
}

export interface RelayLogEntry {
  ts: string;
  kind: "http" | "ws";
  action: string;
  sessionId?: string;
  threadId?: string;
  status: "ok" | "error";
  message?: string;
}
