import { createHash } from "node:crypto";
import * as vscode from "vscode";

export interface LogEntry {
  ts: string;
  requestId: string;
  sessionHash: string;
  status: "ok" | "error";
  durationMs: number;
  modelId?: string;
  errorCode?: string;
}

export class BridgeLogger {
  private readonly entries: LogEntry[] = [];
  private readonly maxEntries = 500;

  record(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  async exportToFile(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      saveLabel: "Export Copilot Bridge Logs",
      filters: { JSON: ["json"] },
      defaultUri: vscode.Uri.file("copilot-bridge-logs.json")
    });
    if (!uri) {
      return;
    }
    const body = JSON.stringify(this.entries, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(body, "utf8"));
  }

  static hashSessionId(sessionId: string | undefined): string {
    return createHash("sha256").update(sessionId ?? "", "utf8").digest("hex").slice(0, 16);
  }
}
