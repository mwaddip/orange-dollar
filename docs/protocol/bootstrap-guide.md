# Bootstrap Guide

This is a step-by-step walkthrough of bootstrapping the OD protocol from empty contracts to a fully live system.

## The Big Picture

OD is a Djed stablecoin. The reserve holds WBTC. Two tokens are minted against it: **OD** (stablecoin, pegged $1) and **ORC** (equity token, absorbs volatility, earns fees). The bootstrap takes the system from "empty contracts" to "fully live protocol where anyone can mint/burn."

---

## Step 0 — setReserve on OD & ORC

**What it does:** Tells the OD and ORC token contracts "this is your reserve — only this address can call `mint()` and `burn()` on you."

**Why it's separate from deployment:** OD and ORC are deployed *before* ODReserve (because ODReserve's constructor needs their addresses). So at deployment time, the reserve address doesn't exist yet. This is the chicken-and-egg resolution: deploy OD, deploy ORC, deploy ODReserve, then call back into OD/ORC to register it.

**It's one-shot.** Once set, it can never be changed. This is the security guarantee — no one can ever redirect minting authority.

---

## Step 1 — Seed the Reserve (mintORC)

**What it does:** You deposit WBTC into the reserve and receive ORC tokens in return. This is the initial capitalisation — building the collateral pool that backs everything.

**How ORC pricing works on first mint:** Since there's no existing ORC supply and no price reference yet, the contract uses a simple 1:1 ratio — 1 WBTC in = 1e8 ORC out (matching 8-decimal precision). This is just an initial anchor; the real ORC price is determined by equity later.

**The 1.5% fee applies** even here — so depositing 1 WBTC (100,000,000 sats) yields 98,500,000 ORC.

**What's sensible:** The seed amount determines how robust the reserve starts. With 1 WBTC (~$100k), you're putting up $100k of collateral. This needs to be enough to cover the preminted OD liability at >400% ratio, leave enough for pool liquidity, and have a meaningful buffer.

---

## Step 2 — Advance Phase (advancePhase)

**What it does:** Transitions from SEEDING to PREMINT and locks in the `seedPrice`.

**What is seedPrice?** It's the assumed BTC/USD price used for preminting OD, expressed in 1e8 scale. Since there's no TWAP yet (no pool exists), the contract needs *some* price to calculate how much OD to allow.

**The math:** `seedPrice` = dollars per WBTC x 1e8. So $100,000 BTC = 10,000,000,000,000.

**What's sensible:** Use the current market price. If you set it too high, you'd premint too much OD relative to the reserve. If you set it too low, you premint less OD and need more WBTC for pool liquidity.

**Irreversible.** Once advanced, you can't go back to SEEDING.

---

## Step 3 — Premint OD (premintOD)

**What it does:** Mints OD tokens to the deployer's address. This OD doesn't exist yet — you're creating it from nothing, backed by the WBTC reserve, at the seedPrice rate.

**Why:** You need OD tokens to create the WBTC/OD liquidity pool. But you can't mint OD the normal way (via mintOD) because that requires a TWAP, which requires a pool, which requires OD. Premint breaks this circular dependency.

**The ratio guard:** The contract enforces that after preminting, `reserveWbtc x seedPrice / odAmount >= 400%`. So you can't mint more OD than your reserve supports.

**Default calculation:** Targets a ~500% reserve ratio. With 1 WBTC at $100k seed price, premint = $100,000 / 5 = $20,000 worth of OD.

**One-shot.** Can only be called once, ever.

---

## Step 4 — Approve Router

**What it does:** Standard OP-20 allowance grants. The MotoSwap router needs permission to pull WBTC and OD from your wallet to create the pool.

---

## Step 5 — Create MotoSwap Pool

**What it does:** Calls the MotoSwap factory to deploy a new Uniswap V2-style AMM pool for the WBTC/OD trading pair.

**Why it matters:** This pool is the oracle. ODReserve reads its cumulative price accumulators to compute the TWAP. No pool = no price = system can't go live.

---

## Step 6 — Add Initial Liquidity

**What it does:** Deposits WBTC + OD into the pool, establishing the initial price.

**The initial price is set by the ratio of tokens deposited.** With 0.1 WBTC and $10,000 OD at $100k BTC, the pool prices 1 WBTC = 100,000 OD = $100,000.

**What's sensible:** More liquidity = less slippage and better TWAP accuracy. For testnet, the defaults (0.1 WBTC) are fine. For mainnet, deeper liquidity is recommended.

---

## Step 7 — Register Pool (initPool)

**What it does:** Tells ODReserve the pool address. The contract then determines token ordering and takes the initial TWAP snapshot.

**After this, the TWAP clock starts ticking.** The contract now has its first data point.

---

## Step 8 — Wait for TWAP Window (6 blocks)

**What happens:** You wait. The TWAP requires at least 6 blocks of price data between two snapshots.

**On OPNet testnet:** ~10 min per block = ~1 hour wait.

**The automatic LIVE transition:** After 6+ blocks pass, the next call to any function that reads the TWAP will compute the valid average, update the stored TWAP, and transition the protocol to LIVE.

From that point, all four operations are available to anyone. The seedPrice is never used again — TWAP is the sole price source.

---

## Default Parameters

| Parameter | Default | What it means |
|-----------|---------|---------------|
| Seed WBTC | 1 WBTC (1e8 sats) | Initial reserve capitalisation |
| Seed Price | $100,000 (1e13) | Assumed BTC price for premint math |
| Premint OD | ~$20k OD (auto) | Targets 500% reserve ratio |
| Liquidity WBTC | 0.1 WBTC | Pool depth (WBTC side) |
| Liquidity OD | ~$10k OD (auto) | Pool depth (matches seed price) |

For testnet, the deployer needs: 1 WBTC (for seeding) + 0.1 WBTC (for liquidity) = 1.1 WBTC from the faucet, plus some BTC for transaction fees.
