# Installation Guide

## 1) Prerequisites

- VS Code desktop (`>= 1.110.0`)
- GitHub Copilot access in VS Code
- Node.js (for external client examples)

## 2) Install the Extension (VSIX)

1. Build/package:
   - `npm install`
   - `npm run build`
   - `node .\\node_modules\\@vscode\\vsce\\vsce package`
2. In VS Code:
   - Open Extensions view
   - `...` menu -> `Install from VSIX...`
   - Select `vscode-copilot-bridge-0.1.0.vsix`

## 3) Configure the Bridge

Open VS Code settings and set:

- `copilotBridge.enabled`: `true`
- `copilotBridge.port`: `8761` (or any free localhost port)
- `copilotBridge.authToken`: a strong secret token
- `copilotBridge.workspaceRole`: `frontend` / `backend` / custom role

You can also rotate the token from command palette:
- `Copilot Bridge: Rotate Token`

## 4) Verify Bridge Health

Connect to:
- `ws://127.0.0.1:<port>/bridge/v1`

Authenticate:
- header: `Authorization: Bearer <token>`
- or first message: `{ "type": "auth", "token": "<token>" }`

Send:
```json
{ "type": "ping", "requestId": "ping-1", "sessionId": "health:1" }
```

Expect:
```json
{ "type": "pong", "requestId": "ping-1", "status": "ok", "uptimeMs": 1234 }
```

## 5) First Ask Request

```json
{
  "type": "ask",
  "requestId": "req-1",
  "sessionId": "cli:demo",
  "prompt": "Say hello in one sentence"
}
```

Server emits:
- `ack`
- one or more `delta`
- terminal `done` (or `error`)

## 6) Troubleshooting

- `E_NO_MODEL`: sign in to Copilot and verify model availability.
- `E_UNAUTHORIZED`: token mismatch.
- `E_RATE_LIMIT`: reduce request frequency.
- `E_TIMEOUT`: increase `timeoutMs` (max `300000`).
