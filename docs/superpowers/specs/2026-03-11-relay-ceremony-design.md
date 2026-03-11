# Encrypted WebSocket Relay for Threshold Ceremonies

**Date:** 2026-03-11
**Status:** Approved

## Problem

The current threshold signing and DKG ceremonies require parties to manually exchange blobs via file download/paste. In practice this UX is unworkable with a group of people — each round requires every party to download a blob, share it out-of-band, and import blobs from all other parties. A 3-of-5 signing ceremony requires 18 manual file exchanges across 3 rounds.

## Solution

An encrypted WebSocket relay server that automatically routes blobs between ceremony participants. End-to-end encryption ensures the relay never sees plaintext data. The existing offline/manual mode is preserved as a fallback.

## Architecture Overview

```
  Party 0 (browser)     Party 1 (browser)     Party 2 (browser)
       │                      │                      │
       │  ECDH keypair        │  ECDH keypair        │  ECDH keypair
       │  (ephemeral)         │  (ephemeral)         │  (ephemeral)
       │                      │                      │
       └──────── WSS ─────────┼──────── WSS ─────────┘
                              │
                     ┌────────┴────────┐
                     │  Relay Server   │
                     │  (Go binary)    │
                     │                 │
                     │  - Sessions     │
                     │  - Party IDs    │
                     │  - Pubkey dist  │
                     │  - Blob routing │
                     │  - Presence     │
                     └─────────────────┘
                     Sees only ciphertext
```

## Relay Server (Go)

### Responsibilities

- Accept WebSocket connections at `/ws?session=XXXXXX`
- Session lifecycle: create, waiting for parties, ready (auto-triggered), active, cleanup
- Assign party numbers (0, 1, 2, ... in join order)
- Auto-lock when expected party count reached: broadcast all ECDH pubkeys
- Route encrypted blobs from sender to specific recipient
- Presence notifications (joined, disconnected, reconnected)

### Resource Limits

| Limit | Default | Purpose |
|-------|---------|---------|
| Max concurrent sessions | 50 | Prevent memory exhaustion |
| Max parties per session | 10 | Bound per-session state |
| Max message size | 1 MB | DKG blobs with K_iter=20 reach ~600 KB |
| Abandoned session cleanup | 10 min with no connections | Reclaim resources |
| Per-IP connection limit | 5 concurrent WS connections | DDoS mitigation |

All limits are configurable via flags or environment variables.

### Wire Protocol

JSON messages over WebSocket.

**Client to Server:**

```json
{ "type": "create", "parties": 5, "threshold": 3, "pubkey": "base64..." }
{ "type": "join", "session": "X7K2M9", "pubkey": "base64..." }
{ "type": "relay", "to": 2, "payload": "base64-ciphertext..." }
```

**Server to Client:**

```json
{ "type": "created", "session": "X7K2M9", "partyId": 0, "url": "https://..." }
{ "type": "joined", "partyId": 2, "count": 3, "total": 5 }
{ "type": "ready", "pubkeys": { "0": "base64...", "1": "base64...", "2": "base64..." } }
{ "type": "relay", "from": 0, "payload": "base64-ciphertext..." }
{ "type": "left", "partyId": 2 }
{ "type": "reconnected", "partyId": 2 }
{ "type": "error", "message": "..." }
```

### Session Codes

6 characters, alphanumeric uppercase + digits, excluding ambiguous characters (0/O, 1/I/L). Generated with `crypto/rand`.

### Session Lifecycle

1. **Create:** Party 0 sends `create` with party count, threshold, and ECDH pubkey. Server allocates session, assigns partyId 0, returns session code and shareable URL.
2. **Join:** Parties 1..N-1 send `join` with session code and pubkey. Server assigns sequential partyIds, broadcasts `joined` events to all connected parties.
3. **Ready:** When party count reached, server broadcasts `ready` with all ECDH pubkeys. Session moves to active state — no more joiners accepted.
4. **Active:** Server routes `relay` messages between parties. No protocol awareness — just forwards encrypted payloads.
5. **Cleanup:** When all connections drop and none reconnect within 10 minutes, session is removed.

### Reconnection

Reconnection uses a server-issued token (returned in `created`/`joined` response). A reconnecting client sends the token to reclaim their partyId. If the page reloads (ephemeral ECDH keys lost), the party cannot decrypt future messages — effectively a new session is needed.

### Signing vs DKG Sessions

The relay server does not distinguish between signing and DKG. The difference is purely in how the client sets `parties`:

- **DKG:** `parties` = total key holders (e.g. 5), `threshold` = signing threshold (e.g. 3)
- **Signing:** `parties` = `threshold` (e.g. 3) — session starts as soon as threshold parties connect

## Browser-Side Relay Client

### New Files

- `cabal/src/lib/relay.ts` — WebSocket client, session management, event emitter
- `cabal/src/lib/relay-crypto.ts` — ECDH keygen, HKDF key derivation, AES-256-GCM encrypt/decrypt

### RelayClient API

```typescript
interface RelayClient {
  // Lifecycle
  create(parties: number, threshold: number): Promise<{ session: string, url: string }>
  join(session: string): Promise<void>
  close(): void

  // State
  partyId: number
  parties: Map<number, { connected: boolean }>
  ready: boolean

  // Messaging (E2E encrypted automatically)
  send(to: number, payload: Uint8Array): void
  broadcast(payload: Uint8Array): void  // N-1 individually encrypted messages

  // Events
  on('joined', (partyId: number, count: number, total: number) => void)
  on('ready', (pubkeys: Map<number, Uint8Array>) => void)
  on('message', (from: number, payload: Uint8Array) => void)
  on('left', (partyId: number) => void)
  on('reconnected', (partyId: number) => void)
  on('error', (message: string) => void)
}
```

### ECDH Encryption Flow

All cryptography uses the Web Crypto API (no external libraries).

1. On connect: generate ephemeral P-256 ECDH keypair
2. Send raw public key bytes to server as part of `create`/`join`
3. On `ready`: receive all peer pubkeys, derive one AES-256-GCM key per peer via `ECDH(myPriv, theirPub)` → `HKDF(SHA-256)` → 256-bit key
4. `send(to, payload)`: encrypt with recipient's derived key + random 12-byte IV, send `IV || ciphertext`
5. On receive: decrypt with sender's derived key using received IV

All blobs are encrypted per-recipient, including broadcasts (which send N-1 individually encrypted copies). The relay server never sees plaintext.

## Ceremony UI Changes

### Mode Selection

Both DKG and signing ceremonies show a mode selector before starting:

- **Create Session** — set parameters, get session code + shareable URL
- **Join Session** — paste code or arrive via URL
- **Offline Mode** — current file-based flow, unchanged

### Relay Mode Behavior

- No "Download blob" / "Import blob" steps — blobs auto-route via relay
- Progress indicator shows all parties and their connection status
- Each round auto-advances when T-1 blobs received for the current round
- If a party disconnects, others see a status change; ceremony pauses until reconnect
- No automatic timeout — session creator controls lifecycle

### Offline Mode Behavior

Identical to current implementation. No WebSocket connection. Manual file download/paste.

### Session Identification

Parties can join via:

- **Short code** (e.g. `X7K2M9`) — typed into a join field, works for phone/voice sharing
- **URL** (e.g. `signing.odol.cash/join/X7K2M9`) — clickable link for chat/email sharing

Both resolve to the same session.

## Data Flow Example (3-of-3 Signing)

```
Party 0 (creator)             Relay Server              Party 1              Party 2
─────────────────             ────────────              ───────              ───────

create(3, 3, pk0) ─────────► session "X7K2M9"
                              partyId: 0
◄─ { created }

  shares "X7K2M9" out-of-band

                                                ◄────── join("X7K2M9", pk1)
◄─ { joined, 1, 2/3 }        assigns partyId 1 ──────► { joined }
                                                                     ◄────── join("X7K2M9", pk2)
◄─ { ready, pubkeys }        all 3 joined      ──────► { ready }    ──────► { ready }

derive AES keys               (sees nothing)            derive keys          derive keys

ROUND 1:
round1() → blob
encrypt(blob, k01) ──────────► route ──────────────────► decrypt, store
encrypt(blob, k02) ──────────► route ──────────────────────────────────────► decrypt, store

                               (parties 1, 2 do the same)

All have 2 round-1 blobs → auto-advance to round 2
  (same encrypt → relay → decrypt pattern)

Round 3 → combine() → signature ready
```

## Security Properties

### What the relay can see

- Session codes, party count, threshold
- ECDH public keys (ephemeral, per-session)
- Encrypted blob ciphertext + routing metadata (from/to party IDs)
- Connection timing and IP addresses

### What the relay cannot see

- Blob contents (E2E encrypted with ECDH-derived AES-256-GCM keys)
- Share file contents (decrypted only in-browser)
- ECDH private keys (never leave the browser)
- The final signature or message being signed

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Compromised relay | Sees ciphertext only. Cannot reconstruct shares or signatures. Can deny service but cannot forge or tamper (AES-GCM authenticated). |
| MITM on WebSocket | WSS (TLS). Relay URL from same origin as ceremony page. |
| Malicious party | Handled by threshold protocol itself — requires T honest participants. |
| Session hijacking | Party IDs bound to connection. Reconnection requires server-issued token. Late joiners get "session full" error. |

### Out of Scope

- Authenticating party identity (parties trust each other out-of-band)
- Protecting against compromised ceremony page HTML

## File Structure

### New: `relay/`

```
relay/
  main.go          -- entry point, config flags, HTTP server
  session.go       -- session state, party tracking, lifecycle
  hub.go           -- WebSocket hub, connection management, routing
  limits.go        -- rate limiting, session caps, per-IP limits
  go.mod
  go.sum
  Dockerfile       -- single-stage build, scratch base
```

### Modified: `cabal/src/`

```
cabal/src/lib/relay.ts          -- new: RelayClient
cabal/src/lib/relay-crypto.ts   -- new: ECDH + AES-GCM helpers
cabal/src/components/ThresholdSign.tsx   -- add relay transport, auto-advance
cabal/src/components/OfflineSigner.tsx   -- add create/join/offline mode selector
```

### Modified: `ceremony/src/`

```
ceremony/src/components/DKGWizard.tsx    -- add relay transport, auto-advance
```

### Modified: `shared/`

```
shared/config.json   -- add relayUrl per network
```

### Config Example

```json
{
  "testnet": {
    "label": "Testnet",
    "relayUrl": "wss://relay.odol.cash/ws",
    "rpcUrl": "...",
    "addresses": { ... }
  }
}
```

### Offline Signer Build

No changes. The offline single-file HTML does not include the relay client. Offline mode uses the existing file-based blob exchange.
