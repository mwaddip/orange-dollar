# Risk Factors

Orange Dollar is experimental software. This page describes known risks. Use the protocol only with funds you can afford to lose.

## Smart Contract Risk

The contracts have **not been formally audited**. While the codebase has comprehensive test coverage (72+ tests) and follows the formally verified Minimal Djed specification, undiscovered bugs could lead to loss of funds.

## WBTC Depeg Risk

OD's reserve holds WBTC, which is a wrapped representation of Bitcoin on OPNet. If the WBTC bridge or custodian fails, the reserve's value could drop regardless of Bitcoin's actual price.

## Oracle Manipulation

The TWAP oracle resists manipulation through its 6-block averaging window. However, if pool liquidity is very thin, a well-funded attacker could potentially influence the TWAP by maintaining a skewed price for the full window (~1 hour).

## Reserve Ratio Risk

If BTC drops sharply, the reserve ratio decreases. Below 400%, OD minting is blocked, but existing OD can still be burned. In an extreme scenario where the ratio drops below 100%, the reserve would be unable to cover all OD redemptions at face value.

## Threshold Key Custody

The PERMAFROST multisig requires 3 of 5 signers to act. If 3 or more signers lose their key shares or become permanently unavailable, administrative functions (like key rotation) would be permanently locked.

## OPNet Platform Risk

Orange Dollar runs on OPNet, which is itself a relatively new platform. Bugs or changes in the OPNet runtime could affect contract behaviour.
