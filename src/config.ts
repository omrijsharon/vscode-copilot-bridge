import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { BridgeConfig } from "./types";

const SECTION = "copilotBridge";

export function loadConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const fromSetting = cfg.get<string>("authToken", "").trim();
  const fromEnv = (process.env.COPILOT_BRIDGE_TOKEN ?? "").trim();

  return {
    enabled: cfg.get<boolean>("enabled", true),
    port: cfg.get<number>("port", 8761),
    authToken: fromSetting || fromEnv,
    workspaceRole: cfg.get<string>("workspaceRole", "default")
  };
}

export async function rotateToken(): Promise<string> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const next = randomUUID();
  await cfg.update("authToken", next, vscode.ConfigurationTarget.Global);
  return next;
}
