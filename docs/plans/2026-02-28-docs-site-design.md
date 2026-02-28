# OD Documentation Site — Design

## Context

Orange Dollar needs a user-facing documentation site. The audience is end users and investors — people minting/burning OD and ORC, not developers building on top. The site should feel like part of the OD brand (dark theme, orange accents) and live at a subdomain like `docs.orangedollar.xyz`.

## Tool

**VitePress** — Markdown-first static site generator built on Vite. GitBook-like sidebar layout, built-in dark theme, built-in search. Same toolchain the project already uses.

## Location

`docs/` in the existing repo. Builds to `docs/.vitepress/dist/`. Root `package.json` gets `docs:dev` and `docs:build` scripts.

## Theming

Override VitePress CSS variables to match the OD brand:
- `--vp-c-brand-1`: `#F7931A` (orange)
- `--vp-c-bg`: `#0D0F12`
- `--vp-c-bg-soft`: `#141720`
- `--vp-c-text-1`: `#EDF0F2`
- Font: Inter (already used across all OD sites)
- OD logo in the navbar

## Site Map / Table of Contents

```
Introduction
├── What is Orange Dollar?
├── How It Works (dual-token visual explainer)
└── Contract Addresses (testnet + mainnet table)

Using OD
├── Getting Started (OPWallet setup, testnet faucet)
├── Minting OD (deposit WBTC → receive OD)
└── Burning OD (return OD → redeem WBTC)

Using ORC
├── Why ORC? (equity, fee yield, risk profile)
├── Minting ORC (deposit WBTC → receive ORC)
└── Burning ORC (exit equity position)

Protocol
├── Reserve Ratio (400%–800% bounds, what they mean)
├── TWAP Oracle (6-block window, MotoSwap pool)
├── Fees (1.5% flat, where they go)
├── Bootstrap Phases (SEEDING → PREMINT → LIVE)
├── Bootstrap Guide (step-by-step, adapted from existing guide)
└── Admin Functions (what the owner can do post-LIVE)

Security & Governance
├── Djed Formalism (link to IOHK paper, invariant summary)
├── PERMAFROST Multisig
│   ├── What it is (3-of-5 threshold ML-DSA)
│   ├── Signers (table: name, role, social link — placeholder rows)
│   └── What they control (admin capabilities after ownership transfer)
└── Risk Factors (collateral, oracle, smart contract risks)

FAQ
└── Common questions (collateralisation, stability, ORC yield, withdrawal, networks)
```

## Page Content Notes

**Contract Addresses**: Table with columns: Contract, Testnet Address, Mainnet Address. Rows for OD, ORC, ODReserve, WBTC (MockWBTC on testnet). Include links to OPNet explorer when available.

**Bootstrap Guide**: Adapt the existing `docs/bootstrap-guide.md` content almost verbatim — it's already well-written for a general audience.

**Admin Functions**: Explain what the owner can do once LIVE — currently just `transferOwnership()`. Clarify that fee rates and ratio bounds are compile-time constants (not admin-adjustable). Explain that once ownership transfers to PERMAFROST, individual signers cannot act alone.

**PERMAFROST Signers Table**: Placeholder with 5 rows:
```
| # | Name | Role | Contact |
|---|------|------|---------|
| 1 | TBD  | —    | —       |
| 2 | TBD  | —    | —       |
| 3 | TBD  | —    | —       |
| 4 | TBD  | —    | —       |
| 5 | TBD  | —    | —       |
```

**Risk Factors**: Honest disclosure — WBTC depeg risk, TWAP manipulation (mitigated by 6-block window), smart contract bugs (no formal audit yet), threshold key custody risks.

## Verification

```bash
cd docs && npm install && npm run docs:dev   # local preview
npm run docs:build                           # static build
# Open browser, verify all pages render, sidebar works, search works
# Check dark theme matches OD brand
# Zip docs/.vitepress/dist/ for deployment
```
