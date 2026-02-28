import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const port = Number(process.env.COPILOT_BRIDGE_PORT ?? 8761);
const token = process.env.COPILOT_BRIDGE_TOKEN ?? "";
const sessionId = process.env.COPILOT_BRIDGE_SESSION ?? "cli:default";

let modelId = "";

if (!token) {
  console.error("COPILOT_BRIDGE_TOKEN is required");
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
console.log("Connected CLI client. Commands: /reset, /model <id>, /quit");

while (true) {
  const line = (await rl.question("> ")).trim();
  if (!line) {
    continue;
  }
  if (line === "/quit") {
    break;
  }
  if (line === "/reset") {
    await sendRequest({
      type: "reset",
      requestId: randomUUID(),
      sessionId
    });
    console.log("Session reset.");
    continue;
  }
  if (line.startsWith("/model ")) {
    modelId = line.slice("/model ".length).trim();
    console.log(`Model override set to: ${modelId || "(auto)"}`);
    continue;
  }
  await ask(line);
}

rl.close();

async function ask(prompt) {
  const requestId = randomUUID();
  let rendered = "";
  await sendRequest(
    {
      type: "ask",
      requestId,
      sessionId,
      prompt,
      modelId: modelId || undefined
    },
    (event) => {
      if (event.type === "delta") {
        rendered += event.chunk ?? "";
        output.write(event.chunk ?? "");
      }
      if (event.type === "done") {
        if (!rendered && event.text) {
          output.write(event.text);
        }
        output.write("\n");
      }
      if (event.type === "error") {
        output.write(`\nError ${event.code}: ${event.message}\n`);
      }
    }
  );
}

async function sendRequest(payload, onEvent) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge/v1`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  await onceOpen(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener("message", (ev) => {
      const event = JSON.parse(ev.data.toString());
      if (event.requestId !== payload.requestId) {
        return;
      }
      onEvent?.(event);
      if (event.type === "done" || event.type === "error" || event.type === "pong") {
        resolve(undefined);
      }
    });
    socket.addEventListener("error", (err) => reject(err));
    socket.send(JSON.stringify(payload));
  });
  socket.close();
}

function onceOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", (err) => reject(err));
  });
}
