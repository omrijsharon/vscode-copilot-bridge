import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const wsUrl = args[0];
const threadId = args[1];

if (!wsUrl) {
  console.error("Usage:");
  console.error("  node examples/app-server-thread-list.mjs <wsUrl>");
  console.error("  node examples/app-server-thread-list.mjs <wsUrl> <threadId>");
  process.exit(1);
}

const socket = new WebSocket(wsUrl);
const rpc = createRpcClient(socket);

await rpc.open();
await rpc.call("initialize", {
  clientInfo: {
    name: "thread-list",
    title: "Codex Thread List",
    version: "0.1.0"
  },
  capabilities: {
    experimentalApi: true
  }
});
rpc.notify("notifications/initialized", {});

if (threadId) {
  const result = await rpc.call("thread/read", {
    threadId,
    includeTurns: true
  });
  await saveResult("thread-read", result, threadId);
  console.log(JSON.stringify(result, null, 2));
} else {
  const result = await rpc.call("thread/list", {});
  await saveResult("thread-list", result);
  console.log(JSON.stringify(result, null, 2));
}

socket.close();

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

async function saveResult(kind, payload, threadId = "") {
  const diagnosticsDir = path.join(process.cwd(), "diagnostics");
  await mkdir(diagnosticsDir, { recursive: true });
  const suffix = threadId ? `-${threadId}` : "";
  const file = path.join(diagnosticsDir, `${kind}${suffix}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        kind,
        threadId,
        payload
      },
      null,
      2
    ),
    "utf8"
  );
  console.error(`saved ${file}`);
}
