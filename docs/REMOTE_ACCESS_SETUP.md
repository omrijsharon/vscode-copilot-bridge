# Remote Access Setup

## Goal

Run the remote web client from a phone on a different network and securely reach the local Codex app-server through the relay.

## Required Rule

Expose only the relay.

Do not expose `codex app-server` directly.

Keep:
- `codex app-server` on `ws://127.0.0.1:4500`

Expose:
- the relay over HTTPS/WSS

## Recommended Topology

```text
phone browser
  -> public HTTPS/WSS URL
  -> relay
  -> local codex app-server on 127.0.0.1:4500
```

## Required Config

When the phone is on a different network, the relay must know the public URL the phone will use.

Set:

```powershell
$env:CODEX_RELAY_HOST = "0.0.0.0"
$env:CODEX_RELAY_PORT = "8788"
$env:CODEX_RELAY_BASE_URL = "https://YOUR_PUBLIC_HOST"
```

Keep:

```powershell
$env:CODEX_APP_SERVER_URL = "ws://127.0.0.1:4500"
```

Optional but recommended:

```powershell
$env:CODEX_RELAY_SESSION_SECRET = "set-a-long-random-secret-here"
```

## Why `CODEX_RELAY_BASE_URL` Matters

The pairing URL and session cookie behavior depend on the public base URL.

If the phone opens:

```text
https://example-relay.yourdomain.com
```

then `CODEX_RELAY_BASE_URL` must also be:

```text
https://example-relay.yourdomain.com
```

Otherwise:
- the QR code will point to the wrong place
- cookies may not behave as expected
- the phone may pair against the wrong origin

## Ways To Expose The Relay

### Option 1. Reverse proxy on your own host

Examples:
- Nginx
- Caddy
- Traefik

Requirements:
- HTTPS enabled
- WebSocket upgrade support
- route traffic only to the relay

### Option 2. Tunnel

Examples:
- Tailscale Funnel / Tailscale access path
- Cloudflare Tunnel
- another HTTPS-capable tunnel

This is often the fastest path for personal remote use.

Requirements:
- the public/tunneled URL must be stable enough to use in `CODEX_RELAY_BASE_URL`
- WebSocket support must be enabled through the tunnel

## Local Start Example

Start app-server:

```powershell
& "C:\Users\tamipinhasi\.vscode\extensions\openai.chatgpt-26.304.20706-win32-x64\bin\windows-x86_64\codex.exe" app-server --listen ws://127.0.0.1:4500
```

Then start relay with remote-ready config:

```powershell
$env:CODEX_RELAY_HOST = "0.0.0.0"
$env:CODEX_RELAY_PORT = "8788"
$env:CODEX_RELAY_BASE_URL = "https://YOUR_PUBLIC_HOST"
$env:CODEX_APP_SERVER_URL = "ws://127.0.0.1:4500"
$env:CODEX_RELAY_SESSION_SECRET = "set-a-long-random-secret-here"
node .\out\relay\server.js
```

## Pairing Flow

1. Open the operator page on the laptop.
2. Create pairing.
3. Show the QR code.
4. Scan from the phone.
5. The phone opens the public pair URL.
6. Relay sets the session cookie.
7. Phone is redirected to the remote client.

## Verification Checklist

- phone can open the public relay URL
- operator page shows the expected public base URL
- QR code points to the public HTTPS URL, not localhost
- phone session becomes authenticated
- relay WebSocket connects from the phone
- thread list loads
- thread loads
- prompt send/stream works

## Security Notes

- always prefer HTTPS for remote phone access
- set an explicit `CODEX_RELAY_SESSION_SECRET`
- keep pairing TTL short
- do not publish app-server directly
- if using a reverse proxy or tunnel, restrict exposure to the relay only
