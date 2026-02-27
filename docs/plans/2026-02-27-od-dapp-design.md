# OD dApp Design

Date: 2026-02-27

## Purpose

Combined operator + end-user dApp for the Orange Dollar protocol. Operators bootstrap and monitor the protocol. Users mint/burn OD and ORC, transfer tokens, and view protocol health.

## Stack

- React 18 + Vite + TypeScript
- `opnet` — `getContract()`, `JSONRpcProvider`, `OP_20_ABI`
- `@btc-vision/walletconnect` — `WalletProvider`, `useWallet()`
- `@btc-vision/bitcoin` — `networks.opnetTestnet`, `networks.bitcoin`
- `@btc-vision/transaction` — `Address`, `TransactionFactory`
- No external state library (React Context only)
- No CSS framework (custom CSS matching landing page)

Lives in `app/` subdirectory of the contracts monorepo.

## Network Configuration

A `config.ts` maps network names to RPC URLs and contract addresses:

- **testnet** — `networks.opnetTestnet`, `https://testnet.opnet.org`
- **mainnet** — `networks.bitcoin`, TBD URL

Default network: testnet until March 17 2026, then mainnet.

Regtest is discontinued. No regtest config.

Testnet contract addresses (infrastructure):

| Contract | Address |
|----------|---------|
| NativeSwap | `0x4397befe4e067390596b3c296e77fe86589487bf3bf3f0a9a93ce794e2d78fb5` |
| MotoSwap Router | `0x0e6ff1f2d7db7556cb37729e3738f4dae82659b984b2621fab08e1111b1b937a` |
| MotoSwap Factory | `0xa02aa5ca4c307107484d5fb690d811df1cf526f8de204d24528653dcae369a0f` |
| MOTO | `0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd` |

OD/ORC/ODReserve addresses TBD after testnet deployment.

## Contract Interaction Pattern

Every write operation follows the same flow:

```
getContract(address, ABI, provider, network, senderAddress)
  → contract.method(params)          // simulates on RPC node
  → check simulation.revert          // show error if reverted
  → simulation.sendTransaction({
      signer: null,                   // OPWallet handles signing
      mldsaSigner: null,              // OPWallet handles MLDSA
      refundTo: account.addressTyped,
      network, feeRate, priorityFee,
      maximumAllowedSatToSpend
    })
  → OPWallet popup → user approves → broadcast
  → refresh state
```

Read-only calls (balances, ratios, phase) need no signing.

## UI Layout

Single-page app with persistent header and three tabs.

### Header

- OD logo (left)
- Tab navigation: Trade | Dashboard | Admin
- Network selector dropdown (right)
- Wallet connect button (right) — truncated address when connected

### Trade Tab (default)

Primary user interface for protocol interaction.

- Token toggle: OD / ORC
- Action selector: Mint / Burn
- Input field for amount (WBTC for mint, token for burn)
- Live estimate of output amount at current TWAP
- Fee display (1.5%)
- Execute button (disabled if wallet not connected)
- User balances section: WBTC, OD, ORC
- Transfer section: pick token, enter recipient + amount, send
- Approve section: pick token, enter spender + amount, approve

### Dashboard Tab

Protocol health at a glance. Auto-refreshes every 60 seconds.

- Phase indicator (SEEDING / PREMINT / LIVE)
- Stat cards: Reserve Ratio, TWAP Price, Equity
- Reserve WBTC total
- OD and ORC total supply
- TWAP window (blocks)
- Health bar: visual ratio between min (400%) and max (800%)

### Admin Tab

Operator tools. Write actions only work for deployer wallet.

- Warning banner: "Admin functions require deployer wallet"
- Bootstrap wizard: step-by-step (0-8), auto-detects current phase and hides wizard when LIVE
- Protocol status: owner address, reserve-set flags
- Emergency controls: placeholder for future admin functions

Bootstrap auto-detection logic:
- Read `getPhase()` from ODReserve
- If LIVE → hide wizard, show "Protocol is live" status
- If SEEDING or PREMINT → show wizard, starting from the appropriate step

## ABIs

### OD / ORC

Extend `OP_20_ABI` with:
- `setReserve(address)` — selector `0xb86a7d16`

### ODReserve

Full custom ABI with all public methods:

| Method | Params | Returns |
|--------|--------|---------|
| getPhase | none | u8 |
| getReserveRatio | none | u256 |
| getEquity | none | u256 |
| getTwap | none | u256 |
| getTwapWindow | none | u256 |
| mintORC | u256 wbtcAmount | u256 orcMinted |
| burnORC | u256 orcAmount | u256 wbtcReturned |
| mintOD | u256 wbtcAmount | u256 odMinted |
| burnOD | u256 odAmount | u256 wbtcReturned |
| advancePhase | u256 seedPrice | bool |
| premintOD | u256 amount | bool |
| initPool | address pool | bool |
| updateTwapSnapshot | none | bool |

Selectors computed from `src/selectors.ts` (SHA256 first 4 bytes).

## State Management

### WalletContext

Provided by `@btc-vision/walletconnect`'s `WalletProvider`:
- `account`, `connect()`, `disconnect()`

### ProtocolContext

Custom React context wrapping all contract reads:
- Protocol stats: phase, reserveRatio, equity, twap, twapWindow
- Supplies: odSupply, orcSupply, reserveWbtc
- User balances: wbtc, od, orc
- Derived: isAdmin (connected address === deployer)
- Network config: selected network's addresses + RPC URL
- `refresh()` manual trigger

### Polling

- Dashboard/Admin tab active → poll every 60 seconds
- Trade tab active → no background polling, refresh after transactions
- Tab not visible (document.visibilityState === hidden) → stop polling

### Transaction State

Each operation tracks: `idle → simulating → awaiting_approval → broadcasting → confirmed | error`

Toast notifications for success and error.

## Error Handling

- Simulation revert → show revert message inline (e.g. "Reserve ratio would drop below 400%")
- Wallet not connected → disable action buttons, show "Connect wallet"
- OPWallet not installed → show install link
- RPC errors → toast with retry
- Admin actions by non-deployer → buttons disabled, tooltip "Deployer wallet required"
- Network mismatch → warn if wallet network differs from selected network

## File Structure

```
app/
  index.html
  vite.config.ts
  tsconfig.json
  package.json
  src/
    main.tsx                    # Entry, WalletProvider + ProtocolProvider
    App.tsx                     # Tab layout, header, network selector
    config.ts                   # Network configs (testnet, mainnet)
    abi/
      od.ts                     # OP-20 + setReserve
      orc.ts                    # OP-20 + setReserve
      odReserve.ts              # Full custom ABI
    context/
      ProtocolContext.tsx        # Protocol state, polling, contract reads
    hooks/
      useContractCall.ts        # Generic simulate → send → toast flow
    components/
      Header.tsx                # Logo, tabs, network selector, wallet button
      WalletButton.tsx          # Connect/disconnect, truncated address
      Trade.tsx                 # Mint/burn OD/ORC, transfer, approve
      Dashboard.tsx             # Protocol stats, health bar
      Admin.tsx                 # Bootstrap wizard, status, emergency
      Toast.tsx                 # Notifications
    styles/
      global.css                # CSS vars, fonts, dark theme
```

## Visual Design

Matches the existing landing page (`site/index.html`):
- Fonts: Space Grotesk (display) + DM Sans (body) via Google Fonts
- Palette: `#0A0A0A` background, `#F7931A` orange accent, `#F5F7FA` text
- Dark theme throughout
- Subtle gradients and glows for emphasis
- No CSS framework
