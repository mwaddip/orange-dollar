# OD Documentation Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VitePress documentation site in `docs/` with ~15 pages covering the OD protocol for end users and investors.

**Architecture:** VitePress project at `docs/` with its own `package.json`. OD brand dark theme via CSS variable overrides. Markdown content pages organized into 6 sidebar sections. Builds to `docs/.vitepress/dist/` for static hosting.

**Tech Stack:** VitePress 1.x, Vue 3 (implicit), Markdown, custom CSS.

---

### Task 1: Scaffold VitePress Project

**Files:**
- Create: `docs/package.json`
- Create: `docs/.vitepress/config.ts`
- Create: `docs/index.md`

**Step 1: Create `docs/package.json`**

```json
{
  "name": "od-docs",
  "private": true,
  "scripts": {
    "docs:dev": "vitepress dev",
    "docs:build": "vitepress build",
    "docs:preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "^1.6.3"
  }
}
```

**Step 2: Create `docs/.vitepress/config.ts`**

```ts
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Orange Dollar',
  description: 'Bitcoin-native algorithmic stablecoin powered by Minimal Djed on OPNet.',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap', rel: 'stylesheet' }],
  ],
  themeConfig: {
    logo: '/od-logo.svg',
    nav: [
      { text: 'App', link: 'https://app.orangedollar.xyz' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is Orange Dollar?', link: '/introduction/what-is-od' },
          { text: 'How It Works', link: '/introduction/how-it-works' },
          { text: 'Contract Addresses', link: '/introduction/addresses' },
        ],
      },
      {
        text: 'Using OD',
        items: [
          { text: 'Getting Started', link: '/using-od/getting-started' },
          { text: 'Minting OD', link: '/using-od/minting' },
          { text: 'Burning OD', link: '/using-od/burning' },
        ],
      },
      {
        text: 'Using ORC',
        items: [
          { text: 'Why ORC?', link: '/using-orc/why-orc' },
          { text: 'Minting ORC', link: '/using-orc/minting' },
          { text: 'Burning ORC', link: '/using-orc/burning' },
        ],
      },
      {
        text: 'Protocol',
        items: [
          { text: 'Reserve Ratio', link: '/protocol/reserve-ratio' },
          { text: 'TWAP Oracle', link: '/protocol/twap' },
          { text: 'Fees', link: '/protocol/fees' },
          { text: 'Bootstrap Phases', link: '/protocol/bootstrap-phases' },
          { text: 'Bootstrap Guide', link: '/protocol/bootstrap-guide' },
          { text: 'Admin Functions', link: '/protocol/admin' },
        ],
      },
      {
        text: 'Security & Governance',
        items: [
          { text: 'Djed Formalism', link: '/security/djed' },
          { text: 'PERMAFROST Multisig', link: '/security/permafrost' },
          { text: 'Risk Factors', link: '/security/risks' },
        ],
      },
      {
        text: 'FAQ',
        items: [
          { text: 'Frequently Asked Questions', link: '/faq' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mwaddip/orange-dollar' },
    ],
    search: {
      provider: 'local',
    },
  },
});
```

**Step 3: Create placeholder `docs/index.md`**

```md
---
layout: home
hero:
  name: Orange Dollar
  text: Bitcoin-Native Stablecoin
  tagline: Algorithmic stablecoin powered by Minimal Djed on OPNet.
  actions:
    - theme: brand
      text: What is OD?
      link: /introduction/what-is-od
    - theme: alt
      text: Get Started
      link: /using-od/getting-started
---
```

**Step 4: Install and verify**

```bash
cd docs && npm install && npx vitepress dev
```

Open browser at `http://localhost:5173` — confirm site loads with sidebar and home page.

**Step 5: Commit**

```bash
git add docs/package.json docs/package-lock.json docs/.vitepress/config.ts docs/index.md
git commit -m "feat(docs): scaffold VitePress docs site"
```

---

### Task 2: OD Brand Theme

**Files:**
- Create: `docs/.vitepress/theme/index.ts`
- Create: `docs/.vitepress/theme/custom.css`
- Copy: `OD-logo.svg` → `docs/public/od-logo.svg`

**Step 1: Create `docs/.vitepress/theme/index.ts`**

```ts
import DefaultTheme from 'vitepress/theme';
import './custom.css';

export default DefaultTheme;
```

**Step 2: Create `docs/.vitepress/theme/custom.css`**

```css
:root {
  --vp-font-family-base: 'Inter', sans-serif;
  --vp-font-family-mono: 'JetBrains Mono', monospace;
}

.dark {
  --vp-c-brand-1: #F7931A;
  --vp-c-brand-2: #E68212;
  --vp-c-brand-3: #D47310;
  --vp-c-brand-soft: rgba(247, 147, 26, 0.12);

  --vp-c-bg: #0D0F12;
  --vp-c-bg-alt: #141720;
  --vp-c-bg-elv: #1B1D20;
  --vp-c-bg-soft: #1B1D20;

  --vp-c-text-1: #EDF0F2;
  --vp-c-text-2: #AEB4BC;
  --vp-c-text-3: #6B6B6B;

  --vp-c-divider: rgba(237, 239, 242, 0.06);
  --vp-c-gutter: rgba(237, 239, 242, 0.06);

  --vp-c-default-1: #6B6B6B;
  --vp-c-default-2: rgba(237, 239, 242, 0.1);
  --vp-c-default-3: rgba(237, 239, 242, 0.06);
  --vp-c-default-soft: rgba(237, 239, 242, 0.04);

  --vp-home-hero-name-color: #F7931A;

  --vp-button-brand-bg: #F7931A;
  --vp-button-brand-hover-bg: #E68212;
  --vp-button-brand-text: #0D0F12;
}

/* Force dark mode */
html {
  color-scheme: dark;
}
```

**Step 3: Copy the logo**

```bash
mkdir -p docs/public
cp OD-logo.svg docs/public/od-logo.svg
```

**Step 4: Verify**

```bash
cd docs && npx vitepress dev
```

Confirm dark theme with orange brand colors, logo in navbar.

**Step 5: Commit**

```bash
git add docs/.vitepress/theme/ docs/public/od-logo.svg
git commit -m "feat(docs): add OD brand dark theme"
```

---

### Task 3: Introduction Pages

**Files:**
- Create: `docs/introduction/what-is-od.md`
- Create: `docs/introduction/how-it-works.md`
- Create: `docs/introduction/addresses.md`

**Step 1: Create `docs/introduction/what-is-od.md`**

```md
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
```

**Step 2: Create `docs/introduction/how-it-works.md`**

```md
# How It Works

The Orange Dollar protocol has three components:

1. **The Reserve** — A smart contract (`ODReserve`) holding WBTC collateral
2. **OD** — The stablecoin token, minted and burned against the reserve
3. **ORC** — The equity token, representing ownership of reserve surplus

## The Flow

**Minting OD:**
You deposit WBTC → the reserve calculates how much OD you get at the current TWAP price → deducts 1.5% fee → sends you OD.

**Burning OD:**
You return OD → the reserve calculates how much WBTC to give you at the current TWAP price → deducts 1.5% fee → sends you WBTC.

**Minting ORC:**
You deposit WBTC → the reserve calculates how much ORC you get based on the current equity per ORC → deducts 1.5% fee → sends you ORC.

**Burning ORC:**
You return ORC → the reserve calculates your proportional share of equity → deducts 1.5% fee → sends you WBTC.

## Reserve Ratio

The protocol enforces a reserve ratio between **400%** and **800%**:

- If the ratio is near 400%, minting OD is blocked (reserve is too thin)
- If the ratio is near 800%, minting ORC is blocked (reserve is already oversaturated)
- Burning OD is **never** blocked — you can always redeem

This range ensures the reserve is always overcollateralised while keeping capital somewhat efficient.

## Price Oracle

OD uses a **6-block TWAP** (Time-Weighted Average Price) from the MotoSwap WBTC/OD pool. This is a rolling average that resists manipulation — an attacker would need to sustain a fake price for a full hour to move it.

## Fee Yield

Every operation charges **1.5%**. This fee stays in the reserve, growing the total WBTC held. Since ORC represents a claim on the equity (reserve minus OD liabilities), fees make ORC more valuable over time.
```

**Step 3: Create `docs/introduction/addresses.md`**

```md
# Contract Addresses

## OPNet Testnet

| Contract | Address |
|----------|---------|
| **OD** (Orange Dollar) | `0x32aa95fa34585c7f01d70e02a191548cc7af6ad1cd74c13e16e19c2dad88123b` |
| **ORC** (Orange Reserve Coin) | `0xfebf1d5da9cec9c9b37ed1e841df4470ac3c6608ab0d02af2a6557204a4ae190` |
| **ODReserve** | `0x3de883cb1919e92bfa8521ee25308e80fb5eed787fd128e0afee2494628eb50c` |
| **WBTC** (MockWBTC) | `0xbc9affbfdb6a3c88835ddf388a169c30b77fd877c71f3ba349127a6924a015d0` |

::: info
Testnet uses MockWBTC — a faucet-mintable test token. On mainnet, the reserve will hold real WBTC provided by official custodians.
:::

## OPNet Mainnet

| Contract | Address |
|----------|---------|
| **OD** | *Not yet deployed* |
| **ORC** | *Not yet deployed* |
| **ODReserve** | *Not yet deployed* |
| **WBTC** | *TBD* |

## Infrastructure

| Service | Testnet | Mainnet |
|---------|---------|---------|
| RPC Endpoint | `https://testnet.opnet.org/api/v1/json-rpc` | `https://api.opnet.org/api/v1/json-rpc` |
| MotoSwap Factory | `0xa02aa5ca...369a0f` | *TBD* |
| MotoSwap Router | `0x0e6ff1f2...1b937a` | *TBD* |
```

**Step 4: Verify** — run dev server, check all three pages render in sidebar.

**Step 5: Commit**

```bash
git add docs/introduction/
git commit -m "feat(docs): add introduction pages"
```

---

### Task 4: Using OD Pages

**Files:**
- Create: `docs/using-od/getting-started.md`
- Create: `docs/using-od/minting.md`
- Create: `docs/using-od/burning.md`

**Step 1: Create `docs/using-od/getting-started.md`**

```md
# Getting Started

## What You Need

1. **OPWallet** — The browser extension wallet for OPNet. Install version **1.8.2 or later**.
2. **Some BTC** — For transaction fees (a small amount, ~0.001 BTC).
3. **WBTC** — The reserve asset. On testnet, you can get this from the faucet.

## Install OPWallet

1. Download OPWallet from the official site
2. Create a new wallet or import an existing mnemonic
3. Switch to **OPNet Testnet** in the network selector

## Get Testnet WBTC

Visit the OD app and navigate to the **Faucet** tab. Connect your wallet and request MockWBTC tokens. These are free testnet tokens for testing.

## Connect to the App

1. Go to the OD app
2. Click **Connect Wallet** in the top right
3. Approve the connection in OPWallet
4. You should see your balances for WBTC, OD, and ORC

## Next Steps

- [Mint OD](/using-od/minting) — Deposit WBTC to get stablecoins
- [Mint ORC](/using-orc/minting) — Deposit WBTC to invest in the reserve equity
```

**Step 2: Create `docs/using-od/minting.md`**

```md
# Minting OD

Minting OD means depositing WBTC into the reserve and receiving OD stablecoins in return.

## How It Works

1. You specify how much **WBTC** to deposit
2. The app calculates how much **OD** you'll receive at the current TWAP price, minus the 1.5% fee
3. You approve the transaction in OPWallet
4. The reserve takes your WBTC and sends you OD

## Step by Step

1. Open the OD app and connect your wallet
2. Select **OD** in the token selector
3. Select **Mint** as the action
4. Enter the WBTC amount you want to deposit
5. Review the estimated OD output and fee breakdown
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## Example

If WBTC is trading at $100,000 and you deposit **0.01 WBTC** ($100):

| | Amount |
|--|--------|
| WBTC deposited | 0.01 ($100.00) |
| Fee (1.5%) | $1.50 |
| OD received | ~98.50 OD |

## When Minting Is Blocked

OD minting is blocked when the [reserve ratio](/protocol/reserve-ratio) would drop below **400%**. This protects the system from becoming undercollateralised. If minting is blocked, wait for more WBTC to enter the reserve (via ORC minting) or for the BTC price to rise.
```

**Step 3: Create `docs/using-od/burning.md`**

```md
# Burning OD

Burning OD means returning OD stablecoins to the reserve and receiving WBTC back.

## How It Works

1. You specify how much **OD** to return
2. The app calculates how much **WBTC** you'll receive at the current TWAP price, minus the 1.5% fee
3. You approve the transaction in OPWallet
4. The reserve takes your OD and sends you WBTC

## Step by Step

1. Open the OD app and connect your wallet
2. Select **OD** in the token selector
3. Select **Burn** as the action
4. Enter the OD amount you want to redeem
5. Review the estimated WBTC output and fee breakdown
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## Example

If WBTC is trading at $100,000 and you burn **100 OD** ($100):

| | Amount |
|--|--------|
| OD returned | 100.00 ($100.00) |
| Fee (1.5%) | $1.50 |
| WBTC received | ~0.000985 WBTC ($98.50) |

## Burning Is Never Blocked

Unlike minting, burning OD is **always** available regardless of the reserve ratio. You can always redeem your OD for WBTC. This is a core safety guarantee of the Djed protocol.
```

**Step 4: Verify** — dev server, check pages.

**Step 5: Commit**

```bash
git add docs/using-od/
git commit -m "feat(docs): add Using OD pages"
```

---

### Task 5: Using ORC Pages

**Files:**
- Create: `docs/using-orc/why-orc.md`
- Create: `docs/using-orc/minting.md`
- Create: `docs/using-orc/burning.md`

**Step 1: Create `docs/using-orc/why-orc.md`**

```md
# Why ORC?

ORC (Orange Reserve Coin) is the **equity token** of the Orange Dollar protocol. It represents ownership of the reserve's surplus — the value left after all OD liabilities are covered.

## How ORC Earns Yield

Every time anyone mints or burns OD or ORC, the protocol charges a **1.5% fee**. This fee stays in the WBTC reserve.

Since ORC represents a claim on the equity (total reserve minus OD liabilities), every fee collected increases the WBTC backing each ORC. Over time, as more people use the protocol, ORC becomes more valuable.

## ORC Pricing

ORC price is determined by a simple formula:

```
equity = (reserve WBTC × TWAP) − OD supply
ORC price = equity ÷ ORC supply
```

If the reserve holds 1 WBTC ($100,000), OD supply is $20,000, and ORC supply is 80,000:
- Equity = $100,000 − $20,000 = $80,000
- ORC price = $80,000 ÷ 80,000 = $1.00 per ORC

## The Risk

ORC absorbs Bitcoin's price volatility. If BTC drops, the equity shrinks and ORC loses value. If BTC rises, equity grows and ORC gains value. The fees provide a baseline yield, but ORC is **not** a stablecoin — it's an investment in the reserve.

## When to Buy ORC

ORC is attractive when:
- You're bullish on BTC (you benefit from price appreciation + fees)
- The reserve ratio is moderate (400–600%) — more room for growth
- Protocol activity is high (more fees accruing)

ORC is riskier when:
- BTC is in a downtrend (equity shrinks faster than fees accumulate)
- The reserve ratio is near 400% (further BTC drops could cause losses)
```

**Step 2: Create `docs/using-orc/minting.md`**

```md
# Minting ORC

Minting ORC means depositing WBTC into the reserve and receiving ORC equity tokens.

## Step by Step

1. Open the OD app and connect your wallet
2. Select **ORC** in the token selector
3. Select **Mint** as the action
4. Enter the WBTC amount you want to deposit
5. Review the estimated ORC output and fee
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## ORC Pricing

The ORC you receive is based on the current equity price:

```
ORC received = (WBTC deposited × TWAP − fee) ÷ (equity ÷ ORC supply)
```

The app shows this calculation in the estimate before you execute.

## When Minting Is Blocked

ORC minting is blocked when the [reserve ratio](/protocol/reserve-ratio) is already above **800%**. This prevents the reserve from becoming excessively overcollateralised (which would dilute existing ORC holders without benefiting stability).
```

**Step 3: Create `docs/using-orc/burning.md`**

```md
# Burning ORC

Burning ORC means returning ORC tokens to redeem your proportional share of the reserve's equity.

## Step by Step

1. Open the OD app and connect your wallet
2. Select **ORC** in the token selector
3. Select **Burn** as the action
4. Enter the ORC amount you want to redeem
5. Review the estimated WBTC output and fee
6. Click **Execute** and approve in OPWallet
7. Wait for the transaction to confirm

## What You Get Back

The WBTC you receive is proportional to your share of the total equity:

```
WBTC received = (ORC burned ÷ ORC supply) × equity − fee
```

## When Burning Is Blocked

ORC burning is blocked when the [reserve ratio](/protocol/reserve-ratio) would drop below **400%**. This protects OD holders — the reserve can't be drained below the safety threshold by ORC exits.

If burning is blocked, wait for the BTC price to rise (increasing equity) or for OD to be burned (reducing liabilities).
```

**Step 4: Verify** — dev server, check pages.

**Step 5: Commit**

```bash
git add docs/using-orc/
git commit -m "feat(docs): add Using ORC pages"
```

---

### Task 6: Protocol Pages

**Files:**
- Create: `docs/protocol/reserve-ratio.md`
- Create: `docs/protocol/twap.md`
- Create: `docs/protocol/fees.md`
- Create: `docs/protocol/bootstrap-phases.md`
- Create: `docs/protocol/bootstrap-guide.md`
- Create: `docs/protocol/admin.md`

**Step 1: Create `docs/protocol/reserve-ratio.md`**

```md
# Reserve Ratio

The reserve ratio is the core health metric of the Orange Dollar protocol. It measures how much WBTC collateral backs each dollar of outstanding OD.

## Formula

```
reserve ratio = (reserve WBTC × TWAP price) ÷ OD supply
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
```

**Step 2: Create `docs/protocol/twap.md`**

```md
# TWAP Oracle

The TWAP (Time-Weighted Average Price) oracle provides the BTC/USD price that the protocol uses for all calculations.

## How It Works

The oracle reads the **cumulative price accumulators** from the MotoSwap WBTC/OD trading pool — the same mechanism used by Uniswap V2. It computes a rolling average over a 6-block window:

```
TWAP = (currentCumulative − snapshotCumulative) ÷ (currentBlock − snapshotBlock)
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
```

**Step 3: Create `docs/protocol/fees.md`**

```md
# Fees

Every operation in the Orange Dollar protocol charges a flat **1.5%** fee.

## Which Operations

| Operation | Fee |
|-----------|-----|
| Mint OD | 1.5% deducted from OD output |
| Burn OD | 1.5% deducted from WBTC output |
| Mint ORC | 1.5% deducted from ORC output |
| Burn ORC | 1.5% deducted from WBTC output |

## Where Fees Go

Fees stay in the WBTC reserve. They are not paid out to anyone — they increase the total WBTC held by the reserve contract.

Since ORC represents a claim on the reserve's equity (total WBTC minus OD liabilities), accumulated fees increase the value of each ORC over time. This is how ORC holders earn yield.

## Example

If you mint OD by depositing 1 WBTC:
- Fee: 0.015 WBTC (stays in reserve)
- Used for OD calculation: 0.985 WBTC
- OD received: 0.985 × TWAP price

The 0.015 WBTC fee permanently increases the reserve, benefiting all ORC holders.
```

**Step 4: Create `docs/protocol/bootstrap-phases.md`**

```md
# Bootstrap Phases

The protocol starts empty and progresses through three phases before becoming fully operational.

## Phase 0: SEEDING

The reserve is being capitalised. Only **mintORC** is available — investors deposit WBTC and receive ORC tokens. No price oracle exists yet.

During seeding, the first ORC mint uses 1:1 pricing (1 WBTC = 1e8 ORC). Subsequent mints in this phase also use this initial pricing.

## Phase 1: PREMINT

The owner advances the phase and sets a **seed price** — the assumed BTC/USD price for initial calculations. The owner then:

1. Premints OD tokens (one-shot, subject to 400% ratio guard)
2. Creates a MotoSwap WBTC/OD liquidity pool
3. Registers the pool with the reserve (starts the TWAP clock)

During premint, the TWAP window fills (6 blocks, ~1 hour).

## Phase 2: LIVE

Automatic transition once the TWAP window has enough data. All four operations become available to anyone:

- **mintOD** — deposit WBTC, receive OD
- **burnOD** — return OD, receive WBTC
- **mintORC** — deposit WBTC, receive ORC
- **burnORC** — return ORC, receive WBTC

The seed price is never used again — the TWAP is the sole price source from this point forward.

::: info
Phase transitions are **irreversible**. Once LIVE, the protocol cannot be paused or reverted to an earlier phase.
:::
```

**Step 5: Create `docs/protocol/bootstrap-guide.md`**

Adapt the existing `docs/bootstrap-guide.md` content directly. This is already well-written user-facing prose. Copy it into the VitePress page structure with minor formatting adjustments (add frontmatter, fix heading levels if needed).

**Step 6: Create `docs/protocol/admin.md`**

```md
# Admin Functions

Once the protocol is LIVE, the owner retains limited administrative capabilities. These are designed to be transferred to the [PERMAFROST multisig](/security/permafrost) for trustless governance.

## What the Owner Can Do

### Transfer Ownership

The owner can call `transferOwnership(newOwner)` on all three contracts (OD, ORC, ODReserve). This is how control transfers from a single deployer key to the PERMAFROST threshold key.

- **Repeatable:** Ownership can be transferred multiple times (for key rotation)
- **Emits event:** `OwnershipTransferred(previousOwner, newOwner)`
- **Applies to:** OD, ORC, and ODReserve independently

## What the Owner Cannot Do

The following parameters are **compile-time constants** and cannot be changed after deployment:

| Parameter | Fixed Value |
|-----------|-------------|
| Minimum reserve ratio | 400% |
| Maximum reserve ratio | 800% |
| Fee rate | 1.5% |
| TWAP window | 6 blocks |
| Token decimals | 8 |

The owner also **cannot**:
- Mint or burn tokens directly (only ODReserve can)
- Pause the protocol or revert to a previous phase
- Access or withdraw reserve funds
- Change the MotoSwap pool address after `initPool`

## After PERMAFROST Transfer

Once ownership transfers to the PERMAFROST threshold key, any admin action requires **3 of 5** signers to participate in a multi-round signing ceremony. No single individual can execute administrative functions.
```

**Step 7: Verify** — dev server, check all 6 protocol pages.

**Step 8: Commit**

```bash
git add docs/protocol/
git commit -m "feat(docs): add Protocol section pages"
```

---

### Task 7: Security & Governance Pages

**Files:**
- Create: `docs/security/djed.md`
- Create: `docs/security/permafrost.md`
- Create: `docs/security/risks.md`

**Step 1: Create `docs/security/djed.md`**

```md
# Djed Formalism

Orange Dollar implements **Minimal Djed**, a formally verified algorithmic stablecoin protocol designed by IOHK (the team behind Cardano).

## The Paper

> *"Djed: A Formally Verified Crypto-Backed Pegged Algorithmic Stablecoin"*
> — Zahnentferner, Kaidalov, Etit, Díaz (2021)

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
```

**Step 2: Create `docs/security/permafrost.md`**

```md
# PERMAFROST Multisig

PERMAFROST is the account-level threshold multisig system used to govern the Orange Dollar protocol. After bootstrap, ownership of all three contracts (OD, ORC, ODReserve) is transferred to a PERMAFROST threshold key.

## How It Works

PERMAFROST uses **ML-DSA** (Module-Lattice Digital Signature Algorithm), a post-quantum signature scheme standardised by NIST. The threshold variant requires **3 of 5** signers to produce a valid signature.

| Parameter | Value |
|-----------|-------|
| Signature scheme | ML-DSA-44 (NIST Level 2) |
| Threshold | 3 of 5 |
| Security | 128-bit (post-quantum) |
| Signature size | 2,420 bytes |
| On-chain appearance | Indistinguishable from single-signer ML-DSA |

## What PERMAFROST Controls

After ownership transfer, the PERMAFROST key is the owner of OD, ORC, and ODReserve. This means **3 of 5 signers must agree** to:

- Transfer ownership to a new key (key rotation)
- Execute any future owner-only functions

No single signer can act alone. The signing process requires multiple rounds of interaction between signers.

## Signers

| # | Name | Role | Contact |
|---|------|------|---------|
| 1 | *TBD* | — | — |
| 2 | *TBD* | — | — |
| 3 | *TBD* | — | — |
| 4 | *TBD* | — | — |
| 5 | *TBD* | — | — |

::: info
Signer identities will be published here once the DKG ceremony is complete and the key is generated.
:::

## Key Generation

The PERMAFROST key is generated via a **Distributed Key Generation (DKG) ceremony** using a dedicated ceremony app. Each signer receives an encrypted key share file that only they can decrypt with their password.

- Key shares never leave the signers' browsers
- Share files are encrypted with AES-256-GCM (PBKDF2 100k iterations)
- The public key is published; individual shares are never revealed
```

**Step 3: Create `docs/security/risks.md`**

```md
# Risk Factors

Orange Dollar is experimental software. This page describes known risks. Use the protocol only with funds you can afford to lose.

## Smart Contract Risk

The contracts have **not been formally audited**. While the codebase has comprehensive test coverage (72+ tests) and follows the formally verified Minimal Djed specification, undiscovered bugs could lead to loss of funds.

## WBTC Depeg Risk

OD's reserve holds WBTC, which is a wrapped representation of Bitcoin on OPNet. If the WBTC bridge or custodian fails, the reserve's value could drop regardless of Bitcoin's actual price.

## Oracle Manipulation

The TWAP oracle resists manipulation through its 6-block averaging window. However, if pool liquidity is very thin, a well-funded attacker could potentially influence the TWAP by maintaining a skewed price for the full window (~1 hour).

## Reserve Ratio Risk

If BTC drops sharply, the reserve ratio decreases. Below 400%, OD minting is blocked, but existing OD can still be burned. In an extreme scenario where the ratio drops below 100%, the reserve would be unable to cover all OD redemptions at face value.

## Threshold Key Custody

The PERMAFROST multisig requires 3 of 5 signers to act. If 3 or more signers lose their key shares or become permanently unavailable, administrative functions (like key rotation) would be permanently locked.

## OPNet Platform Risk

Orange Dollar runs on OPNet, which is itself a relatively new platform. Bugs or changes in the OPNet runtime could affect contract behaviour.
```

**Step 4: Verify** — dev server, check all 3 security pages.

**Step 5: Commit**

```bash
git add docs/security/
git commit -m "feat(docs): add Security & Governance pages"
```

---

### Task 8: FAQ Page

**Files:**
- Create: `docs/faq.md`

**Step 1: Create `docs/faq.md`**

```md
# Frequently Asked Questions

## General

### What is OD pegged to?
OD targets a peg of **$1 USD**. The peg is maintained through overcollateralisation (400–800% reserve ratio) and the ability to always redeem OD for WBTC at the oracle price.

### Is OD an algorithmic stablecoin?
Yes — OD uses the Minimal Djed algorithm to maintain its peg. Unlike unbacked algorithmic stablecoins, OD is always backed by WBTC collateral at a minimum 4:1 ratio.

### What blockchain does OD run on?
OD runs on **OPNet**, a smart contract platform on Bitcoin Layer 1. Transactions settle directly on Bitcoin.

## Using the Protocol

### How do I get WBTC?
On testnet, use the **Faucet** tab in the OD app to receive free MockWBTC. On mainnet, WBTC will be available through official custodians and exchanges.

### Can I always redeem my OD?
Yes. Burning OD (redeeming for WBTC) is **never blocked**, regardless of the reserve ratio. This is a core guarantee of the Djed protocol.

### Why was my OD mint rejected?
OD minting is blocked when the reserve ratio would drop below 400%. Wait for the ratio to improve (via BTC price increase or ORC minting) and try again.

### Why was my ORC mint rejected?
ORC minting is blocked when the reserve ratio is already above 800%. The reserve is sufficiently capitalised and doesn't need more collateral.

## ORC & Yield

### How does ORC make money?
Every protocol operation (mint/burn of either token) charges a 1.5% fee. These fees accumulate in the WBTC reserve, increasing the equity that ORC represents. Over time, each ORC becomes backed by more WBTC.

### Is ORC a stablecoin?
No. ORC is an **equity token** that absorbs BTC price volatility. Its value fluctuates with BTC price and protocol activity. Think of it as shares in the WBTC reserve.

### What's the risk of holding ORC?
If BTC price drops significantly, ORC loses value because the equity shrinks. ORC holders bear the volatility that OD holders are protected from.

## Network & Wallet

### Which wallet do I need?
**OPWallet** version 1.8.2 or later. It's a browser extension wallet for the OPNet network.

### Which network should I use?
Use **OPNet Testnet** for testing with free tokens. Mainnet will be available after launch.

### Where can I see my transactions?
Transaction confirmations appear in the OD app interface. You can also check the OPNet block explorer for detailed transaction information.
```

**Step 2: Verify** — dev server, check FAQ page.

**Step 3: Commit**

```bash
git add docs/faq.md
git commit -m "feat(docs): add FAQ page"
```

---

### Task 9: Final Build & Zip

**Step 1: Full build**

```bash
cd docs && npm run docs:build
```

Expect output in `docs/.vitepress/dist/`.

**Step 2: Verify** — run `npm run docs:preview` and click through every page, check sidebar, check search.

**Step 3: Create zip**

```bash
cd docs/.vitepress/dist && zip -r /home/mwaddip/projects/od/docs-dist.zip .
```

**Step 4: Final commit and push**

```bash
git add -A docs/
git commit -m "feat(docs): complete OD documentation site"
git push origin master
```

Plan complete and saved to `docs/plans/2026-02-28-docs-site-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

Which approach?

<function_calls>
<invoke name="AskUserQuestion">
<parameter name="questions">[{"question": "How should I execute this plan?", "header": "Execution", "options": [{"label": "Subagent-Driven (this session)", "description": "Dispatch fresh subagent per task, review between tasks, fast iteration in this conversation"}, {"label": "Just do it directly", "description": "Execute the plan tasks sequentially right here without subagent overhead"}], "multiSelect": false}]