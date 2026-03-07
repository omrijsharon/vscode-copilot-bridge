# Remote Relay Verification

## Manual Test Matrix

### Environment

- Codex app-server running on `ws://127.0.0.1:4500`
- relay running on `http://127.0.0.1:8788` during current testing

## Test Cases

### 1. Pairing

- [ ] Open operator page
- [ ] Create pairing
- [ ] Confirm QR and pair URL appear
- [ ] Open pair URL
- [ ] Confirm session becomes authenticated

### 2. Relay Connection

- [ ] Open remote client page
- [ ] Confirm session is authenticated
- [ ] Click `Connect Relay`
- [ ] Confirm connection state becomes connected/authenticated

### 3. Thread Discovery

- [ ] Load thread list
- [ ] Confirm known Codex threads are listed
- [ ] Select target thread

### 4. Transcript Load

- [ ] Load selected thread
- [ ] Confirm transcript renders user/assistant history
- [ ] Confirm line breaks/bullets render correctly

### 5. Remote Send + Stream

- [x] Send prompt through remote client
- [x] Confirm assistant streamed reply is shown
- [x] Confirm test prompt `reply with exactly: remote-relay-ok` returned `remote-relay-ok`

### 6. Remote Reload Persistence

- [ ] Reload remote page
- [ ] Re-authenticate if needed
- [ ] Confirm last selected thread is remembered
- [ ] Reload same thread
- [ ] Confirm previously sent remote turn is still present

### 7. Local Persistence

- [ ] Reopen the same thread locally in Codex
- [ ] Confirm remote-written turn appears after reopen/reload
- [ ] Note whether live refresh occurs without reopen

## Observed Notes

- Existing remote send/stream happy path works.
- Relay WebSocket authentication works.
- Thread load from app-server works.
- Transcript formatting issue was fixed with preserved line breaks.
- Port `8787` was blocked by stale TCP teardown during testing, so relay verification continued on `8788`.
