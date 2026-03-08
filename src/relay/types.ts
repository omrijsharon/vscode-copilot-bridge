export interface RelayConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  appServerUrl: string;
  sessionSecret: string;
  pairingTtlMs: number;
  sessionTtlMs: number;
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
  ipAddress?: string;
  userAgent?: string;
  os?: string;
  country?: string;
  city?: string;
  asn?: string;
  isp?: string;
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

export interface RelayMessageSegment {
  type: "text" | "image" | "image-error";
  text?: string;
  path?: string;
  url?: string;
  reason?: string;
}

export interface RelayChatMessage {
  role: "user" | "assistant";
  text: string;
  phase?: string;
  segments?: RelayMessageSegment[];
}

export interface RelayServerEvent {
  type:
    | "session"
    | "threads"
    | "threadLoaded"
    | "assistantMessage"
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
  ipAddress?: string;
  userAgent?: string;
  os?: string;
  country?: string;
  city?: string;
  asn?: string;
  isp?: string;
  message?: string;
}
