import * as vscode from "vscode";
import { SessionStore } from "./sessionStore";

export interface AskInput {
  sessionId: string;
  prompt: string;
  modelId?: string;
}

export interface AskResult {
  text: string;
  modelId: string;
}

export class BridgeService {
  constructor(private readonly sessions: SessionStore) {}

  async listModels(): Promise<ReadonlyArray<{ id: string; vendor: string; family: string }>> {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    return models.map((m) => ({
      id: m.id,
      vendor: m.vendor,
      family: m.family
    }));
  }

  async ask(input: AskInput, onDelta: (chunk: string) => void): Promise<AskResult> {
    const model = await this.pickModel(input.modelId);
    const history = this.sessions.getHistory(input.sessionId);
    const requestMessages: vscode.LanguageModelChatMessage[] = [
      ...history,
      vscode.LanguageModelChatMessage.User(input.prompt)
    ];

    const response = await model.sendRequest(requestMessages, {});
    let text = "";
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text += part.value;
        onDelta(part.value);
      }
    }

    this.sessions.appendTurn(input.sessionId, input.prompt, text);
    return { text, modelId: model.id };
  }

  reset(sessionId?: string): number {
    return this.sessions.reset(sessionId);
  }

  private async pickModel(modelId?: string): Promise<vscode.LanguageModelChat> {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (!models.length) {
      throw new Error("E_NO_MODEL");
    }
    if (!modelId) {
      return models[0];
    }
    const found = models.find((m) => m.id === modelId);
    if (!found) {
      throw new Error("E_NO_MODEL");
    }
    return found;
  }
}
