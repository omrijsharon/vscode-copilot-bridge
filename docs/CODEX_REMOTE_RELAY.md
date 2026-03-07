# Codex Remote Relay

## Purpose

This repo now contains a second product direction beyond the legacy VS Code bridge:

- local `codex app-server`
- local authenticated relay
- remote web client

The relay exists so a phone or remote browser can continue the same Codex thread that lives on the home machine.

## Current Architecture

```text
phone browser
  -> authenticated relay (HTTP + WebSocket)
  -> local codex app-server on 127.0.0.1
  -> Codex thread storage/history
```

Key rule:
- the Codex `threadId` is the source of truth
- the relay is only a controlled access layer

## Sync Model

There are two different concepts:

1. Backend thread sync
- Remote messages sent through relay -> `turn/start`
- Codex writes those turns into the real thread history
- Later reopening the same `threadId` should show that history

2. Local VS Code live refresh
- The Codex UI in VS Code may not update live when an external client writes to the same thread
- That is a UI refresh limitation, not a backend thread sync failure

Practical interpretation:
- if the remote client reloads and still sees the new turn, backend sync worked
- if local Codex later shows the same turn after reopen/reload, the persistence path worked

## Current Remote Client Behavior

Remote client:
- served from `relay-client/index.html`
- authenticates through the relay session cookie
- lists threads through relay
- loads transcript from `thread/read`
- streams replies through relay WebSocket
- remembers the last selected thread in browser `localStorage`, scoped by authenticated relay session id

That remembered thread behavior is only a convenience feature.
It does not replace Codex thread persistence.

## Safe Deployment Model

Recommended:
- keep `codex app-server` bound to `127.0.0.1`
- expose only the relay
- put the relay behind HTTPS/WSS if accessed off-machine
- keep pairing tokens short-lived
- keep remote sessions revocable

Do not:
- expose raw app-server publicly
- write directly to Codex JSONL files
- treat remote UI state as the source of truth

Minimum safe deployment checklist:
- app-server localhost only
- relay has session secret set explicitly
- relay served over HTTPS when used remotely
- pairing TTL kept short
- operator can revoke sessions
- rate limiting enabled

## Current Limitations

- QR rendering currently uses an external image service
- automatic remote-conversation-to-thread mapping is not implemented
- operator session revocation is basic
- phone-specific UX is functional but not fully polished
- full manual verification from actual phone/network environment still needs to be recorded

## Recommended Next Product Steps

1. Replace external QR rendering with local QR generation
2. Add explicit remote session revocation controls in operator UI
3. Add full verification matrix and record actual phone results
4. Decide whether to keep the legacy bridge code in this repo or archive it
