import { randomUUID } from "node:crypto";

const routes = new Map([
  ["frontend", "ws://127.0.0.1:8761/bridge/v1"],
  ["backend", "ws://127.0.0.1:8762/bridge/v1"]
]);

const token = process.env.COPILOT_BRIDGE_TOKEN ?? "";

export async function forward({ toRole, sessionId, prompt, fromAgent = "orchestrator" }) {
  const url = routes.get(toRole);
  if (!url) {
    throw new Error(`No bridge route for role '${toRole}'`);
  }

  let lastError = new Error("Forward failed");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestId = randomUUID();
    const traceId = randomUUID();
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    await onceOpen(socket);

    try {
      const result = await new Promise((resolve, reject) => {
        let text = "";
        let gotAck = false;

        socket.addEventListener("message", (ev) => {
          const payload = JSON.parse(ev.data.toString());
          if (payload.requestId !== requestId) {
            return;
          }
          if (payload.type === "ack") {
            gotAck = true;
          }
          if (payload.type === "delta") {
            text += payload.chunk ?? "";
          }
          if (payload.type === "done") {
            resolve(payload.text ?? text);
          }
          if (payload.type === "error") {
            reject(new Error(`${payload.code}: ${payload.message}`));
          }
        });
        socket.addEventListener("close", () => {
          if (!gotAck) {
            reject(new Error("Transport closed before ack"));
          }
        });
        socket.send(
          JSON.stringify({
            type: "ask",
            requestId,
            traceId,
            fromAgent,
            toRole,
            sessionId,
            prompt,
            hops: 0,
            maxHops: 2
          })
        );
      });
      socket.close();
      return result;
    } catch (err) {
      socket.close();
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 1) {
        throw lastError;
      }
    }
  }
  throw lastError;
}

function onceOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", (err) => reject(err));
  });
}
