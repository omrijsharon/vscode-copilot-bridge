# Codex Remote Relay

Authenticated local relay and remote web client for `codex app-server`.

## Purpose

This project lets you continue real Codex threads from another device while keeping the local Codex app-server and thread history on the home machine as the source of truth.

The product direction is:
- local `codex app-server`
- local authenticated relay
- remote web client
- optional phone/browser access through pairing and QR flow

## Main Components

- relay server: `src/relay/server.ts`
- relay client: `relay-client/index.html`
- operator page: `relay-client/operator.html`
- direct app-server reference page: `examples/codex-app-server-chat.html`
- app-server helper scripts:
  - `examples/app-server-thread-list.mjs`
  - `examples/app-server-thread-probe.mjs`

## Commands

- build:
  - `npm.cmd run build`
- start relay:
  - `npm.cmd run start:relay`
  - or `npm.cmd run start`
- launcher script:
  - `.\scripts\start-codex-relay.ps1`
  - `.\scripts\start-codex-remote-stack.ps1`

## Relay Runtime Config

- `CODEX_RELAY_HOST` default: `127.0.0.1`
- `CODEX_RELAY_PORT` default: `8787`
- `CODEX_RELAY_BASE_URL` default: `http://127.0.0.1:8787`
- `CODEX_APP_SERVER_URL` default: `ws://127.0.0.1:4500`
- `CODEX_RELAY_SESSION_SECRET` default: generated at startup if unset
- `CODEX_RELAY_PAIRING_TTL_MS` default: `300000`
- `CODEX_RELAY_PROMPT_MAX_CHARS` default: `10000`
- `CODEX_RELAY_SESSION_REQ_PER_MIN` default: `30`
- `CODEX_RELAY_PAIRING_REQ_PER_HOUR` default: `20`

## Local URLs

- remote client:
  - `http://127.0.0.1:8787/`
- operator page:
  - `http://127.0.0.1:8787/operator`

Note:
- current testing also used `8788` because `8787` was temporarily blocked by stale TCP teardown.

## Documentation

- relay architecture and deployment notes:
  - [docs/CODEX_REMOTE_RELAY.md](docs/CODEX_REMOTE_RELAY.md)
- remote access setup:
  - [docs/REMOTE_ACCESS_SETUP.md](docs/REMOTE_ACCESS_SETUP.md)
- relay verification matrix:
  - [docs/REMOTE_RELAY_VERIFICATION.md](docs/REMOTE_RELAY_VERIFICATION.md)
- implementation plan:
  - [codex-app-server_plan.md](codex-app-server_plan.md)

## Current Status

Proven:
- pairing flow works
- relay auth/session flow works
- relay WebSocket works
- thread list/load works
- remote send and streamed reply works
- remote reload persistence works
- local QR generation works
- operator and client session revoke controls exist
- phone-first threads/chat UI exists
- new-thread form exists for `cwd`, model, title, approval, and sandbox
- chat screen can show and change the model for future turns

Not yet product-finished:
- full phone-over-network verification should still be recorded in the verification matrix
- final verification recording and release-readiness documentation are still pending

## One-Click Remote Start

For the Cloudflare Tunnel path, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-codex-remote-stack.ps1 `
  -PublicBaseUrl "https://codex.flying-agents.com" `
  -SessionSecret "PUT_A_LONG_RANDOM_SECRET_HERE"
```

This starts:
- local Codex app-server
- local relay
- named Cloudflare tunnel `codex-remote-relay`

Behavior:
- reuses healthy existing app-server / relay / tunnel processes when possible
- stops conflicting listeners if needed
- `-ForceRestart` forces a full restart of the stack
