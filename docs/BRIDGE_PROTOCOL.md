# Bridge Protocol (v1)

Base WebSocket endpoint:
- `ws://127.0.0.1:<port>/bridge/v1`

All messages are JSON objects.

## Authentication

Use one of:

1. Connection header:
   - `Authorization: Bearer <token>`
2. First message:
```json
{ "type": "auth", "token": "<token>" }
```

## Request Envelope

Common fields:

- `type`: `ask | reset | cancel | info | models | ping`
- `requestId`: client-generated string/UUID
- `sessionId`: required for `ask`, recommended for all request tracking

Optional routing/context fields:

- `traceId`
- `fromAgent`
- `toRole`
- `hops`
- `maxHops`
- `originBridgeId`
- `meta`

## Request Types

### `ask`

```json
{
  "type": "ask",
  "requestId": "fda4d1e1-4e7a-4d18-b244-44abfeff19de",
  "sessionId": "telegram:123456",
  "prompt": "Explain this stack trace",
  "modelId": "optional-model-id",
  "timeoutMs": 90000
}
```

### `reset`

Reset one session:
```json
{ "type": "reset", "requestId": "r1", "sessionId": "telegram:123456" }
```

Reset all sessions in this bridge instance:
```json
{ "type": "reset", "requestId": "r2" }
```

### `cancel`

Cancel an in-flight request by request id:
```json
{ "type": "cancel", "requestId": "fda4d1e1-4e7a-4d18-b244-44abfeff19de" }
```

### `info`

```json
{ "type": "info", "requestId": "i1", "sessionId": "info:1" }
```

Returns bridge metadata (`bridgeId`, `windowId`, `workspaceRole`, etc.) in `done.text`.

### `models`

```json
{ "type": "models", "requestId": "m1", "sessionId": "models:1" }
```

Returns available Copilot models in `done.text`.

### `ping`

```json
{ "type": "ping", "requestId": "p1", "sessionId": "health:1" }
```

Returns `pong`.

## Server Events

- `ack`: request accepted
- `delta`: streamed token/text chunk
- `done`: terminal success event
- `error`: terminal failure event
- `pong`: health response

Example stream:
```json
{ "type": "ack", "requestId": "req-1" }
{ "type": "delta", "requestId": "req-1", "chunk": "Hello" }
{ "type": "delta", "requestId": "req-1", "chunk": " world" }
{ "type": "done", "requestId": "req-1", "text": "Hello world", "modelId": "..." }
```

## Error Codes

- `E_BAD_REQUEST`
- `E_UNAUTHORIZED`
- `E_RATE_LIMIT`
- `E_NO_MODEL`
- `E_MODEL_REQUEST_FAILED`
- `E_TIMEOUT`
- `E_CANCELLED`
- `E_INTERNAL`

## Operational Limits (current defaults)

- Bind: `127.0.0.1` only
- Prompt size: `50000` chars max
- Timeout: default `90000`, max `300000`
- Rate limit: global `120/min`, per-session `20/min`
- Session retention: up to 20 turns, 200k chars, 2h idle TTL
