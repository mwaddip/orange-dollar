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

## Key Generation

The PERMAFROST key is generated via a **Distributed Key Generation (DKG) ceremony** using a dedicated ceremony app. Each signer receives an encrypted key share file that only they can decrypt with their password.

- Key shares never leave the signers' browsers
- Share files are encrypted with AES-256-GCM (PBKDF2 100k iterations)
- The public key is published; individual shares are never revealed

## Signing Process

When an admin action is needed, the signing flow works as follows:

1. **Propose:** One signer proposes the transaction on the cabal page. The transaction details (target contract, method, parameters) are displayed for all signers to verify.
2. **Round 1 — Commitments:** Each participating signer generates a commitment and shares it with the group.
3. **Round 2 — Responses:** Each signer generates a response using the collected commitments.
4. **Round 3 — Partial Signatures:** Each signer generates a partial signature. Once 3 partials are collected, they combine into a standard ML-DSA signature.
5. **Broadcast:** The combined signature is attached to the transaction and broadcast to the network.

The entire process uses copy-paste blob exchange — no server or real-time connection required.
