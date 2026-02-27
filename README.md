# Orange Dollar (OD)

An algorithmic stablecoin on Bitcoin L1, powered by [OPNet](https://opnet.org).

OD is pegged to $1 USD, backed by WBTC held in a shared reserve, and priced by an on-chain TWAP from a MotoSwap liquidity pool. A companion token, ORC (Orange Reserve Coin), represents equity in the reserve and absorbs BTC volatility in exchange for fee yield.

Based on [Minimal Djed](https://iohk.io/en/research/library/papers/djed-a-formally-verified-crypto-backed-pegged-algorithmic-stablecoin/) by Zahnentferner et al. (IOHK).

---

## Protocol Overview

### Tokens

| Token | Symbol | Role |
|-------|--------|------|
| Orange Dollar | **OD** | Stablecoin, pegged to $1 USD |
| Orange Reserve Coin | **ORC** | Reserve equity token |

Both are OP-20 tokens. `mint()` and `burn()` are restricted exclusively to the ODReserve contract.

### Contracts

| Contract | Purpose |
|----------|---------|
| **OD** | OP-20 stablecoin with reserve-restricted minting |
| **ORC** | OP-20 equity token with reserve-restricted minting |
| **ODReserve** | Core protocol: holds WBTC, enforces ratios, mints/burns tokens, reads TWAP |

### How It Works

1. Users deposit WBTC into ODReserve and receive OD (stablecoins) or ORC (equity)
2. The exchange rate for OD is set by an on-chain TWAP from a MotoSwap WBTC/OD pool
3. Reserve ratio bounds (400%--800%) ensure the system stays overcollateralised
4. Fees (1.5% per operation) accrue to the reserve, benefiting ORC holders

### Operations

| Operation | Action | Receives | Blocked When |
|-----------|--------|----------|--------------|
| `mintOD(wbtcAmount)` | Deposit WBTC | OD at TWAP rate | Ratio would drop below 400% |
| `burnOD(odAmount)` | Return OD | WBTC at TWAP rate | Never blocked |
| `mintORC(wbtcAmount)` | Deposit WBTC | ORC at equity price | Ratio already above 800% |
| `burnORC(orcAmount)` | Return ORC | WBTC proportional to equity | Ratio would drop below 400% |

### Reserve Ratio

```
reserve_ratio = (reserve_wbtc * twap) / od_supply
```

All values are in `u256` with `1e8` scale (400% = `400_000_000`).

### RC Pricing

```
equity   = (reserve_wbtc * twap) - od_supply    // surplus value in OD terms
rc_price = equity / orc_supply                   // OD per ORC
```

First ORC mint uses 1:1 pricing. Subsequent mints use equity-based pricing.

### TWAP Oracle

ODReserve reads cumulative price accumulators from a MotoSwap WBTC/OD pool (Uniswap V2-style). No external oracle.

```
twap = (currentCumulative - snapshotCumulative) / (currentBlock - snapshotBlock)
```

Window: **6 blocks** (~1 hour on Bitcoin). Configurable at deployment.

---

## Bootstrap Lifecycle

ODReserve operates in three sequential, irreversible phases:

```
SEEDING  ──>  PREMINT  ──>  LIVE
          owner calls       automatic (TWAP
          advancePhase()    window fills)
```

### Phase 0: SEEDING

- Only `mintORC()` is permitted
- Investors deposit WBTC and receive ORC, building the initial reserve

### Phase 1: PREMINT

- Owner calls `advancePhase(seedPrice)` to enter this phase
- Owner calls `premintOD(amount)` exactly once to mint OD for initial pool liquidity
- Owner creates the MotoSwap WBTC/OD pool and adds liquidity
- Owner calls `initPool(poolAddress)` to register the pool with ODReserve

### Phase 2: LIVE

- Triggers automatically once the TWAP window accumulates 6 blocks of data
- All four operations become available
- `seedPrice` is discarded; TWAP is the sole price source
- `premintOD` is permanently disabled

---

## Building

### Prerequisites

- Node.js 20+
- [AssemblyScript](https://www.assemblyscript.org/) (installed via deps)

### Install & Build

```bash
npm install
npm run build
```

This compiles three WASM contracts into `build/`:
- `OD.wasm`
- `ORC.wasm`
- `ODReserve.wasm`

### Run Tests

```bash
npm test
```

72 tests across 8 test suites covering all contract functionality.

---

## Deployment

### Environment

Set up the required environment variables:

```bash
export OPNET_MNEMONIC="your deployer mnemonic"
export OPNET_NODE_URL="https://regtest.opnet.org"    # or testnet/mainnet
export OPNET_NETWORK="regtest"                        # regtest | testnet | bitcoin
export OPNET_WBTC_ADDRESS="0x..."                     # existing WBTC contract
export OPNET_MOTOSWAP_FACTORY="0x..."                 # MotoSwap factory
```

### Deploy Contracts

```bash
npx tsx scripts/deploy.ts
```

This deploys three contracts in order:

1. **OD** -- no constructor arguments
2. **ORC** -- no constructor arguments
3. **ODReserve** -- receives OD, ORC, WBTC, and Factory addresses

The script outputs all contract addresses. Save them for bootstrap:

```bash
export OD_ADDRESS="0x..."
export ORC_ADDRESS="0x..."
export ODRESERVE_ADDRESS="0x..."
```

> **Note:** OD and ORC are deployed without knowing the ODReserve address.
> The reserve link is established in bootstrap step 0 via `setReserve()`.

---

## Bootstrap

After deployment, run the bootstrap sequence to bring the system to LIVE.

```bash
# Run all steps:
npx tsx scripts/bootstrap.ts

# Or run a single step:
npx tsx scripts/bootstrap.ts 0
```

### Additional Environment Variables

```bash
export OPNET_MOTOSWAP_ROUTER="0x..."                  # MotoSwap router
export SEED_WBTC_AMOUNT="100000000"                   # 1 WBTC (default)
export SEED_PRICE="10000000000000"                     # $100,000 in 1e8 scale
export PREMINT_OD_AMOUNT="..."                         # auto-computed if omitted
export LIQUIDITY_WBTC="10000000"                       # 0.1 WBTC for pool
export LIQUIDITY_OD="..."                              # auto-computed if omitted
```

### Step-by-Step

| Step | Phase | Action | Who |
|------|-------|--------|-----|
| **0** | Post-deploy | `OD.setReserve(reserveAddr)` + `ORC.setReserve(reserveAddr)` | Owner |
| **1** | SEEDING | `ODReserve.mintORC(wbtcAmount)` -- seed the reserve | Investor(s) |
| **2** | SEEDING -> PREMINT | `ODReserve.advancePhase(seedPrice)` | Owner |
| **3** | PREMINT | `ODReserve.premintOD(odAmount)` | Owner |
| **4** | PREMINT | `WBTC.approve(router, ...)` + `OD.approve(router, ...)` | Owner |
| **5** | PREMINT | `Factory.createPool(wbtc, od)` | Owner |
| **6** | PREMINT | `Router.addLiquidity(wbtc, od, ...)` | Owner |
| **7** | PREMINT | `ODReserve.initPool(poolAddress)` | Owner |
| **8** | PREMINT -> LIVE | Wait 6 blocks (~1 hour), then any user interaction triggers LIVE | Automatic |

### Step 0: Link Tokens to Reserve

After deploying all three contracts, the owner calls `setReserve(address)` on both OD and ORC to link them to the ODReserve. This is a **one-shot** call -- it can only be called once and only by the deployer. Until this is done, nobody can mint or burn tokens.

```
Selector: 0xb86a7d16    setReserve(address)
Calldata: selector (4 bytes) + address (32 bytes)
```

### Steps 1--7: Seed, Premint, Add Liquidity

These steps build the reserve, create the MotoSwap pool, and register it with ODReserve. After step 7, the TWAP oracle begins accumulating data.

### Step 8: Go Live

After 6 blocks (~1 hour on Bitcoin mainnet, instant on regtest), the next user interaction automatically transitions the system from PREMINT to LIVE. All operations are now open.

---

## Architecture

```
                    ┌──────────────────┐
                    │   MotoSwap Pool  │
                    │   (WBTC / OD)    │
                    └────────┬─────────┘
                             │ TWAP
                    ┌────────▼─────────┐
   WBTC ──────────> │    ODReserve     │ <────── WBTC
   (deposit)        │                  │         (withdraw)
                    │  mint/burn OD    │
                    │  mint/burn ORC   │
                    │  enforce ratios  │
                    │  collect fees    │
                    └───┬──────────┬───┘
                        │          │
              ┌─────────▼──┐  ┌───▼──────────┐
              │     OD     │  │     ORC      │
              │  (stable)  │  │   (equity)   │
              │  OP-20     │  │   OP-20      │
              └────────────┘  └──────────────┘
```

### Key Design Decisions

| Djed Paper | OD Implementation | Reason |
|------------|-------------------|--------|
| Reserve = native currency | Reserve = WBTC (OP-20) | OPNet contracts cannot custody native BTC |
| Oracle = external signed feed | Oracle = MotoSwap TWAP | Fully on-chain, no trusted operator |

### Precision

All values use `u256` with `1e8` scale. All arithmetic uses `SafeMath` -- no raw operators on `u256`.

| Value | Decimals | Example |
|-------|----------|---------|
| WBTC | 8 | 1 WBTC = `100_000_000` |
| OD | 8 | 1 OD = `100_000_000` |
| ORC | 8 | 1 ORC = `100_000_000` |
| Reserve ratio | 8 | 400% = `400_000_000` |
| Fees | 8 | 1.5% = `1_500_000` |

---

## dApp

The `app/` directory contains a React frontend for interacting with the protocol.

### Run Locally

```bash
cd app
npm install
npm run dev
```

Opens at http://localhost:5173. Requires [OPWallet](https://opwallet.org) browser extension (v1.8.2+).

### Features

- **Trade tab** -- Mint/burn OD and ORC, transfer tokens, manage approvals
- **Dashboard tab** -- Reserve ratio, TWAP price, equity, supply stats, health bar
- **Admin tab** -- Bootstrap wizard (auto-detects phase), protocol status, emergency controls
- **Network switching** -- Testnet / Mainnet selector in the header
- **OPWallet integration** -- Connect, sign transactions, view balances

---

## Project Structure

```
src/
  contracts/
    OD.ts               # OD stablecoin (OP-20)
    ORC.ts              # ORC equity token (OP-20)
    ODReserve.ts        # Core reserve contract
    MockMotoSwapPool.ts # Mock pool for testing
    MockWBTC.ts         # Mock WBTC for testing
  selectors.ts          # Cross-contract call selectors
tests/
  OD.test.ts            # OD token tests (11)
  ORC.test.ts           # ORC token tests (11)
  ODReserve.phase.test.ts    # Phase machine tests (5)
  ODReserve.twap.test.ts     # TWAP oracle tests (6)
  ODReserve.orc.test.ts      # mintORC/burnORC tests (13)
  ODReserve.od.test.ts       # mintOD/burnOD tests (12)
  ODReserve.premint.test.ts  # premintOD + view tests (9)
  ODReserve.integration.test.ts  # End-to-end tests (5)
scripts/
  deploy.ts             # Contract deployment
  bootstrap.ts          # Post-deploy bootstrap sequence
app/
  src/
    components/         # React UI components (Trade, Dashboard, Admin, etc.)
    context/            # ProtocolContext, ToastContext
    hooks/              # useContractCall
    abi/                # Contract ABIs for frontend
    config.ts           # Network configs (testnet, mainnet)
    styles/             # CSS (dark theme matching landing page)
docs/
  plans/                # Design document and implementation plan
site/
  index.html            # Landing page
```

---

## License

MIT
