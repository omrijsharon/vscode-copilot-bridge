# Copilot Bridge

VS Code extension that exposes Copilot language model chat to local external clients via WebSocket.

## Documentation

- Installation: [docs/INSTALLATION.md](docs/INSTALLATION.md)
- Protocol/API for external programs: [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md)

## Development

- `npm install`
- `npm run build`

## Endpoint

- `ws://127.0.0.1:<port>/bridge/v1`
- Bearer auth required
- Requests: `ask | reset | cancel | info | models | ping`
- Health check: send `ping` and expect `pong`
- Model status: send `models`

## Hardening Defaults

- Local bind only: `127.0.0.1`
- Prompt size cap: `50000` chars
- Timeout: default `90000ms`, max `300000ms`
- Rate limits: global `120/min`, per-session `20/min`
- Logs: metadata-only ring buffer (500 entries)

## Example Client

- CLI adapter: `examples/cli-client.mjs`
- Environment variables:
  - `COPILOT_BRIDGE_TOKEN` (required)
  - `COPILOT_BRIDGE_PORT` (default `8761`)
  - `COPILOT_BRIDGE_SESSION` (default `cli:default`)
- Commands:
  - `/reset` resets current session state
  - `/model <id>` sets per-request model override
  - `/quit` exits the client
