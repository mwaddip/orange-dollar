# OD Bootstrap Guide

## The Big Picture

OD is a Djed stablecoin. The reserve holds WBTC. Two tokens are minted against it: **OD** (stablecoin, pegged $1) and **ORC** (equity token, absorbs volatility, earns fees). The bootstrap takes the system from "empty contracts" to "fully live protocol where anyone can mint/burn."

---

## Step 0 — `setReserve` on OD & ORC

**What it does:** Tells the OD and ORC token contracts "this is your reserve — only this address can call `mint()` and `burn()` on you."

**Why it's separate from deployment:** OD and ORC are deployed *before* ODReserve (because ODReserve's constructor needs their addresses). So at deployment time, the reserve address doesn't exist yet. This is the chicken-and-egg resolution: deploy OD → deploy ORC → deploy ODReserve → call back into OD/ORC to register it.

**It's one-shot.** Once set, it can never be changed. This is the security guarantee — no one can ever redirect minting authority.

**Values:** Just the ODReserve contract address. Nothing to configure.

---

## Step 1 — Seed the Reserve (`mintORC`)

**What it does:** You deposit WBTC into the reserve and receive ORC tokens in return. This is the initial capitalisation — building the collateral pool that backs everything.

**How ORC pricing works on first mint:** Since there's no existing ORC supply and no price reference yet, the contract uses a simple 1:1 ratio — 1 WBTC in = 1e8 ORC out (matching 8-decimal precision). This is just an initial anchor; the real ORC price is determined by equity later.

**The 1.5% fee applies** even here — so depositing 1 WBTC (100,000,000 sats) yields 98,500,000 ORC.

**What's sensible:** The seed amount determines how robust the reserve starts. With `SEED_WBTC_AMOUNT=100000000` (1 WBTC, ~$100k), you're putting up $100k of collateral. This needs to be enough to:
- Cover the preminted OD liability at >400% ratio
- Leave enough for pool liquidity
- Have a meaningful buffer

For testnet, 1 WBTC from the faucet is fine. For mainnet, the seed determines your starting capital efficiency — more WBTC = higher ratio = more room for OD minting before hitting the 400% floor.

---

## Step 2 — Advance Phase (`advancePhase`)

**What it does:** Transitions from SEEDING → PREMINT and locks in the `seedPrice`.

**What is `seedPrice`?** It's the assumed BTC/USD price used for preminting OD, expressed in 1e8 scale. Since there's no TWAP yet (no pool exists), the contract needs *some* price to calculate how much OD to allow. You're saying "I assert that 1 WBTC = $X."

**The math:** `seedPrice` = dollars per WBTC × 1e8. So $100,000 BTC = `100_000 × 100_000_000 = 10_000_000_000_000`.

**What's sensible:** Use the current market price. If you set it too high, you'd premint too much OD relative to the reserve (risky low ratio). If you set it too low, you premint less OD and need more WBTC for pool liquidity to match. The defaults use $100,000.

**Irreversible.** Once advanced, you can't go back to SEEDING.

---

## Step 3 — Premint OD (`premintOD`)

**What it does:** Mints OD tokens to the deployer's address. This OD doesn't exist yet — you're creating it from nothing, backed by the WBTC reserve, at the `seedPrice` rate.

**Why:** You need OD tokens to create the WBTC/OD liquidity pool. But you can't mint OD the normal way (via `mintOD`) because that requires a TWAP, which requires a pool, which requires OD. Premint breaks this circular dependency.

**The ratio guard:** The contract enforces that after preminting, `reserveWbtc × seedPrice / odAmount >= 400%`. So you can't mint more OD than your reserve supports.

**Default calculation:** The script computes `premintOdAmount = (seedWbtcAmount × seedPrice / 1e8) / 5`, which targets a ~500% reserve ratio. With 1 WBTC at $100k seed price:
- Reserve value = 1 × $100,000 = $100,000 in OD terms
- Premint = $100,000 / 5 = $20,000 worth of OD = 2,000,000,000,000 OD sats
- Resulting ratio = $100,000 / $20,000 = 500%

**One-shot.** Can only be called once, ever.

**What's sensible:** You don't need to premint all the OD for the pool — just enough for the liquidity deposit (step 6). The rest stays as reserve headroom. The default 500% is conservative and leaves room for the ratio to drop when users mint OD in LIVE mode.

---

## Step 4 — Approve Router

**What it does:** Standard OP-20 allowance grants. The MotoSwap router needs permission to pull WBTC and OD from your wallet to create the pool.

**Values:**
- `LIQUIDITY_WBTC` — default 10,000,000 sats (0.1 WBTC). This is the WBTC side of the pool.
- `LIQUIDITY_OD` — default computed as `liquidityWbtc × seedPrice / 1e8`. With 0.1 WBTC at $100k: 10,000,000 × 10,000,000,000,000 / 100,000,000 = 1,000,000,000,000 OD sats ($10,000 worth).

This must be ≤ the preminted amount from step 3.

---

## Step 5 — Create MotoSwap Pool

**What it does:** Calls `factory.createPool(wbtc, od)` to deploy a new Uniswap v2-style AMM pool for the WBTC/OD trading pair. Returns the pool's contract address.

**Why it matters:** This pool is the oracle. ODReserve reads its cumulative price accumulators to compute the TWAP. No pool = no price = system can't go live.

**Values:** Just the two token addresses. Nothing to tune.

---

## Step 6 — Add Initial Liquidity

**What it does:** Deposits WBTC + OD into the pool, establishing the initial price.

**The initial price is set by the ratio of tokens deposited:**
```
price = WBTC_amount / OD_amount (in token units)
```
With the defaults (0.1 WBTC, $10,000 OD at $100k BTC), the pool prices 1 WBTC = 100,000 OD = $100,000. This matches the `seedPrice`.

**What's sensible:** The initial liquidity determines:
- **Slippage** for early trades — more liquidity = less slippage
- **TWAP accuracy** — thin pools are easier to manipulate
- **How much of your preminted OD you tie up** in the pool

For testnet, the defaults are fine. For mainnet, you'd want deeper liquidity — maybe 0.5-1 WBTC paired with the proportional OD amount. The WBTC for liquidity comes from the deployer's wallet directly (not from the reserve).

**The deployer receives LP tokens** in return and keeps them.

---

## Step 7 — Register Pool (`initPool`)

**What it does:** Tells ODReserve the pool address. The contract then:
1. Calls `pool.token0()` to determine if WBTC is token0 or token1 (needed to read the correct cumulative price accumulator)
2. Takes the initial TWAP snapshot (records the current cumulative price + block number)

**Why it matters:** After this, the TWAP clock starts ticking. The contract now has its first data point.

**Values:** Just the pool address (returned from step 5).

---

## Step 8 — Wait for TWAP Window (6 blocks)

**What happens:** Nothing automated — you just wait. The TWAP requires at least 6 blocks of price data between two snapshots to compute a valid average.

**On OPNet testnet:** ~10 min per block = ~1 hour wait.
**On regtest:** Mine 6 blocks manually.

**The automatic LIVE transition:** After 6+ blocks pass, the *next* call to any function that invokes `_computeTwap()` (including view methods like `getReserveRatio()`, or any mint/burn) will:
1. Compute `deltaBlocks >= twapWindow` → true
2. Update the stored TWAP
3. Check `phase == PREMINT` → transition to `LIVE`

From that point, all four operations (`mintOD`, `burnOD`, `mintORC`, `burnORC`) are available to anyone. The `seedPrice` is never used again — TWAP is the sole price source.

---

## Sensible Testnet Values

| Parameter | Default | What it means |
|-----------|---------|---------------|
| `SEED_WBTC_AMOUNT` | 1 WBTC (1e8) | Initial reserve capitalisation |
| `SEED_PRICE` | $100,000 (1e13) | Assumed BTC price for premint math |
| `PREMINT_OD_AMOUNT` | auto (~$20k OD) | Targets 500% reserve ratio |
| `LIQUIDITY_WBTC` | 0.1 WBTC | Pool depth (WBTC side) |
| `LIQUIDITY_OD` | auto (~$10k OD) | Pool depth (OD side, matches price) |

For testnet, these defaults work well. The deployer needs: 1 WBTC (for seeding) + 0.1 WBTC (for liquidity) = 1.1 WBTC from the faucet, plus some BTC for transaction fees.

---

## Running

```bash
# Deploy all three contracts
source ~/projects/sharedenv/opnet-testnet.env
npx tsx scripts/deploy.ts

# Save the output addresses
export OD_ADDRESS="..."
export ORC_ADDRESS="..."
export ODRESERVE_ADDRESS="..."

# Run all bootstrap steps
npx tsx scripts/bootstrap.ts

# Or run a single step
npx tsx scripts/bootstrap.ts 3
```
