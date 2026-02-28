# What is Orange Dollar?

Orange Dollar (OD) is a **Bitcoin-native algorithmic stablecoin** running on [OPNet](https://opnet.org), a smart contract platform built directly on Bitcoin Layer 1.

OD is pegged to **$1 USD** and backed by **WBTC** (Wrapped Bitcoin) held in an on-chain reserve. The protocol uses the [Minimal Djed](https://iohk.io/en/research/library/papers/djed-a-formally-verified-crypto-backed-pegged-algorithmic-stablecoin/) algorithm — a formally verified stablecoin design by IOHK — to maintain its peg through overcollateralisation and algorithmic pricing.

## Two Tokens, One System

| Token | Role | Think of it as... |
|-------|------|-------------------|
| **OD** (Orange Dollar) | Stablecoin, pegged to $1 | A dollar bill backed by Bitcoin |
| **ORC** (Orange Reserve Coin) | Equity token, absorbs volatility | A share in the Bitcoin reserve |

**OD holders** get price stability. Mint OD by depositing WBTC; burn OD to redeem WBTC. The price is always determined by the on-chain TWAP oracle.

**ORC holders** absorb the Bitcoin price risk in exchange for earning protocol fees. Every mint and burn operation charges a 1.5% fee that stays in the reserve, increasing the equity that ORC represents.

## Key Properties

- **Overcollateralised:** The reserve always holds 4–8x the value of outstanding OD
- **Fully on-chain:** No off-chain oracles, no custodians, no trusted third parties
- **Bitcoin-native:** Settles directly on Bitcoin L1 via OPNet
- **Post-quantum secure:** Governance uses ML-DSA threshold signatures (PERMAFROST)
