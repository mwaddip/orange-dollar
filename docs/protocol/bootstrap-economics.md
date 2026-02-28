# Bootstrap Economics

How to allocate investor WBTC when launching the OD protocol — what goes into the reserve, what goes into liquidity, and what investors get back.

## Three Buckets

Investor WBTC is split across three purposes:

| Bucket | Destination | Purpose |
|--------|-------------|---------|
| **Reserve** | ODReserve contract (via `seedReserve`) | Backs OD liabilities, generates ORC equity |
| **Liquidity** | MotoSwap WBTC/OD pool | Enables trading and powers the TWAP oracle |
| **ORC** | Distributed to investors | Equity tokens — the investment instrument |

## Recommended Split

**~85–90% reserve, ~10–15% liquidity. All preminted OD goes into the pool. All ORC goes to investors.**

### Worked Example

10 WBTC raised from investors at $100k/BTC = $1M total.

| Allocation | Amount | Value |
|------------|--------|-------|
| Reserve (seedReserve) | 9 WBTC | $900k |
| Liquidity (MotoSwap pool) | 1 WBTC | $100k |
| Premint OD (paired with liquidity WBTC) | 100,000 OD | $100k |
| **Starting reserve ratio** | | **900%** |
| **Equity (ORC value)** | | **$800k** |

The 1.5% fee applies to the ORC seed mint, so depositing 9 WBTC yields ORC worth ~$886.5k after fees. The fee stays in the reserve, further strengthening collateralisation.

## Why All OD Goes Into the Pool

OD is a stablecoin pegged to $1. Distributing it to investors doesn't make sense:

- **It's not an investment.** Holding OD is holding dollars — there's no upside.
- **It creates sell pressure.** Investors who receive OD they don't need will sell it, pushing the price below peg before the protocol has organic demand.
- **The pool needs it.** The TWAP oracle reads prices from the MotoSwap WBTC/OD pool. Without sufficient OD liquidity, the oracle is thin and easier to manipulate.

Premint exactly enough OD to pair with the liquidity WBTC at $1 peg, then deposit both into the pool.

## Why ORC Is the Right Instrument for Investors

ORC is equity in the WBTC reserve. It's the token that captures value:

- **Fee capture.** Every mint and burn (OD or ORC) charges 1.5%. These fees accumulate in the reserve, increasing the WBTC backing per ORC.
- **BTC upside.** ORC absorbs the volatility that OD holders are protected from. If BTC goes up, ORC goes up.
- **Protocol growth.** As more users mint OD, more WBTC enters the reserve. ORC holders benefit from the growing collateral pool.

Investors receive ORC pro-rata to their WBTC contribution.

## Why a High Starting Ratio Is Fine

A 900% starting ratio is well above the 800% ORC-mint cap. This means post-launch ORC minting is temporarily blocked — and that's by design:

- **Strong collateralisation at launch.** OD is backed 9:1 from day one, making early redemptions completely safe.
- **Natural convergence.** As users mint OD, each mint adds WBTC to the reserve but increases OD liabilities. The ratio gradually falls toward the 400–800% operating band.
- **Once the ratio drops below 800%**, new ORC can be minted on the open market, diluting equity — but by then the protocol has proven traction.
- **Early investors benefit** from being the only ORC holders during the high-ratio period, capturing all fees with no dilution.

## LP Tokens

The LP tokens from adding WBTC + OD to MotoSwap should remain with the protocol. They are infrastructure, not investment:

- Withdrawing liquidity would reduce pool depth and weaken the TWAP oracle.
- The LP tokens can be held by the deployer (pre-PERMAFROST) or governed by the multisig (post-transfer).
- Burning the LP tokens is also an option — it makes the liquidity permanent and irrevocable.

## Summary

| What | Goes where |
|------|------------|
| ~85–90% of raised WBTC | Reserve (`seedReserve`) |
| ~10–15% of raised WBTC | MotoSwap pool (paired with OD) |
| All preminted OD | MotoSwap pool (paired with WBTC) |
| All ORC | Investors (pro-rata) |
| LP tokens | Protocol (held or burned) |

The result: investors hold ORC (equity with fee yield and BTC upside), the pool has enough depth for reliable TWAP pricing, and OD launches with a wide collateralisation margin.
