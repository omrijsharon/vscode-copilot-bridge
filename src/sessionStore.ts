import * as vscode from "vscode";

type ChatMessage = vscode.LanguageModelChatMessage;

const MAX_TURNS = 20;
const MAX_CHARS = 200_000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

interface SessionData {
  history: ChatMessage[];
  charCount: number;
  updatedAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionData>();

  getHistory(sessionId: string): ChatMessage[] {
    this.gc();
    const existing = this.sessions.get(sessionId);
    return existing ? [...existing.history] : [];
  }

  appendTurn(sessionId: string, prompt: string, answer: string): void {
    this.gc();
    const existing = this.sessions.get(sessionId);
    const history = existing ? [...existing.history] : [];
    history.push(vscode.LanguageModelChatMessage.User(prompt));
    history.push(vscode.LanguageModelChatMessage.Assistant(answer));

    const capped = history.slice(-MAX_TURNS * 2);
    let charCount = sumMessageChars(capped);
    while (capped.length > 2 && charCount > MAX_CHARS) {
      capped.splice(0, 2);
      charCount = sumMessageChars(capped);
    }

    this.sessions.set(sessionId, {
      history: capped,
      charCount,
      updatedAt: Date.now()
    });
  }

  reset(sessionId?: string): number {
    if (sessionId) {
      return this.sessions.delete(sessionId) ? 1 : 0;
    }
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, value] of this.sessions.entries()) {
      if (now - value.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(key);
      }
    }
  }
}

function sumMessageChars(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = msg.content as unknown;
    if (typeof content === "string") {
      total += content.length;
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!part || typeof part !== "object" || !("value" in part)) {
        continue;
      }
      const value = (part as { value?: unknown }).value;
      if (typeof value === "string") {
        total += value.length;
      }
    }
  }
  return total;
}
