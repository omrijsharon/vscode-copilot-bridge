import { BridgeRequest } from "./types";

export function parseRequest(raw: unknown): BridgeRequest | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  try {
    const obj = JSON.parse(raw) as Partial<BridgeRequest>;
    if (!obj || typeof obj !== "object") {
      return undefined;
    }
    if (typeof obj.type !== "string" || typeof obj.requestId !== "string") {
      return undefined;
    }
    return obj as BridgeRequest;
  } catch {
    return undefined;
  }
}
