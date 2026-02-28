# Djed Formalism

Orange Dollar implements **Minimal Djed**, a formally verified algorithmic stablecoin protocol designed by IOHK (the team behind Cardano).

## The Paper

> *"Djed: A Formally Verified Crypto-Backed Pegged Algorithmic Stablecoin"*
> — Zahnentferner, Kaidalov, Etit, Diaz (2021)

The paper provides mathematical proofs that Minimal Djed maintains its peg under defined conditions, including guarantees about reserve adequacy and the ability to always redeem stablecoins.

## Key Invariants

1. **Peg maintenance:** As long as the reserve ratio stays above the minimum, every OD token can be redeemed for its face value in WBTC
2. **Reserve floor:** The 400% minimum ratio ensures the reserve always exceeds OD liabilities by a wide margin
3. **Fee accumulation:** Fees collected from operations strictly increase the reserve, strengthening collateralisation over time

## Adaptations

Orange Dollar adapts Minimal Djed for Bitcoin:

| Paper | OD Implementation | Reason |
|-------|-------------------|--------|
| Reserve in native currency | Reserve in WBTC (OP-20) | OPNet contracts can't custody native BTC |
| External price oracle | MotoSwap TWAP | Fully on-chain, no trusted feeds |
| Generic blockchain | OPNet (Bitcoin L1) | Bitcoin-native settlement |
