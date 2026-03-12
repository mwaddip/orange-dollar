# Encrypted Relay

The relay server enables real-time communication between signers during [PERMAFROST](/security/permafrost) ceremonies (DKG key generation and threshold signing). It routes encrypted messages between participants without being able to read them.

## Why a Relay?

Without the relay, signers exchange data by manually copying and pasting blobs — workable for small groups, but slow and error-prone. The relay automates this exchange over WebSocket connections, reducing a multi-minute manual process to seconds.

The relay is a **convenience layer**, not a trust layer. All cryptographic operations still happen locally in each signer's browser.

## Trust Model

The relay is designed so that a compromised or malicious relay server cannot:

- **Read ceremony data.** All payloads are encrypted end-to-end with AES-256-GCM. The relay only sees ciphertext.
- **Forge messages from other participants.** Each message is decrypted with a key derived from a unique pairwise ECDH key agreement. A message that doesn't decrypt correctly is rejected.
- **Inject extra participants.** The server assigns party IDs sequentially. The number of participants is fixed when the session is created, and the session locks once full.
- **Replay old messages.** Each AES-GCM encryption uses a fresh random IV. Replaying ciphertext would fail decryption or produce garbage.

### What the relay _can_ see

- That a session exists and how many parties are in it
- Which party sent a message and to whom (routing metadata)
- The ECDH public keys of each participant (ephemeral, per-session)
- Connection timing and IP addresses

This metadata is comparable to what any network observer would see. The relay cannot correlate sessions to real identities unless the signers reveal themselves through other channels.

### What the relay _can_ do (maliciously)

- **Drop messages** — signers would notice the ceremony stalling and can retry or switch to offline mode.
- **Substitute ECDH public keys (MITM)** — mitigated by the session fingerprint (see below).
- **Refuse to create sessions** — signers fall back to offline mode.

In all cases, the relay cannot extract key shares or forge signatures.

## End-to-End Encryption

Each participant generates an ephemeral **ECDH P-256 key pair** when creating or joining a session. When all parties have joined, the server distributes everyone's public keys and the session begins.

Each pair of participants derives a shared AES-256-GCM key:

```
ECDH(myPrivateKey, theirPublicKey) → sharedSecret
HKDF(SHA-256, sharedSecret, salt=sessionCode, info="od-relay-v1") → AES-256 key
```

Every message is encrypted individually for its recipient. Broadcast messages are encrypted N-1 times — once per peer — so each participant receives a uniquely encrypted copy.

ECDH private keys are generated with `extractable: false` in the Web Crypto API, meaning they never leave the browser's CryptoKey store, even to JavaScript.

## Session Fingerprint

To detect a man-in-the-middle attack (where the relay substitutes its own public keys), each participant's UI displays a **session fingerprint**:

```
SHA-256(sorted ECDH public keys) → first 8 hex characters
```

Signers should compare fingerprints out-of-band (e.g. read them aloud on a call). If they match, no key substitution occurred. If they differ, the session should be abandoned.

## Session Lifecycle

1. **Create:** Party 0 opens the ceremony app and creates a relay session, specifying how many participants are needed. The server returns a 6-character session code (e.g. `X7K2M9`).

2. **Join:** Other participants enter the session code (or click a shared link). As each party joins, all participants see an updated count.

3. **Ready:** Once all expected parties have joined, the server broadcasts everyone's ECDH public keys. Each client derives AES keys for all peers. The ceremony begins automatically.

4. **Exchange:** Ceremony data flows as encrypted relay messages. For threshold signing (3 rounds), this typically completes in under 30 seconds. For DKG (4 phases), it takes a few minutes.

5. **Done:** Participants close the session. The server cleans up automatically after 10 minutes of inactivity.

### Reconnection

If a signer's connection drops, the client automatically reconnects using a server-issued token (stored in the browser's session storage). Reconnection preserves the signer's party assignment and encryption keys.

If the browser tab is closed or refreshed, the ECDH private key is lost and cannot be recovered. The signer will see a "ceremony must restart" message. The remaining participants should close the session and start a new one.

## Offline Fallback

The relay is optional. Every ceremony that works via relay also works via manual copy-paste of encrypted blobs. The ceremony apps present both options:

- **Relay mode:** Create or join a session by code. Fully automated.
- **Offline mode:** Copy blobs from your screen, paste blobs from other participants. No server needed — works from `file://` with the downloadable offline HTML.

Signers who distrust the relay server (or whose network blocks WebSocket connections) can always use offline mode. The two modes can even be mixed within a group — some signers on relay, others exchanging blobs manually — though in practice this is uncommon.

## Server Details

The relay is a standalone Go binary (~5 MB) with no dependencies, no database, and no disk I/O. It holds sessions in memory and discards them after inactivity.

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Listen address | `:8080` | `RELAY_ADDR` |
| Max concurrent sessions | 50 | `RELAY_MAX_SESSIONS` |
| Max parties per session | 10 | `RELAY_MAX_PARTIES` |
| Max message size | 1 MB | `RELAY_MAX_MESSAGE` |
| Max connections per IP | 5 | `RELAY_MAX_PER_IP` |
| Ping interval | 30s | `RELAY_PING_INTERVAL` |
| Abandoned session cleanup | 600s | `RELAY_ABANDON_TIMEOUT` |

Source code: [`relay/`](https://github.com/mwaddip/orange-dollar/tree/master/relay)
