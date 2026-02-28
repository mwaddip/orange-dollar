# Admin Functions

Once the protocol is LIVE, the owner retains limited administrative capabilities. These are designed to be transferred to the [PERMAFROST multisig](/security/permafrost) for trustless governance.

## What the Owner Can Do

### Transfer Ownership

The owner can call `transferOwnership(newOwner)` on all three contracts (OD, ORC, ODReserve). This is how control transfers from a single deployer key to the PERMAFROST threshold key.

- **Repeatable:** Ownership can be transferred multiple times (for key rotation)
- **Emits event:** `OwnershipTransferred(previousOwner, newOwner)`
- **Applies to:** OD, ORC, and ODReserve independently

## What the Owner Cannot Do

The following parameters are **compile-time constants** and cannot be changed after deployment:

| Parameter | Fixed Value |
|-----------|-------------|
| Minimum reserve ratio | 400% |
| Maximum reserve ratio | 800% |
| Fee rate | 1.5% |
| TWAP window | 6 blocks |
| Token decimals | 8 |

The owner also **cannot**:
- Mint or burn tokens directly (only ODReserve can)
- Pause the protocol or revert to a previous phase
- Access or withdraw reserve funds
- Change the MotoSwap pool address after initPool

## After PERMAFROST Transfer

Once ownership transfers to the PERMAFROST threshold key, any admin action requires **3 of 5** signers to participate in a multi-round signing ceremony. No single individual can execute administrative functions.

See [PERMAFROST Multisig](/security/permafrost) for details on the signing process and signer identities.
