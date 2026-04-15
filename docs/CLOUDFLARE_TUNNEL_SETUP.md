# Cloudflare Tunnel Setup

## Goal

Expose the relay over a stable public HTTPS/WSS URL while keeping `codex app-server` local on `ws://127.0.0.1:4500`.

This guide is for the public/shareable repo version.
Use placeholders here.
Keep your real domain, tunnel name, and secrets in `docs-private/`.

## Required Rule

Expose only the relay.

Do not expose `codex app-server` directly.

## Prerequisites

- A Cloudflare account
- A domain managed by Cloudflare
- `cloudflared` installed on the machine running the relay
- The relay repo built locally

## Recommended Public Host

Use a dedicated hostname, for example:

```text
codex.YOUR_DOMAIN
```

Examples:
- `codex.example.com`
- `relay.example.net`

## Step 1. Authenticate `cloudflared`

```powershell
cloudflared tunnel login
```

This opens a browser flow and creates the local Cloudflare credentials file used for named tunnels.

## Step 2. Create a Named Tunnel

```powershell
cloudflared tunnel create codex-remote-relay
```

You can choose a different tunnel name if you want.

## Step 3. Route DNS to the Tunnel

```powershell
cloudflared tunnel route dns codex-remote-relay codex.YOUR_DOMAIN
```

This creates the DNS record that points your hostname to the named tunnel.

## Step 4. Start the Local Stack

Use the launcher script and set the public URL to the hostname you routed above:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-codex-remote-stack.ps1 `
  -PublicBaseUrl "https://codex.YOUR_DOMAIN" `
  -SessionSecret "PUT_A_LONG_RANDOM_SECRET_HERE" `
  -OperatorSecret "PUT_A_SEPARATE_OPERATOR_SECRET_HERE"
```

This should start:
- local Codex app-server
- local relay
- local Cloudflare tunnel process

## Step 5. Verify the Public Surfaces

Expected URLs:

- remote client:
  - `https://codex.YOUR_DOMAIN/`
- operator page:
  - `https://codex.YOUR_DOMAIN/operator`

Check:

1. `https://codex.YOUR_DOMAIN/operator` loads
2. `Refresh Health` shows relay `ok`
3. app-server status is `ok`
4. QR pairing generates successfully

## Step 6. Verify from Another Network

From a phone or browser on a different network:

1. Open:
   - `https://codex.YOUR_DOMAIN/operator`
2. Create pairing
3. Scan the QR or open the pair URL
4. Confirm the remote client authenticates and can load threads

## Security Notes

- Keep `codex app-server` on localhost only
- Expose only the relay
- Use an explicit long `CODEX_RELAY_SESSION_SECRET`
- Use a separate `CODEX_RELAY_OPERATOR_SECRET` for the operator page and pairing controls
- Public-host deployment without `CODEX_RELAY_OPERATOR_SECRET` is not supported
- Do not commit your real domain, tunnel token, or secrets into tracked docs
- Pairing and operator APIs are local-only by default unless you configure an operator secret

## Official References

- Cloudflare Tunnel docs:
  - https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- `cloudflared` install and tunnel setup:
  - https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/
