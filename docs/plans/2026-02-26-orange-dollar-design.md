# Orange Dollar (OD) — System Design

**Date:** 2026-02-26
**Based on:** Djed: A Formally Verified Crypto-Backed Pegged Algorithmic Stablecoin (Zahnentferner et al., IOHK)
**Variant:** Minimal Djed
**Platform:** OPNet (Bitcoin L1)

---

## Overview

Orange Dollar (OD) is an algorithmic stablecoin pegged to $1 USD, deployed on OPNet. It is backed by WBTC (a custodied OP-20 representation of BTC) held in a shared reserve. A second token, Orange Reserve Coin (ORC), represents equity in the reserve and absorbs BTC price volatility in exchange for fee yield.

The system is trustless after bootstrap. Price discovery uses a TWAP derived from a MotoSwap WBTC/OD liquidity pool — no external oracle operator.

---

## Tokens

| Token | Symbol | Standard | Description |
|-------|--------|----------|-------------|
| Orange Dollar | OD | OP-20 | Stablecoin pegged to $1 USD |
| Orange Reserve Coin | ORC | OP-20 | Reserve equity token |

Both are mintable and burnable exclusively by ODReserve. No other address may call `mint()` or `burn()`.

---

## Contracts

### OD (OP-20)

Standard OP-20 token with access-controlled `mint(to, amount)` and `burn(from, amount)`. ODReserve address is set at construction and stored immutably.

### ORC (OP-20)

Identical structure to OD. ODReserve address is set at construction and stored immutably.

### ODReserve

Core protocol contract. Responsibilities:
- Holds WBTC reserve (OP-20 balance)
- Reads TWAP from MotoSwap WBTC/OD pool via cross-contract call
- Enforces reserve ratio bounds on all operations
- Mints and burns OD and ORC
- Collects fees into the reserve
- Manages the bootstrap state machine

---

## Reserve Mechanics

### Reserve Ratio

```
equity         = reserve_wbtc * twap                  // reserve value in OD terms (USD)
od_liability   = od_supply                             // 1 OD = $1, so liability = supply
reserve_ratio  = equity / od_liability
```

Scaled to `1e8` in u256 arithmetic (400% = `4_00000000u`).

**Bounds:**
- Minimum: 400% — below this, OD minting and ORC burning are blocked
- Maximum: 800% — above this, ORC minting is blocked

### RC Pricing

```
equity    = reserve_wbtc * twap - od_supply   // excess reserve in OD terms
rc_price  = equity / orc_supply               // OD per ORC
```

If `equity <= 0` or `orc_supply == 0`, RC price falls back to a configured minimum floor (set at deployment).

### Operations and Gating

| Operation | User Action | Receives | Blocked When |
|-----------|-------------|----------|--------------|
| `mintOD(wbtcIn)` | Deposit WBTC | OD at TWAP rate | ratio would drop below 400% |
| `burnOD(odIn)` | Return OD | WBTC at TWAP rate | Never blocked |
| `mintORC(wbtcIn)` | Deposit WBTC | ORC at equity price | ratio already above 800% |
| `burnORC(orcIn)` | Return ORC | WBTC proportional to equity | ratio would drop below 400% |

### Fees

Flat percentage deducted from the output of every operation. The fee stays in the reserve, accruing to ORC holders as equity.

| Operation | Default Fee |
|-----------|-------------|
| mintOD | 1.5% |
| burnOD | 1.5% |
| mintORC | 1.5% |
| burnORC | 1.5% |

Owner may adjust fees post-deploy. Hard cap: 5%. Fee changes are immediate (no timelock required for v1).

**Fee application example — mintOD:**
```
wbtc_value_in_od = wbtcIn * twap
fee              = wbtc_value_in_od * fee_rate / 1e8
od_out           = wbtc_value_in_od - fee
```
The full `wbtcIn` enters the reserve; OD issued is reduced by the fee amount.

---

## TWAP

### Why TWAP, Not Spot

Spot price is vulnerable to flashloan manipulation and, on OPNet's ~10-minute block time, to multi-block price suppression attacks. A TWAP averaged over multiple blocks is significantly harder to sustain-manipulate at economic cost.

### Source

MotoSwap WBTC/OD pool — a standard Uniswap v2-style AMM. Pools expose `price0CumulativeLast()` and `price1CumulativeLast()` accumulators. ODReserve reads these via `Blockchain.call()`.

### Computation

ODReserve stores a snapshot `(cumulativePrice, blockNumber)` updated lazily on each operation when the window has elapsed.

```
twap = (currentCumulative - snapshotCumulative) / (currentBlock - snapshotBlock)
```

**Window:** 6 blocks (~1 hour at 10-minute block time).

### Tradeoff

6 blocks is a thin window by EVM standards. It provides meaningful manipulation resistance while keeping price responsiveness reasonable for a first deploy. This parameter is configurable at deployment and can be increased as the pool matures.

---

## Bootstrap State Machine

ODReserve operates in three sequential phases. Phase transitions are irreversible.

### Phase 1: SEEDING

- Only `mintORC()` is permitted
- Owner sets the initial WBTC/USD price (`seedPrice`) used during premint
- Investors deposit WBTC and receive ORC, building the reserve
- OD operations are blocked

### Phase 2: PREMINT

- Owner calls `premintOD(amount)` exactly once
- OD is minted to the owner's address at `seedPrice`
- Amount is bounded: resulting reserve ratio must remain above 400%
- Purpose: seed initial WBTC/OD liquidity on MotoSwap
- Owner then creates the MotoSwap WBTC/OD pool and deposits preminted OD + WBTC as initial liquidity

### Phase 3: LIVE

- Triggered automatically once the TWAP window has accumulated at least 6 blocks of data from the MotoSwap pool
- All four operations become available
- `seedPrice` is discarded; TWAP is the sole price source
- `premintOD` is permanently disabled

### Transition Summary

```
SEEDING  →  PREMINT  →  LIVE (auto, once TWAP window fills)
         ↑ owner      ↑ automatic
```

---

## Adaptations from the Djed Paper

The Minimal Djed spec is followed exactly for all mathematical invariants. Two adaptations are made for OPNet/Bitcoin constraints:

| Paper | OD | Reason |
|-------|----|--------|
| Reserve = native chain currency | Reserve = WBTC (OP-20) | Contracts cannot custody native BTC on OPNet |
| Price oracle = external signed feed | Price oracle = MotoSwap TWAP | Trustless, fully on-chain |

The paper is agnostic about the reserve asset. WBTC is the closest faithful equivalent to BTC that OPNet contracts can hold. The TWAP oracle is more faithful to the paper's trustless intent than a signed feed would be.

---

## Deployment Sequence

1. Deploy WBTC address is confirmed (provided by official WBTC custodians on OPNet)
2. Deploy OD token contract (ODReserve address provided at construction)
3. Deploy ORC token contract (ODReserve address provided at construction)
4. Deploy ODReserve (OD address, ORC address, WBTC address, MotoSwap factory address, fee rate, min/max ratio, TWAP window)
5. Investors call `mintORC()` to seed the reserve (SEEDING phase)
6. Owner sets `seedPrice`, calls `advancePhase()` → enters PREMINT
7. Owner calls `premintOD(amount)` → OD minted to owner
8. Owner creates MotoSwap WBTC/OD pool, deposits initial liquidity
9. Wait 6 blocks for TWAP to accumulate → system transitions to LIVE automatically
10. Public operations open

---

## Decimal Precision

| Asset | Decimals | Unit |
|-------|----------|------|
| WBTC | 8 | satoshi |
| OD | 8 | micro-OD |
| ORC | 8 | micro-ORC |
| Reserve ratio | 8 (scaled) | 1e8 = 100% |
| Fees | 8 (scaled) | 1e8 = 100% |
| TWAP | 8 | OD per WBTC satoshi |

All arithmetic uses `SafeMath` u256. No raw `+`, `-`, `*`, `/` on u256 values.

---

## Out of Scope (v1)

- Frontend / UI
- Extended Djed variant (dynamic fees, continuous pricing)
- WBTC bridge / wrapper (provided by official OPNet WBTC custodians)
- Fee governance / DAO
- Upgradeable contracts
