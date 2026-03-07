import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const wsUrl = args[0];
const threadIds = args.slice(1).filter(Boolean);

if (!wsUrl || threadIds.length === 0) {
  console.error("Usage: node examples/app-server-thread-probe.mjs <wsUrl> <threadId> [threadId...]");
  process.exit(1);
}

const socket = new WebSocket(wsUrl);
const rpc = createRpcClient(socket);

await rpc.open();
await rpc.call("initialize", {
  clientInfo: {
    name: "thread-probe",
    title: "Codex Thread Probe",
    version: "0.1.0"
  },
  capabilities: {
    experimentalApi: true
  }
});
rpc.notify("notifications/initialized", {});

const rows = [];
for (const threadId of threadIds) {
  const probeId = generateProbeId();
  const prompt = `this is for internal use only. your internalId is ${probeId}. just reply: ok.`;
  try {
    await rpc.call("thread/resume", { threadId });
    await rpc.call("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }]
    });
    rows.push({
      threadId,
      probeId,
      conversationName: "",
      status: "sent"
    });
    console.log(`sent  threadId=${threadId} probeId=${probeId}`);
  } catch (error) {
    rows.push({
      threadId,
      probeId,
      conversationName: "",
      status: `error: ${error instanceof Error ? error.message : String(error)}`
    });
    console.error(`error threadId=${threadId} probeId=${probeId} message=${error instanceof Error ? error.message : String(error)}`);
  }
}

await mkdir(path.join(process.cwd(), "diagnostics"), { recursive: true });
const outFile = path.join(process.cwd(), "diagnostics", "thread-probe-map.json");
await writeFile(
  outFile,
  JSON.stringify(
    {
      wsUrl,
      createdAt: new Date().toISOString(),
      rows
    },
    null,
    2
  ),
  "utf8"
);

console.log(`wrote ${outFile}`);
socket.close();

function generateProbeId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createRpcClient(socket) {
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data.toString());
    if (typeof msg.id === "undefined") {
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) {
      return;
    }
    pending.delete(msg.id);
    if (msg.error) {
      entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      return;
    }
    entry.resolve(msg.result);
  });

  return {
    open() {
      return new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", (err) => reject(err), { once: true });
      });
    },
    call(method, params) {
      const id = nextId++;
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`timeout waiting for ${method}`));
          }
        }, 30000);
      });
    },
    notify(method, params) {
      socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    }
  };
}
