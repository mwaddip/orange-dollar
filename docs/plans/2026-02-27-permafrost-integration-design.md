# PERMAFROST Integration Design

**Date:** 2026-02-27
**Status:** Approved

## Overview

Replace the single-key deployer/owner of OD contracts with a 3-of-5 PERMAFROST threshold ML-DSA key. Provide a web-based DKG ceremony tool for key generation and integrate multi-party signing into the cabal admin page for bootstrap and admin operations.

## Architecture

Three workstreams:

1. **Ceremony app** (`ceremony.odol.org`) — standalone static site for one-time DKG key generation
2. **Contract changes** — add `transferOwnership()` to OD, ORC, ODReserve
3. **Cabal signing integration** — multi-party signing flow on the existing admin page

### Lifecycle

```
DKG Ceremony (once)          Deploy contracts            Bootstrap (cabal page)
─────────────────           ─────────────────           ────────────────────────
5 parties run 4-phase  →    Deploy with single key  →   transferOwnership() to
DKG via copy-paste.         (same deploy.ts).           PERMAFROST key. Then
Output: 1 ML-DSA public     Bootstrap with single       all future admin calls
key + 5 key shares.         key until transfer.         require 3-of-5 signing.
Each party downloads                                    Initiator proposes tx,
their encrypted share.                                  co-signers contribute
                                                        rounds via copy-paste.
```

Key shares never leave the participant's browser. No server, no database.

## Threshold Parameters

- **T = 3, N = 5** (3-of-5)
- **ML-DSA-44** (NIST Level 2, 128-bit security)
- Signature size: 2,420 bytes (standard FIPS 204, indistinguishable from single-signer)

## Dependency

`@btc-vision/post-quantum` — btc-vision fork of noble-post-quantum. Install from GitHub (`btc-vision/noble-post-quantum`) until threshold module is published to npm. Exports `ThresholdMLDSA` from `./threshold-ml-dsa.js`.

## DKG Ceremony App

### Standalone static site

Same React/Vite stack as the main app. Hosted at `ceremony.odol.org`. One-time use, reusable if keys need rotating or group membership changes.

### Session creation

Initiator picks parameters (T=3, N=5, level=44) and creates a session. Gets a session ID to share with the other 4 parties. Session state lives in the initiator's browser — no server.

### 4-phase copy-paste flow

Uses trusted dealer `keygen()` initially (simpler, well-tested API). Dealerless DKG is a future upgrade.

| Phase | What each party does | Output |
|-------|---------------------|--------|
| 1 — Commit | Generate entropy, produce commitment hash | Public blob → share with everyone |
| 2 — Reveal | Reveal rho + private bitmask seeds | Public blob + per-recipient private blobs |
| 3 — Masks | Generators send mask pieces | Per-recipient private blobs |
| 4 — Aggregate | Compute local aggregate, broadcast | Public blob → share with everyone |

For each phase, the page shows:
- Paste box for incoming blobs from other parties
- "Generate" button to produce this party's output
- Output blob with "Copy" button
- Private messages labeled "Send to Party X only"

Participants share blobs via Signal, DM, email — whatever secure channel they prefer.

### Completion

After Phase 4, the page:
1. Displays the aggregated ML-DSA public key (the PERMAFROST address)
2. Downloads an encrypted share file per party

### Share file format

Filename: `permafrost-share-{partyId}-{publicKeyPrefix}.json`

```json
{
  "version": 1,
  "publicKey": "<hex, unencrypted — not secret>",
  "partyId": 2,
  "threshold": 3,
  "parties": 5,
  "level": 44,
  "encrypted": "<AES-256-GCM encrypted ThresholdKeyShare>"
}
```

- Public key is unencrypted so the page can display identity without asking for password
- Share data encrypted with AES-256-GCM using a password the party chooses
- Party is warned: "If you lose this file and your password, your share is gone forever."

### Trusted dealer keygen (v1)

For v1, the ceremony uses `ThresholdMLDSA.keygen()` which runs entirely in the initiator's browser. The initiator generates all 5 shares, each participant downloads their encrypted share, and the seed is destroyed.

This requires trusting the initiator during key generation. Dealerless DKG (4-phase protocol from the whitepaper) is a future upgrade that eliminates this trust assumption.

## Contract Changes

### `transferOwnership(newOwner: Address)`

Added to all three contracts: OD, ORC, ODReserve.

- **Access:** owner-only (`Blockchain.tx.origin == owner`)
- **Repeatable:** can be called multiple times (not one-shot). The current PERMAFROST group can transfer to a new key when membership changes.
- **Effect:** updates the stored `owner` to `newOwner`
- **Events:** emits `OwnershipTransferred(previousOwner, newOwner)`

### Deployment flow

1. Deploy contracts with single key (existing `deploy.ts`)
2. Bootstrap through SEEDING → PREMINT → LIVE with single key
3. Call `transferOwnership(permafrostPublicKey)` on all three contracts
4. From this point, all admin operations require 3-of-5 threshold signing

## Cabal Signing Integration

### Existing step cards gain a new mode

After ownership transfer, the cabal page detects that the connected wallet is not the owner (the PERMAFROST key is). Step cards show a "Threshold Sign" flow instead of direct execution.

### 3-round signing protocol

| Round | Initiator | Co-signers |
|-------|-----------|------------|
| 1 | Imports share file, clicks "Propose Step X". Page simulates tx, runs `round1()`. Produces **signing request** (tx details + commitment hash). Shares blob. | Open cabal, click "Co-sign", paste signing request, import share file. Run `round1()`. Produce commitment hash blob. Share back. |
| 2 | Collect 3 commitment hashes, run `round2()`. Produce commitment blob. Share. | Collect 3 hashes, run `round2()`. Produce commitment blob. Share back. |
| 3 | Collect 3 commitments, run `round3()`. Produce partial response. Run `combine()` → standard ML-DSA signature. Click "Broadcast". | Collect 3 commitments, run `round3()`. Produce partial response. Share back. |

### UX elements on cabal page

- **"Propose" button** — initiator starts the flow for a specific step
- **"Co-sign" tab** — co-signers paste signing requests and step through rounds
- **Import share** — file picker + password field, persisted in session (memory only)
- **Per-round UI:** paste box for incoming, output box for outgoing, copy button
- **Tx verification:** co-signers see decoded tx details (step name, parameters, target contract) so they know what they're signing
- **"Broadcast" button** — appears after combine produces valid signature

### Fallback

Single-signer flow remains for pre-transfer testing and regtest development.

## Not In Scope (Future)

- **Dealerless DKG** — upgrade ceremony from trusted dealer to 4-phase distributed protocol
- **Key rotation / share refresh** — proactive security without re-running full DKG
- **DAO governance** — PERMAFROST key is a stepping stone; eventually may be replaced by on-chain governance
- **WebRTC real-time coordination** — could replace copy-paste for better UX
- **Hardware wallet integration** — share storage on hardware devices

## Security Considerations

- Key shares never transmitted to any server
- Share files encrypted at rest with user-chosen password
- Threshold signing happens entirely in-browser
- Transaction details displayed to co-signers before signing (no blind signing)
- `transferOwnership` is repeatable — group can rotate keys
- Trusted dealer keygen (v1) requires trusting the initiator; dealerless DKG (v2) removes this
