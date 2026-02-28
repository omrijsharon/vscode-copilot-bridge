export type BridgeRequestType = "ask" | "reset" | "cancel" | "info" | "models" | "ping";

export interface BridgeRequest {
  type: BridgeRequestType;
  requestId: string;
  sessionId?: string;
  prompt?: string;
  modelId?: string;
  timeoutMs?: number;
  meta?: Record<string, unknown>;
  traceId?: string;
  fromAgent?: string;
  toRole?: string;
  hops?: number;
  maxHops?: number;
  originBridgeId?: string;
}

export interface AuthMessage {
  type: "auth";
  token: string;
}

export type BridgeEventType = "ack" | "delta" | "done" | "error" | "pong";

export interface BridgeEventBase {
  type: BridgeEventType;
  requestId: string;
  traceId?: string;
}

export interface BridgeErrorEvent extends BridgeEventBase {
  type: "error";
  code:
    | "E_BAD_REQUEST"
    | "E_UNAUTHORIZED"
    | "E_RATE_LIMIT"
    | "E_NO_MODEL"
    | "E_MODEL_REQUEST_FAILED"
    | "E_TIMEOUT"
    | "E_CANCELLED"
    | "E_INTERNAL";
  message: string;
}

export interface BridgeConfig {
  enabled: boolean;
  port: number;
  authToken: string;
  workspaceRole: string;
}
