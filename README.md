# Copilot Bridge

VS Code extension that exposes Copilot language model chat to local external clients via WebSocket.

## Development

- `npm install`
- `npm run build`

## Endpoint

- `ws://127.0.0.1:<port>/bridge/v1`
- Bearer auth required

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
