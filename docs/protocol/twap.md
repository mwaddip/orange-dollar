# TWAP Oracle

The TWAP (Time-Weighted Average Price) oracle provides the BTC/USD price that the protocol uses for all calculations.

## How It Works

The oracle reads the **cumulative price accumulators** from the MotoSwap WBTC/OD trading pool — the same mechanism used by Uniswap V2. It computes a rolling average over a 6-block window:

```
TWAP = (currentCumulative - snapshotCumulative) / (currentBlock - snapshotBlock)
```

Each time the TWAP is queried and enough blocks have passed, the snapshot updates to maintain a rolling window.

## Why TWAP?

| Property | Benefit |
|----------|---------|
| **On-chain** | No trusted external oracles — fully verifiable |
| **Manipulation-resistant** | Attacker must sustain a fake price for 6 full blocks (~1 hour) |
| **No single point of failure** | Depends only on the MotoSwap pool existing |

## Parameters

| Parameter | Value |
|-----------|-------|
| Window | 6 blocks (~1 hour) |
| Source | MotoSwap WBTC/OD pool |
| Update | Automatic on each protocol interaction |

## Limitations

- The TWAP lags behind spot price by up to 1 hour
- Very thin liquidity pools are more susceptible to manipulation
- If the MotoSwap pool has no trading activity, the TWAP will be stale (but still usable)
