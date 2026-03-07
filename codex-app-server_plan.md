# Codex App-Server Remote Access Plan

## Goal

Build a secure local desktop-side relay service and remote web client that let a user continue Codex conversations from another device, while keeping the Codex app-server and thread history on the home computer as the source of truth.

The system should allow:
- local Codex threads to be listed and resumed remotely
- new user messages to be sent remotely into the same Codex `threadId`
- streamed Codex replies to be shown remotely
- eventual sync when the user later returns to the local machine and reopens the same thread in the local Codex client

The system should not depend on:
- the old Copilot bridge protocol
- `vscode.lm`
- direct JSONL file writes
- exposing raw Codex app-server directly to the internet

## Implementation Intent

### Flow

1. The laptop starts `codex app-server` locally on `127.0.0.1`.
2. A local relay service starts on the laptop.
3. The relay serves:
   - a pairing page
   - a QR code for phone pairing
   - a remote chat web client
   - authenticated HTTP/WebSocket endpoints
4. The phone scans the QR code and opens a short-lived pairing URL.
5. The relay validates the one-time pairing token and creates a remote session.
6. The remote web client connects to the relay, not directly to app-server.
7. The relay forwards allowed JSON-RPC operations to local Codex app-server:
   - `initialize`
   - `thread/list`
   - `thread/read`
   - `thread/resume`
   - `thread/start`
   - `turn/start`
8. The relay streams Codex events back to the phone client.
9. The relay maintains the mapping between remote client session context and Codex `threadId` where needed.

### Architecture

#### 1. Codex app-server

- Runs locally only.
- Bound to `127.0.0.1`.
- Remains the source of truth for thread state and conversation history.

#### 2. Local relay service

- Runs on the laptop as a local desktop-side service/app.
- Connects to local Codex app-server as a JSON-RPC client.
- Exposes authenticated browser-friendly endpoints.
- Owns:
  - pairing tokens
  - session cookies or bearer sessions
  - QR bootstrap flow
  - remote-to-thread mapping logic where needed
  - rate limiting and access control

#### 3. Remote web client

- Runs in the phone browser.
- Connects only to the relay over HTTPS/WSS.
- Lists available threads.
- Loads history from the relay.
- Sends new messages through the relay.
- Renders streamed assistant output.

### Design Principles

- Codex `threadId` is the identity of the conversation.
- The relay is an authenticated proxy, not a second chat backend.
- Remote UI state is disposable and can be reconstructed from thread history.
- Pairing uses short-lived one-time tokens, not long-term raw secrets in the QR code.
- Codex app-server stays local and non-public.
- Remote access should be revocable and rate-limited.

## Proposed Project Shape

### Main Components

1. `codex app-server`
2. relay service
3. pairing/QR flow
4. remote web client
5. local launch/ops scripts

### Likely Runtime Shape

- Node.js local relay service
- static HTML/CSS/JS remote client
- WebSocket connection from relay to app-server
- HTTPS/WSS between phone and relay

## Milestones

### Milestone 1: Project Foundation

- [x] Decide the exact project layout for relay, client, and shared protocol docs. Finished at: `2026-03-07 13:12`
- [x] Create the new relay-side folders/files without deleting legacy bridge assets yet. Finished at: `2026-03-07 13:12`
- [x] Add a root README section describing the new project direction and what is now considered legacy/reference code. Finished at: `2026-03-07 13:12`
- [x] Define local development commands for running app-server, relay, and remote client. Finished at: `2026-03-07 13:12`
- [x] Add environment/config handling for relay port, app-server URL, session secret, and pairing TTL. Finished at: `2026-03-07 13:12`

### Milestone 2: Relay Core

- [x] Implement relay startup and health endpoints. Finished at: `2026-03-07 13:19`
- [x] Implement a persistent WebSocket/JSON-RPC client from relay to local Codex app-server. Finished at: `2026-03-07 13:19`
- [x] Implement relay wrappers for `initialize` and `notifications/initialized`. Finished at: `2026-03-07 13:19`
- [x] Implement relay wrappers for `thread/list`, `thread/read`, `thread/resume`, `thread/start`, and `turn/start`. Finished at: `2026-03-07 13:19`
- [x] Implement streaming event forwarding from app-server to remote client sessions. Finished at: `2026-03-07 13:19`
- [x] Add relay-side timeout, reconnect, and overload retry handling. Finished at: `2026-03-07 13:47`

### Milestone 3: Pairing and Authentication

- [x] Design the pairing token format and storage model. Finished at: `2026-03-07 13:38`
- [x] Implement one-time pairing session creation with expiry. Finished at: `2026-03-07 13:19`
- [x] Implement QR-code generation for the pairing URL. Finished at: `2026-03-07 13:38`
- [x] Implement pairing confirmation endpoint/page that upgrades the phone into an authenticated session. Finished at: `2026-03-07 13:19`
- [x] Implement authenticated session issuance using secure cookie or bearer token. Finished at: `2026-03-07 13:19`
- [x] Add revoke/logout/session-expiry behavior. Finished at: `2026-03-07 13:27`

### Milestone 4: Remote Web Client

- [x] Create a dedicated remote client page served by the relay. Finished at: `2026-03-07 13:19`
- [x] Implement connect/disconnect behavior against relay endpoints. Finished at: `2026-03-07 13:19`
- [x] Implement thread list UI and selection flow. Finished at: `2026-03-07 13:19`
- [x] Implement transcript rendering from `thread/read` data. Finished at: `2026-03-07 13:19`
- [x] Implement send-message flow for existing and newly created threads. Finished at: `2026-03-07 13:19`
- [x] Implement streamed assistant rendering and partial/failure states. Finished at: `2026-03-07 13:19`
- [x] Implement a mobile-first layout so the phone UI is the main supported client. Finished at: `2026-03-07 13:38`

### Milestone 5: Session and Mapping Logic

- [x] Decide whether the remote UI operates only on manually selected threads or also supports automatic remote-conversation-to-thread mapping. Finished at: `2026-03-07 14:08`
- [ ] If automatic mapping is included, implement a minimal mapping store from remote session identity to Codex `threadId`. Finished at: `____-__-__ __:__`
- [x] Implement “resume same thread later” behavior from the remote client. Finished at: `2026-03-07 14:08`
- [ ] Ensure a remote turn written through the relay appears later when the same thread is reopened locally. Finished at: `____-__-__ __:__`
- [x] Document the difference between backend thread sync and local Codex UI live refresh. Finished at: `2026-03-07 14:08`

### Milestone 6: Security and Hardening

- [x] Keep app-server bound to localhost only and ensure the relay is the only exposed layer. Finished at: `2026-03-07 13:55`
- [x] Add rate limiting for pairing, login/session use, and message sending. Finished at: `2026-03-07 13:55`
- [x] Add input validation and thread access validation on relay endpoints. Finished at: `2026-03-07 13:55`
- [x] Add request/response logging without storing sensitive conversation content by default. Finished at: `2026-03-07 13:55`
- [x] Add session expiry cleanup and stale pairing cleanup. Finished at: `2026-03-07 13:47`
- [x] Document a safe deployment model for remote access. Finished at: `2026-03-07 14:08`

### Milestone 7: Local Operations and UX

- [x] Add a single start command or launcher script that starts app-server and relay together. Finished at: `2026-03-07 13:31`
- [x] Add an operator page or local status view showing pairing state and active remote sessions. Finished at: `2026-03-07 13:27`
- [x] Show the QR code locally in a clear, scannable view. Finished at: `2026-03-07 13:38`
- [x] Add a simple status surface for app-server connectivity and thread access health. Finished at: `2026-03-07 13:31`
- [x] Add restart/reconnect guidance for common local failure modes. Finished at: `2026-03-07 13:47`

### Milestone 8: Verification and Release Readiness

- [ ] Verify end-to-end pairing from phone to laptop. Finished at: `____-__-__ __:__`
- [x] Verify that an existing Codex thread can be listed, loaded, and continued remotely. Finished at: `2026-03-07 14:08`
- [x] Verify streamed replies appear correctly on the remote client. Finished at: `2026-03-07 14:08`
- [ ] Verify that returning later to the same thread locally shows the remote-written history after reopen/reload. Finished at: `____-__-__ __:__`
- [x] Document the manual test matrix and observed limitations. Finished at: `2026-03-07 14:08`
- [x] Decide whether to archive, remove, or retain the legacy bridge code after the new relay path is stable. Finished at: `2026-03-07 14:14`

## Notes

- Existing legacy bridge assets should remain in place until the new relay path is functional.
- The current `examples/codex-app-server-chat.html` should be treated as a useful app-server reference, not necessarily the final remote client.
- The final product should be centered around an authenticated relay, not around direct remote access to app-server.

## Finalization

### Milestone 9: Pairing and Session Finalization

- [x] Replace external QR rendering with local in-app QR generation. Finished at: `2026-03-07 16:38`
- [x] Auto-create a fresh pairing when the operator page loads. Finished at: `2026-03-07 16:38`
- [x] Show a blank QR placeholder before the first pairing is created or refreshed. Finished at: `2026-03-07 16:38`
- [x] Add `Revoke This Session` with an explicit confirmation dialog explaining that only the current device/browser session will be logged out. Finished at: `2026-03-07 16:38`
- [x] Add `Invalidate All Sessions` with an explicit confirmation dialog explaining that every paired/authenticated device will be logged out and will need to pair again. Finished at: `2026-03-07 16:38`
- [x] Improve visible session state on both operator and remote client surfaces. Finished at: `2026-03-07 16:38`

### Milestone 10: Product UI Refactor

- [x] Refactor the remote client into a phone-first product UI instead of a diagnostics-first layout. Finished at: `2026-03-07 16:50`
- [x] Create a dedicated `Threads` screen that behaves like a messaging app conversation list. Finished at: `2026-03-07 16:50`
- [x] Create a dedicated `Chat` screen that behaves like a messaging app conversation view. Finished at: `2026-03-07 16:50`
- [x] Add navigation so the user can enter a thread and return back to the `Threads` screen at any time. Finished at: `2026-03-07 16:50`
- [x] Add a top-right hamburger menu on the `Threads` screen. Finished at: `2026-03-07 16:50`
- [x] Add a top-right hamburger menu on the `Chat` screen. Finished at: `2026-03-07 16:50`
- [x] Keep operator/admin controls separated from the normal chat flow while still reachable from mobile. Finished at: `2026-03-07 16:50`
- [x] Polish the mobile visual system so the app feels like a product rather than a debug page. Finished at: `2026-03-07 16:50`

### Milestone 11: Thread and Model Controls

- [x] Replace the current minimal `New Thread` flow with a proper creation form. Finished at: `2026-03-07 17:22`
- [x] Require the user to choose a working directory/path when creating a new thread. Finished at: `2026-03-07 17:22`
- [x] Allow the user to choose the model when creating a new thread. Finished at: `2026-03-07 17:22`
- [x] Allow the user to choose the title/name when creating a new thread. Finished at: `2026-03-07 17:22`
- [x] Expose sandbox/approval behavior in the new-thread form if app-server supports it. Finished at: `2026-03-07 17:22`
- [x] Add a model dropdown in the chat screen showing the active model for the current conversation. Finished at: `2026-03-07 17:22`
- [x] Allow changing the selected model for future turns from the chat screen. Finished at: `2026-03-07 17:22`
- [x] Add a thread info surface showing key metadata for the selected conversation. Finished at: `2026-03-07 17:22`

### Milestone 12: Final Verification and Product Readiness

- [ ] Record final end-to-end verification for phone access over a different network. Finished at: `____-__-__ __:__`
- [ ] Record final end-to-end verification for existing thread load and continuation from the remote client. Finished at: `____-__-__ __:__`
- [ ] Record final end-to-end verification for streamed replies in the remote client. Finished at: `____-__-__ __:__`
- [ ] Record final verification that reopening/reloading the same thread locally in Codex shows remote-written history. Finished at: `____-__-__ __:__`
- [ ] Update the verification document with final observed behavior, limitations, and deployment notes. Finished at: `____-__-__ __:__`
- [ ] Update this plan with completion timestamps for the finalization milestones. Finished at: `____-__-__ __:__`
