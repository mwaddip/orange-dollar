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
- Reject `relay` messages where `to` equals sender's own partyId (no self-sends)

### Resource Limits

| Limit | Default | Purpose |
|-------|---------|---------|
| Max concurrent sessions | 50 | Prevent memory exhaustion |
| Max parties per session | 10 | Bound per-session state |
| Max message size | 1 MB | DKG blobs with K_iter=20 reach ~600 KB |
| Abandoned session cleanup | 10 min with no connections | Reclaim resources |
| Per-IP connection limit | 5 concurrent WS connections | DDoS mitigation |
| WebSocket ping interval | 30 seconds | Detect dead connections |

All limits are configurable via flags or environment variables.

### Wire Protocol

JSON messages over WebSocket.

**Client to Server:**

```json
{ "type": "create", "parties": 5, "threshold": 3, "pubkey": "base64..." }
{ "type": "join", "session": "X7K2M9", "pubkey": "base64..." }
{ "type": "reconnect", "session": "X7K2M9", "token": "..." }
{ "type": "relay", "to": 2, "payload": "base64-ciphertext..." }
```

**Server to Client:**

```json
{ "type": "created", "session": "X7K2M9", "partyId": 0, "token": "...", "url": "https://..." }
{ "type": "joined", "partyId": 2, "count": 3, "total": 5 }
{ "type": "ready", "pubkeys": { "0": "base64...", "1": "base64...", "2": "base64..." } }
{ "type": "relay", "from": 0, "payload": "base64-ciphertext..." }
{ "type": "left", "partyId": 2 }
{ "type": "reconnected", "partyId": 2 }
{ "type": "error", "message": "..." }
```

**Notes:**
- The `joined` message is broadcast to all *other* connected parties. The joining party itself receives a `joined` message with their own `partyId` as confirmation of their assignment.
- The `token` field in `created` is a server-issued reconnection token (opaque string, crypto/rand). Joiners also receive a token in their personal `joined` response.
- There is no server-side `broadcast` message type. The `RelayClient.broadcast()` method sends N-1 individual `relay` messages, each encrypted with the recipient's key. The server just routes them.
- The `threshold` field is stored by the server but not used for any logic — it is client metadata passed through in the `ready` message for the ceremony UI.

### Session Codes

6 characters, alphanumeric uppercase + digits, excluding ambiguous characters (0/O, 1/I/L). Generated with `crypto/rand`. On collision with an existing session, the server retries with a new code (up to 10 attempts).

Session codes are a convenience mechanism, not a security boundary. Security relies on E2E encryption, not session code secrecy.

### Session Lifecycle

1. **Create:** Party 0 sends `create` with party count, threshold, and ECDH pubkey. Server allocates session, assigns partyId 0, returns session code, token, and shareable URL.
2. **Join:** Parties 1..N-1 send `join` with session code and pubkey. Server assigns sequential partyIds. The joiner receives a `joined` message with their partyId and token. All other connected parties receive a `joined` broadcast with the new party's ID and current count.
3. **Ready:** When party count reached, server broadcasts `ready` with all ECDH pubkeys. Session moves to active state — no more joiners accepted.
4. **Active:** Server routes `relay` messages between parties. No protocol awareness — just forwards encrypted payloads.
5. **Cleanup:** When all connections drop and none reconnect within 10 minutes, session is removed.

### Reconnection

If a WebSocket connection drops (network blip, laptop sleep), the client reconnects with `{ type: "reconnect", session, token }`. The server validates the token, re-associates the connection with the original partyId, and broadcasts `reconnected` to other parties.

**Page reload (keys lost):** If the browser page reloads, ephemeral ECDH keys are gone. The client can reconnect (token is stored in sessionStorage) but cannot decrypt any new messages. The server broadcasts `reconnected` but the client detects the key mismatch locally and shows an error: "Encryption keys lost — ceremony must restart." Other parties see a notification that the party's keys changed. The session creator must create a new session.

### Signing vs DKG Sessions

The relay server does not distinguish between signing and DKG. The difference is purely in how the client sets `parties`:

- **DKG:** `parties` = total key holders (e.g. 5), `threshold` = signing threshold (e.g. 3)
- **Signing:** `parties` = `threshold` (e.g. 3) — session starts as soon as threshold parties connect

If fewer than `parties` ever join, the session sits idle until abandoned (10 min with no connections). There is no mechanism to reduce the expected count — the creator must let it expire and create a new session. This is intentional: changing party count mid-session would complicate the protocol.

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
  broadcast(payload: Uint8Array): void  // sends N-1 individual relay messages

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
3. On `ready`: receive all peer pubkeys, derive one AES-256-GCM key per peer via:
   - `ECDH(myPriv, theirPub)` → shared secret
   - `HKDF(SHA-256, shared_secret, salt=sessionCode, info="od-relay-v1")` → 256-bit key
4. `send(to, payload)`: encrypt with recipient's derived key + random 12-byte IV, send `IV || ciphertext`
5. On receive: decrypt with sender's derived key using received IV

All blobs are encrypted per-recipient, including broadcasts (which send N-1 individually encrypted copies). The relay server never sees plaintext.

**Replay protection:** AES-GCM provides authentication but not replay protection. The relay could theoretically replay a previous message. The ceremony protocols handle this at the application layer — both ThresholdSign and DKGWizard reject duplicate blobs from the same party/round. No additional replay protection is needed at the relay layer.

### Stale Blob Handling

If a party temporarily disconnects and reconnects, they might receive buffered blobs from a round they have already completed. The RelayClient does not filter by round (it has no protocol awareness). The ceremony components (ThresholdSign, DKGWizard) already reject blobs for wrong/completed rounds — this existing validation handles stale blobs.

## Ceremony UI Changes

### Mode Selection

Both DKG and signing ceremonies show a mode selector before starting:

- **Create Session** — set parameters, get session code + shareable URL
- **Join Session** — paste code or arrive via URL
- **Offline Mode** — current file-based flow, unchanged

### Relay Mode Behavior

- No "Download blob" / "Import blob" steps — blobs auto-route via relay
- Progress indicator shows all parties and their connection status
- Auto-advance: when the client has received all expected blobs for the current phase, it computes the next phase and sends results immediately (see auto-advance rules below)
- If a party disconnects, others see a status change; ceremony pauses until reconnect
- No automatic timeout — session creator controls lifecycle

### Auto-Advance Rules

The relay is protocol-agnostic, so auto-advance logic lives in the client ceremony components.

**Signing (ThresholdSign):** Each round expects exactly T-1 blobs (one from each other active signer). When T-1 blobs collected → compute next round → send results.

**DKG (DKGWizard):** Blob expectations vary by phase:

| Phase | Blobs sent | Blobs expected from each peer | Total expected | Auto-advance when |
|-------|-----------|-------------------------------|----------------|-------------------|
| 1 (Commit) | 1 broadcast | 1 broadcast | N-1 | N-1 broadcasts received |
| 2 (Reveal) | 1 broadcast + N-1 private | 1 broadcast + 1 private | 2*(N-1) | All N-1 broadcasts + N-1 privates received |
| 3 (Masks) | N-1 private | 1 private | N-1 | N-1 privates received |
| 4 (Aggregate) | 1 broadcast | 1 broadcast | N-1 | N-1 broadcasts received |

The DKGWizard tracks received blob counts per phase and per party. When the expected count is reached, it auto-advances.

### Party ID Assignment

The relay server assigns party IDs sequentially (0, 1, 2, ...) on join. Both DKG and signing ceremonies use these relay-assigned IDs. The current DKGWizard's manual party ID selection is removed in relay mode (retained in offline mode).

### Offline Mode Behavior

Identical to current implementation. No WebSocket connection. Manual file download/paste. Manual party ID selection for DKG.

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
◄─ { created, token }

  shares "X7K2M9" out-of-band

                                                ◄────── join("X7K2M9", pk1)
◄─ { joined, 1, 2/3 }        assigns partyId 1 ──────► { joined, partyId:1, token }
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

## Data Flow Example (3-of-5 DKG)

```
Party 0 (creator)        Relay Server        Party 1        Party 2        Party 3        Party 4
─────────────────        ────────────        ───────        ───────        ───────        ───────

create(5, 3, pk0) ─────► session "A3B7KR"
◄─ { created }            partyId: 0

  shares "A3B7KR" out-of-band

                          parties 1-4 join sequentially
◄─ { ready, pubkeys }    all 5 joined ──────► { ready } (all)

derive AES keys                               derive keys (all)

PHASE 1 (Commit): each party broadcasts commitment hash
  party 0: encrypt(p1_blob, k01) → relay → party 1
           encrypt(p1_blob, k02) → relay → party 2
           encrypt(p1_blob, k03) → relay → party 3
           encrypt(p1_blob, k04) → relay → party 4
  (parties 1-4 do the same)
  Each party collects 4 broadcasts → auto-advance

PHASE 2 (Reveal): each party sends 1 broadcast + 4 private blobs
  party 0: broadcast(rho_reveal) → 4 encrypted relay messages
           send(1, private_share_for_1) → 1 encrypted relay
           send(2, private_share_for_2) → 1 encrypted relay
           send(3, private_share_for_3) → 1 encrypted relay
           send(4, private_share_for_4) → 1 encrypted relay
  (parties 1-4 do the same)
  Each party collects 4 broadcasts + 4 privates → auto-advance

PHASE 3 (Masks): each party sends N-1 private blobs
  party 0: send(1, mask_for_1) → encrypted relay
           send(2, mask_for_2) → encrypted relay
           send(3, mask_for_3) → encrypted relay
           send(4, mask_for_4) → encrypted relay
  (parties 1-4 do the same)
  Each party collects 4 privates → auto-advance

PHASE 4 (Aggregate): each party broadcasts final signature
  (same as phase 1 pattern)
  Each party collects 4 broadcasts → ceremony complete

Each party now has their ThresholdKeyShare → download encrypted share file
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
| Compromised relay | Sees ciphertext only. Cannot reconstruct shares or signatures. Can deny service but cannot forge or tamper (AES-GCM authenticated). **Exception:** a compromised relay could substitute ECDH pubkeys during the `ready` broadcast, performing a MITM key substitution attack — see Pubkey Verification below. |
| MITM on WebSocket | WSS (TLS). Relay URL from same origin as ceremony page. |
| Malicious party | Handled by threshold protocol itself — requires T honest participants. |
| Session hijacking | Party IDs bound to connection. Reconnection requires server-issued token. Late joiners get "session full" error. |
| Replay attacks | AES-GCM provides per-message authentication. Replayed blobs are rejected at the protocol layer (duplicate party/round checks). |

### Pubkey Verification (MITM Mitigation)

A compromised relay could substitute ECDH pubkeys in the `ready` message, establishing separate encrypted channels to each party (classic key substitution MITM). To detect this:

After `ready`, each party computes a **session fingerprint**: the first 8 hex characters of `SHA-256(sorted pubkeys concatenated)`. The UI displays this fingerprint prominently. Parties verify the fingerprint matches via their out-of-band channel (voice call, in-person). A mismatch indicates tampering.

This is an optional verification step — the ceremony can proceed without it. But the UI should display the fingerprint and encourage verification for high-security ceremonies (DKG key generation).

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
