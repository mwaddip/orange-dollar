# Reserve Ratio

The reserve ratio is the core health metric of the Orange Dollar protocol. It measures how much WBTC collateral backs each dollar of outstanding OD.

## Formula

```
reserve ratio = (reserve WBTC x TWAP price) / OD supply
```

A ratio of 500% means the reserve holds $5 in WBTC for every $1 of OD in circulation.

## Bounds

| Bound | Value | Effect |
|-------|-------|--------|
| **Minimum** | 400% | OD minting and ORC burning are blocked below this |
| **Maximum** | 800% | ORC minting is blocked above this |

These bounds are compile-time constants — they cannot be changed by the owner or any governance action.

## What Moves the Ratio

| Event | Effect on Ratio |
|-------|----------------|
| BTC price rises | Ratio increases (reserve worth more) |
| BTC price falls | Ratio decreases (reserve worth less) |
| User mints OD | Ratio decreases (more liabilities) |
| User burns OD | Ratio increases (fewer liabilities) |
| User mints ORC | Ratio increases (more WBTC in reserve) |
| User burns ORC | Ratio decreases (WBTC withdrawn) |
| Fees collected | Ratio increases slightly (more WBTC, same liabilities) |

## Why 400%?

400% overcollateralisation provides a large safety buffer. Even if BTC drops 75% from its price at the time of minting, the reserve can still cover all OD redemptions. The Minimal Djed paper provides formal proofs that the peg is maintained as long as the ratio stays above the minimum.
