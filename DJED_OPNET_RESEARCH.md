# Djed Stablecoin on OPNet — Research Notes

## Overview

Implement the Djed algorithmic stablecoin protocol (IOHK) on OPNet (Bitcoin L1). The design is trustless — no external oracle needed. Price discovery happens through DEX arbitrage, with the on-chain TWAP serving as the price signal.

**Reference paper**: "Djed: A Formally Verified Crypto-Backed Pegged Algorithmic Stablecoin" — Zahnentferner et al. (IOHK)

**Existing implementations** (for reference, not porting):
- SigmaUSD on Ergo (Minimal Djed)
- DJED on Cardano (by COTI, Extended Djed variant)

## Core Mechanism

Two tokens backed by a shared BTC reserve:

| Token | Role |
|-------|------|
| **Stablecoin (SC)** | Pegged to $1 USD, used as stable medium of exchange |
| **Reserve Coin (RC)** | Absorbs BTC volatility, earns fees, represents equity in the reserve |

### Operations

1. **Mint SC** — Deposit BTC, receive stablecoins at TWAP rate
2. **Burn SC** — Return stablecoins, receive BTC at TWAP rate
3. **Mint RC** — Deposit BTC, receive reserve coins (priced by equity/supply)
4. **Burn RC** — Return reserve coins, receive proportional share of excess reserves

### Reserve Ratio

```
reserve_ratio = total_reserve_btc / total_sc_liability_btc
```

Where `total_sc_liability_btc = sc_supply * (1 / twap_btc_usd)`.

**Bounds** (configurable, paper suggests):
- Minimum: 400% (below this, SC minting is blocked)
- Maximum: 800% (above this, RC minting is blocked)

**Gating rules:**
- SC minting blocked if reserve ratio would drop below minimum
- RC burning blocked if it would drop reserve ratio below minimum
- RC minting blocked if reserve ratio already above maximum
- SC burning is never blocked (users can always exit)

### RC Pricing

```
equity = total_reserve - sc_liability
rc_price = equity / rc_supply
```

If equity <= 0 or rc_supply == 0, RC price falls back to a configured minimum.

### Fees

Every mint/burn operation charges a fee (e.g., 1-2%) that goes into the reserve. This:
- Provides yield to RC holders
- Creates a buffer against small depeg events
- Discourages high-frequency mint/burn cycling

## Trustless Price Discovery (No Oracle)

The key insight: the contract does NOT need an external BTC/USD price oracle.

### How It Works

1. SC trades on an OPNet DEX against BTC (or a BTC-denominated pair)
2. The contract reads a **TWAP** (time-weighted average price) from the on-chain DEX pair
3. Arbitrageurs bring external price information on-chain:
   - SC trades **below** $1 on DEX → buy SC cheap on DEX, burn in contract for $1 of BTC → profit
   - SC trades **above** $1 on DEX → mint SC in contract for $1 of BTC, sell on DEX for more → profit
4. Arbitrage pressure keeps the DEX TWAP converging to $1
5. The contract's TWAP reference naturally reflects the real-world exchange rate

### Why This Is Trustless

- No oracle operator, no multi-sig, no trusted price feed
- The TWAP is derived from actual on-chain trades
- Anyone can arbitrage, so no single party controls the price
- Manipulation requires sustained capital against the entire arbitrage community
- The only assumption is sufficient DEX liquidity (a bootstrapping problem, not a trust problem)

### TWAP Implementation

- Track cumulative price over blocks (standard TWAP pattern)
- Window of ~1-2 hours (adjust for OPNet's ~10 min block time, so 6-12 blocks)
- Use the DEX pool's BTC/SC reserves to compute spot price per block
- TWAP smooths out short-term manipulation attempts

## Contract Architecture (OPNet)

### Contracts Needed

1. **DjedReserve** — Core reserve contract
   - Holds BTC reserves
   - Implements mint/burn logic for both SC and RC
   - Reads TWAP from DEX pair
   - Enforces reserve ratio bounds
   - Collects fees

2. **DjedStablecoin (OP-20)** — Standard fungible token for the stablecoin
   - Mintable/burnable by DjedReserve only

3. **DjedReserveCoin (OP-20)** — Standard fungible token for the reserve coin
   - Mintable/burnable by DjedReserve only

4. **DEX integration** — Needs an OPNet DEX with a BTC/SC liquidity pool
   - Could be an existing OPNet DEX if one exists
   - Or deploy a simple constant-product AMM (Uniswap v2 style) alongside

### Interface Sketch

```
DjedReserve:
  // Read
  getReserveRatio() → u256
  getScPrice() → u256          // TWAP-derived, BTC per SC
  getRcPrice() → u256          // equity / rc_supply
  getTotalReserve() → u256     // BTC in reserve
  getEquity() → u256           // reserve - liabilities
  getScSupply() → u256
  getRcSupply() → u256

  // Write (all require BTC payment via transaction value)
  mintSc()                     // send BTC, receive SC
  burnSc(amount: u256)         // send SC, receive BTC
  mintRc()                     // send BTC, receive RC
  burnRc(amount: u256)         // send RC, receive BTC

  // Config (owner-only)
  setMinReserveRatio(ratio: u256)
  setMaxReserveRatio(ratio: u256)
  setFee(fee: u256)
```

## Bootstrapping

The chicken-and-egg problem: DEX needs SC liquidity, SC needs DEX for price discovery.

### Bootstrap Sequence

1. **Deploy contracts** with an initial conservative reserve ratio
2. **Seed the reserve** — Initial RC minting by the team/early supporters (deposit BTC, get RC)
3. **Initial SC minting** — With BTC in reserve, mint initial SC supply at a fixed starting rate (e.g., current market BTC/USD)
4. **Create DEX pool** — Provide initial BTC/SC liquidity at the target $1 peg
5. **Open to public** — Arbitrageurs take over price discovery from here

The initial fixed rate is only needed for the bootstrap phase. Once the DEX has enough volume for meaningful TWAP data, the contract switches to TWAP-based pricing.

### Liquidity Incentives

- RC holders earn fees from every SC mint/burn
- DEX LP providers earn trading fees
- Early RC holders benefit most as the system scales (equity grows with fees)

## Minimal Djed vs Extended Djed

### Start With: Minimal Djed
- Simpler, well-understood (SigmaUSD has been running since 2021)
- Discrete operations (mint/burn at current TWAP)
- Fixed fee percentage
- Sufficient for a working stablecoin

### Future: Extended Djed
- Continuous pricing model
- Dynamic fees (increase when reserve ratio approaches bounds)
- Smoother UX but significantly more complex
- Can be added as a v2 upgrade

## OPNet-Specific Considerations

- **Block time**: ~10 minutes. TWAP window needs to account for this (fewer data points than EVM chains). A 6-12 block window = ~1-2 hours.
- **Transaction model**: OPNet uses Bitcoin's UTXO model with Tapscript-encoded calldata. BTC payments to the contract happen via transaction value, not a separate `deposit()` call.
- **Gas/fees**: Bitcoin transaction fees apply. Mint/burn operations should be gas-efficient to keep costs reasonable.
- **Token standard**: OP-20 for both SC and RC (OPNet's fungible token standard).
- **No `msg.value` equivalent**: Need to check how OPNet handles BTC value transfers to contracts — may need `setTransactionDetails()` pattern.

## Open Questions

1. **DEX availability**: Is there an existing OPNet DEX that can be used, or do we need to deploy an AMM?
2. **TWAP data source**: How to read DEX pool state from another contract on OPNet? Cross-contract calls?
3. **BTC value handling**: How does an OPNet contract receive and hold BTC? Need to verify the pattern for contracts that accept BTC payments.
4. **Minimum viable liquidity**: What DEX liquidity depth is needed for arbitrage to reliably maintain the peg? (Likely needs simulation/modeling)
5. **Fee parameters**: The paper provides analysis but optimal fees depend on expected volumes and BTC volatility.

## Resources

- [Djed paper (IOHK)](https://iohk.io/en/research/library/papers/djed-a-formally-verified-crypto-backed-pegged-algorithmic-stablecoin/)
- [SigmaUSD (Ergo implementation)](https://github.com/anon-real/sigma-usd)
- [Djed documentation (Cardano)](https://djed.xyz/)
- OPNet docs for OP-20 token standard and contract interaction patterns
