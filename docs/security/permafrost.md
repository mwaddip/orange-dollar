# PERMAFROST Multisig

PERMAFROST is the account-level threshold multisig system used to govern the Orange Dollar protocol. After bootstrap, ownership of all three contracts (OD, ORC, ODReserve) is transferred to a PERMAFROST threshold key.

## How It Works

PERMAFROST uses **ML-DSA** (Module-Lattice Digital Signature Algorithm), a post-quantum signature scheme standardised by NIST. The threshold variant requires **3 of 5** signers to produce a valid signature.

| Parameter | Value |
|-----------|-------|
| Signature scheme | ML-DSA-44 (NIST Level 2) |
| Threshold | 3 of 5 |
| Security | 128-bit (post-quantum) |
| Signature size | 2,420 bytes |
| On-chain appearance | Indistinguishable from single-signer ML-DSA |

## What PERMAFROST Controls

After ownership transfer, the PERMAFROST key is the owner of OD, ORC, and ODReserve. This means **3 of 5 signers must agree** to:

- Transfer ownership to a new key (key rotation)
- Execute any future owner-only functions

No single signer can act alone. The signing process requires multiple rounds of interaction between signers.

## Signers

| # | Name | Role | Contact |
|---|------|------|---------|
| 1 | *TBD* | — | — |
| 2 | *TBD* | — | — |
| 3 | *TBD* | — | — |
| 4 | *TBD* | — | — |
| 5 | *TBD* | — | — |

::: info
Signer identities will be published here once the DKG ceremony is complete and the key is generated.
:::

## Key Generation (DKG Ceremony)

The PERMAFROST key is generated via a **Distributed Key Generation (DKG) ceremony** using a dedicated ceremony app at [signing.odol.cash](https://signing.odol.cash). All 5 signers participate simultaneously, and the ceremony produces:

- A **combined ML-DSA-44 public key** that goes on-chain as the contract owner
- An **encrypted key share file** for each signer (AES-256-GCM, PBKDF2 100k iterations)

Key shares never leave the signers' browsers. The combined public key is published; individual shares are never revealed. If a signer loses their share file or password, that share is unrecoverable.

The DKG ceremony uses a 4-phase protocol where signers exchange commitments, encrypted shares, public key components, and verification data. Each phase requires all N participants.

### Relay vs Offline Mode

The ceremony app supports two transport modes:

- **Relay mode:** Signers connect to an [encrypted WebSocket relay](/security/relay) and exchange data automatically in real time. One signer creates a session and shares the session code; others join with the code.
- **Offline mode:** Signers manually copy and paste encrypted data blobs. Suitable when signers cannot be online simultaneously, but significantly slower.

Both modes produce identical results. The relay is a convenience layer — all cryptographic operations happen locally in the browser regardless of transport.

## Signing Process

When an admin action is needed (e.g. transferring contract ownership, executing an owner-only function), any 3 of the 5 signers coordinate via the **cabal page** at [cabal.odol.cash](https://cabal.odol.cash).

### Step-by-step

1. **Select the action:** One signer opens the cabal page, selects the governance step from the menu (e.g. "Transfer Ownership", "Advance Phase"), and enters any required parameters. The transaction details — target contract, method, and parameters — are displayed for all signers to verify.

2. **Load key shares:** Each participating signer loads their encrypted share file and enters their password to decrypt it.

3. **Three signing rounds:**
   - **Round 1 — Commitments:** Each signer generates a cryptographic commitment.
   - **Round 2 — Responses:** Each signer generates a response using the collected commitments.
   - **Round 3 — Partial signatures:** Each signer produces a partial signature. Once 3 partials are collected, they automatically combine into a valid ML-DSA signature.

4. **Submit:** The combined signature and message hash are submitted to the cabal server, which attaches the signature to the transaction and broadcasts it to the OPNet network.

### Relay vs Offline Signing

Just like key generation, signing supports both transport modes:

- **Relay mode (recommended):** One signer creates a relay session, shares the code. Once all T signers join, the session starts automatically. Blobs are exchanged in real time — each round completes as soon as all participants have generated their output. A typical 3-of-5 signing session takes under 30 seconds.

- **Offline mode:** Signers copy and paste encrypted blobs manually (e.g. via Signal, email, or in person). One signer proposes and shares the proposal blob; others join and share theirs. Three rounds of exchange are required.

Both modes use the same underlying cryptography. See [Encrypted Relay](/security/relay) for how the relay preserves trust-minimisation.

### Verifying Before You Sign

Before decrypting their share and signing, each signer should independently verify:

- The **target contract** address matches the expected OD, ORC, or ODReserve contract
- The **method name** matches the intended operation
- The **parameters** are correct (e.g. the new owner address for a transfer)
- In relay mode, the **session fingerprint** (displayed in the UI) matches across all participants — a mismatch indicates a potential man-in-the-middle attack

Signers who disagree with a proposed action simply decline to participate. Without 3 signatures, the transaction cannot proceed.
