# OD dApp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React + Vite dApp in `app/` that lets users trade OD/ORC tokens and lets the operator bootstrap and monitor the protocol.

**Architecture:** Single-page tab-based app (Trade / Dashboard / Admin). Connects to OPWallet via `@btc-vision/walletconnect`. Reads/writes contracts using `opnet`'s `getContract()` with simulation-before-send pattern. Custom CSS matching the existing landing page (dark theme, Space Grotesk + DM Sans, orange/black).

**Tech Stack:** React 18, Vite, TypeScript, `opnet`, `@btc-vision/walletconnect`, `@btc-vision/bitcoin`, `@btc-vision/transaction`

**Design doc:** `docs/plans/2026-02-27-od-dapp-design.md`

---

## Task 1: Scaffold Vite + React Project

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/vite.config.ts`
- Create: `app/index.html`
- Create: `app/src/main.tsx`
- Create: `app/src/App.tsx`
- Create: `app/src/vite-env.d.ts`

**Step 1: Create `app/` directory and initialise**

```bash
mkdir -p app/src
```

**Step 2: Write `app/package.json`**

```json
{
  "name": "od-dapp",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "opnet": "^1.8.1-rc.15",
    "@btc-vision/walletconnect": "latest",
    "@btc-vision/bitcoin": "^6.5.6",
    "@btc-vision/transaction": "latest"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.9.3",
    "vite": "^6.2.0"
  }
}
```

**Step 3: Write `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"]
}
```

**Step 4: Write `app/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
});
```

Note: `global: 'globalThis'` is needed because some OPNet packages reference Node's `global`.

**Step 5: Write `app/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Orange Dollar</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Write `app/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

**Step 7: Write `app/src/main.tsx`** (minimal stub)

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 8: Write `app/src/App.tsx`** (minimal stub)

```tsx
export function App() {
  return <div>OD dApp</div>;
}
```

**Step 9: Install dependencies and verify dev server starts**

```bash
cd app && npm install && npm run dev
```

Expected: Vite dev server starts on port 5173 and shows "OD dApp" in browser.

**Step 10: Commit**

```bash
git add app/
git commit -m "feat(app): scaffold Vite + React project"
```

---

## Task 2: Global Styles

**Files:**
- Create: `app/src/styles/global.css`
- Modify: `app/src/main.tsx` (import CSS)

**Step 1: Write `app/src/styles/global.css`**

CSS variables and base styles matching the landing page exactly:

```css
:root {
  --bg:          #0A0A0A;
  --bg-raised:   #111111;
  --bg-surface:  #161616;
  --bg-card:     #1A1A1A;
  --orange:      #F7931A;
  --orange-dim:  #F7931A99;
  --orange-glow: #F7931A22;
  --white:       #F5F7FA;
  --white-dim:   #F5F7FA99;
  --gray:        #6B6B6B;
  --gray-light:  #8A8A8A;
  --red:         #E74C3C;
  --green:       #2ECC71;
  --font-display: 'Space Grotesk', sans-serif;
  --font-body:    'DM Sans', sans-serif;
  --radius:      8px;
  --radius-lg:   12px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root {
  height: 100%;
  background: var(--bg);
  color: var(--white);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

button {
  font-family: var(--font-display);
  cursor: pointer;
  border: none;
  outline: none;
}

input, select {
  font-family: var(--font-body);
  background: var(--bg-raised);
  color: var(--white);
  border: 1px solid var(--gray);
  border-radius: var(--radius);
  padding: 10px 14px;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s;
}

input:focus, select:focus {
  border-color: var(--orange);
}

input::placeholder {
  color: var(--gray);
}
```

**Step 2: Import in `main.tsx`**

Add `import './styles/global.css';` at the top of `app/src/main.tsx`.

**Step 3: Verify** — Dev server shows dark background with correct font.

**Step 4: Commit**

```bash
git add app/src/styles/ app/src/main.tsx
git commit -m "feat(app): add global CSS theme matching landing page"
```

---

## Task 3: Network Config

**Files:**
- Create: `app/src/config.ts`

**Step 1: Write `app/src/config.ts`**

```ts
import { networks, type Network } from '@btc-vision/bitcoin';

export interface NetworkConfig {
  name: string;
  label: string;
  rpcUrl: string;
  network: Network;
  addresses: {
    od: string;
    orc: string;
    reserve: string;
    wbtc: string;
    factory: string;
    router: string;
  };
}

export const NETWORKS: Record<string, NetworkConfig> = {
  testnet: {
    name: 'testnet',
    label: 'Testnet',
    rpcUrl: 'https://testnet.opnet.org/api/v1/json-rpc',
    network: networks.opnetTestnet,
    addresses: {
      od: '',        // Set after testnet deployment
      orc: '',       // Set after testnet deployment
      reserve: '',   // Set after testnet deployment
      wbtc: '',      // Set after testnet deployment
      factory: '0xa02aa5ca4c307107484d5fb690d811df1cf526f8de204d24528653dcae369a0f',
      router: '0x0e6ff1f2d7db7556cb37729e3738f4dae82659b984b2621fab08e1111b1b937a',
    },
  },
  mainnet: {
    name: 'mainnet',
    label: 'Mainnet',
    rpcUrl: 'https://api.opnet.org/api/v1/json-rpc',
    network: networks.bitcoin,
    addresses: {
      od: '',
      orc: '',
      reserve: '',
      wbtc: '',
      factory: '',
      router: '',
    },
  },
};

// Default network: testnet until March 17 2026, then mainnet
const now = new Date();
const MAINNET_DATE = new Date('2026-03-17');
export const DEFAULT_NETWORK = now >= MAINNET_DATE ? 'mainnet' : 'testnet';
```

**Step 2: Commit**

```bash
git add app/src/config.ts
git commit -m "feat(app): add network config with testnet and mainnet"
```

---

## Task 4: Contract ABIs

**Files:**
- Create: `app/src/abi/op20.ts`
- Create: `app/src/abi/odReserve.ts`

These define ABI arrays compatible with `opnet`'s `getContract()`.

**Step 1: Write `app/src/abi/op20.ts`**

Extends the standard OP_20_ABI with `setReserve`:

```ts
import { ABIDataTypes } from '@btc-vision/transaction';
import { BitcoinAbiTypes, OP_20_ABI } from 'opnet';

/**
 * OP-20 ABI extended with setReserve(address).
 * Used for OD and ORC contracts.
 */
export const OD_ORC_ABI = [
  ...OP_20_ABI,
  {
    name: 'setReserve',
    inputs: [{ name: 'reserve', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];
```

**Step 2: Write `app/src/abi/odReserve.ts`**

Full ABI for ODReserve. Every method signature must match the contract exactly (selectors are SHA256 of the canonical signature, computed automatically by `getContract`):

```ts
import { ABIDataTypes } from '@btc-vision/transaction';
import { BitcoinAbiTypes } from 'opnet';
import type { BitcoinInterfaceAbi } from 'opnet';

export const OD_RESERVE_ABI: BitcoinInterfaceAbi = [
  // ── View methods ─────────────────────────────────────────────
  {
    name: 'getPhase',
    constant: true,
    inputs: [],
    outputs: [{ name: 'phase', type: ABIDataTypes.UINT8 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getReserveRatio',
    constant: true,
    inputs: [],
    outputs: [{ name: 'ratio', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getEquity',
    constant: true,
    inputs: [],
    outputs: [{ name: 'equity', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getTwap',
    constant: true,
    inputs: [],
    outputs: [{ name: 'twap', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getTwapWindow',
    constant: true,
    inputs: [],
    outputs: [{ name: 'blocks', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },

  // ── ORC operations ───────────────────────────────────────────
  {
    name: 'mintORC',
    inputs: [{ name: 'wbtcAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'orcMinted', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'burnORC',
    inputs: [{ name: 'orcAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'wbtcReturned', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },

  // ── OD operations ────────────────────────────────────────────
  {
    name: 'mintOD',
    inputs: [{ name: 'wbtcAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'odMinted', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'burnOD',
    inputs: [{ name: 'odAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'wbtcReturned', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },

  // ── Bootstrap / admin ────────────────────────────────────────
  {
    name: 'advancePhase',
    inputs: [{ name: 'seedPrice', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'premintOD',
    inputs: [{ name: 'odAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'initPool',
    inputs: [{ name: 'poolAddress', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'updateTwapSnapshot',
    inputs: [],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];
```

**Step 3: Verify** — `cd app && npx tsc --noEmit` should pass (types resolve).

**Step 4: Commit**

```bash
git add app/src/abi/
git commit -m "feat(app): add contract ABIs for OD, ORC, and ODReserve"
```

---

## Task 5: Protocol Context (Contract Reads + Polling)

**Files:**
- Create: `app/src/context/ProtocolContext.tsx`

This is the core state provider. It creates `JSONRpcProvider` and `getContract` instances, reads all protocol stats and user balances, and polls every 60s.

**Step 1: Write `app/src/context/ProtocolContext.tsx`**

```tsx
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { JSONRpcProvider, getContract, OP_20_ABI } from 'opnet';
import { Address } from '@btc-vision/transaction';
import { OD_RESERVE_ABI } from '../abi/odReserve';
import { OD_ORC_ABI } from '../abi/op20';
import { NETWORKS, DEFAULT_NETWORK, type NetworkConfig } from '../config';

// ── Types ──────────────────────────────────────────────────────

interface ProtocolState {
  phase: number;
  reserveRatio: bigint;
  equity: bigint;
  twap: bigint;
  twapWindow: bigint;
  odSupply: bigint;
  orcSupply: bigint;
  wbtcReserve: bigint;   // reserve's WBTC balance
  userOd: bigint;
  userOrc: bigint;
  userWbtc: bigint;
  loading: boolean;
  error: string | null;
}

interface ProtocolContextValue extends ProtocolState {
  networkConfig: NetworkConfig;
  setNetworkName: (name: string) => void;
  connectedAddress: string | null;
  setConnectedAddress: (addr: string | null) => void;
  isAdmin: boolean;
  refresh: () => void;
}

const DEFAULT_STATE: ProtocolState = {
  phase: -1,
  reserveRatio: 0n,
  equity: 0n,
  twap: 0n,
  twapWindow: 0n,
  odSupply: 0n,
  orcSupply: 0n,
  wbtcReserve: 0n,
  userOd: 0n,
  userOrc: 0n,
  userWbtc: 0n,
  loading: true,
  error: null,
};

const ProtocolContext = createContext<ProtocolContextValue | null>(null);

export function useProtocol(): ProtocolContextValue {
  const ctx = useContext(ProtocolContext);
  if (!ctx) throw new Error('useProtocol must be inside ProtocolProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────

export function ProtocolProvider({ children }: { children: ReactNode }) {
  const [networkName, setNetworkName] = useState(DEFAULT_NETWORK);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [state, setState] = useState<ProtocolState>(DEFAULT_STATE);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const networkConfig = NETWORKS[networkName]!;

  // Check if connected wallet is the deployer (admin).
  // For now, compare against a known deployer address (set after deployment).
  // A more robust approach: read the contract's owner storage, but ODReserve
  // doesn't expose a public owner() method. We'll compare addresses client-side.
  const isAdmin = false; // Will be refined once deployer address is known

  const fetchState = useCallback(async () => {
    const { rpcUrl, network, addresses } = networkConfig;
    if (!addresses.reserve || !addresses.od || !addresses.orc || !addresses.wbtc) {
      setState((s) => ({ ...s, loading: false, error: 'Contract addresses not configured for this network' }));
      return;
    }

    try {
      const provider = new JSONRpcProvider(rpcUrl, network);

      // ODReserve reads
      const reserve = getContract(addresses.reserve, OD_RESERVE_ABI, provider, network);
      const [phaseRes, ratioRes, equityRes, twapRes, windowRes] = await Promise.all([
        reserve.getPhase(),
        reserve.getReserveRatio(),
        reserve.getEquity(),
        reserve.getTwap(),
        reserve.getTwapWindow(),
      ]);

      // Token supply reads
      const odContract = getContract(addresses.od, OD_ORC_ABI, provider, network);
      const orcContract = getContract(addresses.orc, OD_ORC_ABI, provider, network);
      const wbtcContract = getContract(addresses.wbtc, OP_20_ABI, provider, network);

      const [odSupplyRes, orcSupplyRes, wbtcReserveRes] = await Promise.all([
        odContract.totalSupply(),
        orcContract.totalSupply(),
        wbtcContract.balanceOf(Address.fromString(addresses.reserve)),
      ]);

      // User balance reads (if connected)
      let userOd = 0n, userOrc = 0n, userWbtc = 0n;
      if (connectedAddress) {
        const userAddr = Address.fromString(connectedAddress);
        const [uOd, uOrc, uWbtc] = await Promise.all([
          odContract.balanceOf(userAddr),
          orcContract.balanceOf(userAddr),
          wbtcContract.balanceOf(userAddr),
        ]);
        userOd = uOd.properties.balance;
        userOrc = uOrc.properties.balance;
        userWbtc = uWbtc.properties.balance;
      }

      setState({
        phase: phaseRes.properties.phase,
        reserveRatio: ratioRes.properties.ratio,
        equity: equityRes.properties.equity,
        twap: twapRes.properties.twap,
        twapWindow: windowRes.properties.blocks,
        odSupply: odSupplyRes.properties.totalSupply,
        orcSupply: orcSupplyRes.properties.totalSupply,
        wbtcReserve: wbtcReserveRes.properties.balance,
        userOd,
        userOrc,
        userWbtc,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch protocol state',
      }));
    }
  }, [networkConfig, connectedAddress]);

  // Initial fetch + poll every 60s
  useEffect(() => {
    fetchState();
    intervalRef.current = setInterval(fetchState, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchState]);

  // Pause polling when tab is hidden
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else {
        fetchState();
        intervalRef.current = setInterval(fetchState, 60_000);
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [fetchState]);

  return (
    <ProtocolContext.Provider
      value={{
        ...state,
        networkConfig,
        setNetworkName,
        connectedAddress,
        setConnectedAddress,
        isAdmin,
        refresh: fetchState,
      }}
    >
      {children}
    </ProtocolContext.Provider>
  );
}
```

**Important notes for the implementer:**
- The `getContract` return type properties depend on the ABI output names. Access via `result.properties.<outputName>`.
- `JSONRpcProvider` constructor: first arg is the URL string, second is the network object.
- If contract addresses are empty strings, skip fetching and show "not configured" message.

**Step 2: Verify** — `npx tsc --noEmit` passes.

**Step 3: Commit**

```bash
git add app/src/context/
git commit -m "feat(app): add ProtocolContext with contract reads and 60s polling"
```

---

## Task 6: useContractCall Hook

**Files:**
- Create: `app/src/hooks/useContractCall.ts`

Generic hook for simulate → send → track state for any contract write operation.

**Step 1: Write `app/src/hooks/useContractCall.ts`**

```ts
import { useState, useCallback } from 'react';
import { useProtocol } from '../context/ProtocolContext';

export type TxStatus = 'idle' | 'simulating' | 'awaiting_approval' | 'broadcasting' | 'confirmed' | 'error';

interface ContractCallResult {
  status: TxStatus;
  error: string | null;
  execute: () => Promise<void>;
  reset: () => void;
}

/**
 * Generic hook for contract write operations.
 *
 * @param simulateFn - async function that calls the contract method (returns CallResult)
 * @param onSuccess  - callback after successful broadcast
 */
export function useContractCall(
  simulateFn: () => Promise<{ revert?: string; sendTransaction: (params: unknown) => Promise<unknown> }>,
  onSuccess?: () => void,
): ContractCallResult {
  const { networkConfig, connectedAddress, refresh } = useProtocol();
  const [status, setStatus] = useState<TxStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    if (!connectedAddress) {
      setError('Wallet not connected');
      setStatus('error');
      return;
    }

    try {
      setStatus('simulating');
      setError(null);

      const simulation = await simulateFn();

      if (simulation.revert) {
        setError(simulation.revert);
        setStatus('error');
        return;
      }

      setStatus('awaiting_approval');

      const txParams = {
        signer: null,
        mldsaSigner: null,
        refundTo: connectedAddress,
        maximumAllowedSatToSpend: 100_000n,
        network: networkConfig.network,
        feeRate: 10,
        priorityFee: 50_000n,
      };

      setStatus('broadcasting');
      await simulation.sendTransaction(txParams);
      setStatus('confirmed');

      // Refresh protocol state after tx
      refresh();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStatus('error');
    }
  }, [simulateFn, connectedAddress, networkConfig, refresh, onSuccess]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { status, error, execute, reset };
}
```

**Step 2: Commit**

```bash
git add app/src/hooks/
git commit -m "feat(app): add useContractCall hook for simulate-then-send pattern"
```

---

## Task 7: Header + WalletButton + Tab Navigation

**Files:**
- Create: `app/src/components/Header.tsx`
- Create: `app/src/components/WalletButton.tsx`
- Modify: `app/src/App.tsx`
- Create: `app/src/styles/header.css`

**Step 1: Write `app/src/components/WalletButton.tsx`**

```tsx
import { useWallet, SupportedWallets } from '@btc-vision/walletconnect';

export function WalletButton() {
  const { account, connect, disconnect } = useWallet();

  if (account) {
    const addr = account.addressTyped;
    const short = addr.slice(0, 6) + '...' + addr.slice(-4);
    return (
      <button className="wallet-btn connected" onClick={disconnect}>
        {short}
      </button>
    );
  }

  return (
    <button
      className="wallet-btn"
      onClick={() => connect(SupportedWallets.OP_WALLET)}
    >
      Connect Wallet
    </button>
  );
}
```

**Important:** The `useWallet` hook comes from `@btc-vision/walletconnect`. The exact API may vary slightly — check the package exports. The `account.addressTyped` field holds the OPNet-format address string.

**Step 2: Write `app/src/components/Header.tsx`**

```tsx
import { NETWORKS } from '../config';
import { useProtocol } from '../context/ProtocolContext';
import { WalletButton } from './WalletButton';

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = ['Trade', 'Dashboard', 'Admin'];

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const { networkConfig, setNetworkName } = useProtocol();

  return (
    <header className="header">
      <div className="header-left">
        <span className="logo">OD</span>
        <nav className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>
      <div className="header-right">
        <select
          className="network-select"
          value={networkConfig.name}
          onChange={(e) => setNetworkName(e.target.value)}
        >
          {Object.values(NETWORKS).map((net) => (
            <option key={net.name} value={net.name}>
              {net.label}
            </option>
          ))}
        </select>
        <WalletButton />
      </div>
    </header>
  );
}
```

**Step 3: Write `app/src/styles/header.css`**

```css
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 64px;
  background: var(--bg-raised);
  border-bottom: 1px solid #222;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 32px;
}

.logo {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  color: var(--orange);
  letter-spacing: -0.5px;
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  background: none;
  color: var(--gray-light);
  font-size: 14px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--radius);
  transition: all 0.15s;
}

.tab:hover {
  color: var(--white);
  background: var(--bg-surface);
}

.tab.active {
  color: var(--orange);
  background: var(--orange-glow);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.network-select {
  background: var(--bg-surface);
  color: var(--white-dim);
  border: 1px solid #333;
  border-radius: var(--radius);
  padding: 6px 12px;
  font-size: 13px;
  font-family: var(--font-body);
}

.wallet-btn {
  background: var(--orange);
  color: var(--bg);
  font-size: 14px;
  font-weight: 600;
  padding: 8px 20px;
  border-radius: var(--radius);
  transition: opacity 0.15s;
}

.wallet-btn:hover {
  opacity: 0.85;
}

.wallet-btn.connected {
  background: var(--bg-surface);
  color: var(--orange);
  border: 1px solid var(--orange-dim);
}
```

**Step 4: Update `app/src/App.tsx`**

```tsx
import { useState } from 'react';
import { Header } from './components/Header';
import './styles/header.css';

export function App() {
  const [activeTab, setActiveTab] = useState('Trade');

  return (
    <div className="app">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="main">
        {activeTab === 'Trade' && <div>Trade (coming next)</div>}
        {activeTab === 'Dashboard' && <div>Dashboard (coming next)</div>}
        {activeTab === 'Admin' && <div>Admin (coming next)</div>}
      </main>
    </div>
  );
}
```

**Step 5: Update `app/src/main.tsx`** to wrap with providers

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletProvider } from '@btc-vision/walletconnect';
import { ProtocolProvider } from './context/ProtocolContext';
import { App } from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <ProtocolProvider>
        <App />
      </ProtocolProvider>
    </WalletProvider>
  </StrictMode>,
);
```

**Step 6: Wire wallet state into ProtocolContext**

The `ProtocolProvider` needs to know the connected address. Add a bridge component or effect in `App.tsx` that calls `setConnectedAddress` when the wallet connects/disconnects. The exact approach depends on how `useWallet()` exposes the address — check the hook's return type.

**Step 7: Verify** — Dev server shows header with tabs, network selector, and Connect Wallet button.

**Step 8: Commit**

```bash
git add app/src/
git commit -m "feat(app): add Header, WalletButton, tab navigation, and providers"
```

---

## Task 8: Dashboard Tab

**Files:**
- Create: `app/src/components/Dashboard.tsx`
- Create: `app/src/styles/dashboard.css`
- Create: `app/src/utils/format.ts`

**Step 1: Write `app/src/utils/format.ts`**

Shared formatting utilities for u256 values in 1e8 scale:

```ts
const SCALE = 100_000_000n;

/** Format a u256 (1e8 scale) as a human-readable number with `decimals` decimal places. */
export function formatU256(value: bigint, decimals = 2): string {
  const whole = value / SCALE;
  const frac = value % SCALE;
  const fracStr = frac.toString().padStart(8, '0').slice(0, decimals);
  return `${whole.toLocaleString()}.${fracStr}`;
}

/** Format a u256 as a percentage (1e8 scale: 400_000_000 = 400%). */
export function formatPercent(value: bigint, decimals = 1): string {
  return formatU256(value, decimals) + '%';
}

/** Format a u256 as a USD price (1e8 scale). */
export function formatUsd(value: bigint, decimals = 2): string {
  return '$' + formatU256(value, decimals);
}

/** Format a u256 as BTC (1e8 scale, 8 decimals). */
export function formatBtc(value: bigint): string {
  return formatU256(value, 8) + ' BTC';
}

/** Phase number to human name. */
export function phaseName(phase: number): string {
  switch (phase) {
    case 0: return 'SEEDING';
    case 1: return 'PREMINT';
    case 2: return 'LIVE';
    default: return 'UNKNOWN';
  }
}
```

**Step 2: Write `app/src/components/Dashboard.tsx`**

```tsx
import { useProtocol } from '../context/ProtocolContext';
import { formatU256, formatPercent, formatUsd, formatBtc, phaseName } from '../utils/format';
import '../styles/dashboard.css';

export function Dashboard() {
  const {
    phase, reserveRatio, equity, twap, twapWindow,
    odSupply, orcSupply, wbtcReserve, loading, error,
  } = useProtocol();

  if (loading) return <div className="dashboard-loading">Loading protocol data...</div>;
  if (error) return <div className="dashboard-error">{error}</div>;

  // Health bar: map ratio between 400% (min) and 800% (max)
  const minRatio = 400_000_000n;
  const maxRatio = 800_000_000n;
  const clampedRatio = reserveRatio < minRatio ? minRatio : reserveRatio > maxRatio ? maxRatio : reserveRatio;
  const healthPct = Number((clampedRatio - minRatio) * 100n / (maxRatio - minRatio));

  return (
    <div className="dashboard">
      <div className="phase-badge" data-phase={phase}>
        {phaseName(phase)}
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-label">Reserve Ratio</div>
          <div className="stat-value">{formatPercent(reserveRatio)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TWAP Price</div>
          <div className="stat-value">{formatUsd(twap)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Equity</div>
          <div className="stat-value">{formatBtc(equity)}</div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-row">
          <span className="detail-label">Reserve WBTC</span>
          <span className="detail-value">{formatU256(wbtcReserve, 8)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">OD Supply</span>
          <span className="detail-value">{formatU256(odSupply)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">ORC Supply</span>
          <span className="detail-value">{formatU256(orcSupply)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">TWAP Window</span>
          <span className="detail-value">{twapWindow.toString()} blocks</span>
        </div>
      </div>

      <div className="health-bar-container">
        <div className="health-bar-labels">
          <span>400%</span>
          <span>Reserve Health</span>
          <span>800%</span>
        </div>
        <div className="health-bar">
          <div
            className="health-bar-fill"
            style={{ width: `${healthPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Write `app/src/styles/dashboard.css`**

```css
.dashboard {
  max-width: 800px;
  margin: 0 auto;
  padding: 32px 24px;
}

.phase-badge {
  display: inline-block;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 20px;
  margin-bottom: 24px;
  background: var(--orange-glow);
  color: var(--orange);
  border: 1px solid var(--orange-dim);
}

.stat-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid #222;
  border-radius: var(--radius-lg);
  padding: 20px;
}

.stat-label {
  font-size: 13px;
  color: var(--gray-light);
  margin-bottom: 8px;
}

.stat-value {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  color: var(--white);
}

.detail-grid {
  background: var(--bg-card);
  border: 1px solid #222;
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 32px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #1e1e1e;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  color: var(--gray-light);
  font-size: 14px;
}

.detail-value {
  font-family: var(--font-display);
  font-weight: 500;
  color: var(--white);
}

.health-bar-container {
  background: var(--bg-card);
  border: 1px solid #222;
  border-radius: var(--radius-lg);
  padding: 20px;
}

.health-bar-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--gray-light);
  margin-bottom: 8px;
}

.health-bar {
  height: 8px;
  background: var(--bg-raised);
  border-radius: 4px;
  overflow: hidden;
}

.health-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--red), var(--orange), var(--green));
  border-radius: 4px;
  transition: width 0.5s ease;
}

.dashboard-loading, .dashboard-error {
  text-align: center;
  padding: 64px 24px;
  color: var(--gray-light);
}

.dashboard-error {
  color: var(--red);
}

@media (max-width: 640px) {
  .stat-cards { grid-template-columns: 1fr; }
}
```

**Step 4: Wire into `App.tsx`** — replace `<div>Dashboard (coming next)</div>` with `<Dashboard />`.

**Step 5: Verify** — Dashboard tab shows stat cards and health bar. If no contracts deployed yet, shows "Contract addresses not configured" error.

**Step 6: Commit**

```bash
git add app/src/
git commit -m "feat(app): add Dashboard tab with protocol stats and health bar"
```

---

## Task 9: Trade Tab

**Files:**
- Create: `app/src/components/Trade.tsx`
- Create: `app/src/styles/trade.css`

This is the most complex component. Split into three sections: Mint/Burn, Balances, Transfer/Approve.

**Step 1: Write `app/src/components/Trade.tsx`**

The Trade component includes:
- Token selector (OD / ORC toggle)
- Action selector (Mint / Burn)
- Amount input with live output estimate
- Fee display
- Execute button with status feedback
- Balance display for WBTC, OD, ORC
- Transfer section (token, recipient, amount)
- Approve section (token, spender, amount)

For the mint/burn operations, the component:
1. Creates a `getContract` instance for ODReserve
2. Calls the appropriate method (mintOD, burnOD, mintORC, burnORC)
3. Uses the `useContractCall` hook for the simulate → send flow

**Key implementation details:**
- For `mintOD`/`mintORC`: user inputs WBTC amount
- For `burnOD`: user inputs OD amount, receives WBTC
- For `burnORC`: user inputs ORC amount, receives WBTC
- WBTC approval: before minting, user must approve ODReserve to spend their WBTC. Check allowance first, prompt approval if needed.
- Output estimate: for minting, `estimate = wbtcAmount * twap * (1 - fee) / 1e8`. For burning, `estimate = odAmount * 1e8 / twap * (1 - fee)`. These are approximations — the simulation gives the exact number.

The transfer and approve sections use standard OP-20 `transfer(address, uint256)` and `approve(address, uint256)`.

**Step 2: Write `app/src/styles/trade.css`**

Trade panel centered, max-width 480px. Card-style form with input fields. Token toggle as pill buttons. Action buttons with loading states.

**Step 3: Wire into `App.tsx`**.

**Step 4: Verify** — Trade tab shows the mint/burn form, balances, and transfer section.

**Step 5: Commit**

```bash
git add app/src/
git commit -m "feat(app): add Trade tab with mint/burn, transfer, and approve"
```

---

## Task 10: Toast Notifications

**Files:**
- Create: `app/src/components/Toast.tsx`
- Create: `app/src/styles/toast.css`
- Create: `app/src/context/ToastContext.tsx`

Simple toast system: renders a stack of toasts in the bottom-right corner. Each toast auto-dismisses after 5 seconds (success) or stays until dismissed (error).

**Step 1: Write `app/src/context/ToastContext.tsx`**

Provides `addToast(message, type)` to the component tree. Types: `success`, `error`, `info`.

**Step 2: Write `app/src/components/Toast.tsx`**

Renders active toasts. CSS animation for slide-in from right.

**Step 3: Write `app/src/styles/toast.css`**

Fixed position bottom-right, z-index above everything. Orange border for success, red for error.

**Step 4: Wire ToastProvider into `main.tsx`**, use `addToast` in `useContractCall` hook.

**Step 5: Verify** — Trigger a test toast (temporarily), see it appear and auto-dismiss.

**Step 6: Commit**

```bash
git add app/src/
git commit -m "feat(app): add toast notification system"
```

---

## Task 11: Admin Tab

**Files:**
- Create: `app/src/components/Admin.tsx`
- Create: `app/src/styles/admin.css`

**Step 1: Write `app/src/components/Admin.tsx`**

The Admin component auto-detects protocol phase and shows:

- If `phase === 2` (LIVE): "Protocol is live" status card, no wizard.
- If `phase < 2`: Bootstrap wizard with steps 0-8.

Each bootstrap step is a card with:
- Step number and description
- Input fields for parameters (e.g. seedPrice for advancePhase, amount for premintOD)
- Execute button (disabled if not connected, or if not admin)
- Status indicator (done / pending / current)

The wizard determines current step from protocol state:
- Phase 0 (SEEDING) + no ORC supply → step 0 (setReserve) or step 1 (mintORC)
- Phase 0 (SEEDING) + ORC supply > 0 → step 2 (advancePhase)
- Phase 1 (PREMINT) + no OD preminted → step 3 (premintOD)
- Phase 1 (PREMINT) + OD preminted + no pool → steps 4-7
- Phase 1 (PREMINT) + pool initialized → step 8 (wait for TWAP)

Protocol status section (always visible):
- Owner address
- Phase
- All stats from Dashboard

Emergency controls: placeholder section with "Coming soon" message.

**Step 2: Write `app/src/styles/admin.css`**

Step cards stacked vertically. Active step highlighted with orange border. Completed steps have green check. Future steps are dimmed.

**Step 3: Wire into `App.tsx`**.

**Step 4: Verify** — Admin tab shows bootstrap wizard or "Protocol is live" depending on phase.

**Step 5: Commit**

```bash
git add app/src/
git commit -m "feat(app): add Admin tab with bootstrap wizard and protocol status"
```

---

## Task 12: Polish and Final Integration

**Files:**
- Modify: `app/src/App.tsx` (responsive layout)
- Modify: `app/src/styles/global.css` (responsive tweaks)
- Create: `app/src/styles/app.css`

**Step 1: Add app layout CSS**

```css
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.main {
  flex: 1;
  overflow-y: auto;
}
```

**Step 2: Add responsive breakpoints**

At 640px: collapse header into hamburger or stacked layout, single-column stat cards.

**Step 3: Test all tabs end-to-end**

Verify:
- Wallet connects and shows truncated address
- Network switching updates provider
- Dashboard shows loading → data (or error if no contracts)
- Trade form submits (simulation, approval popup, broadcast)
- Admin wizard correctly detects phase
- Toasts appear for success/error

**Step 4: Commit**

```bash
git add app/
git commit -m "feat(app): polish layout and responsive design"
```

---

## Task 13: Update Root README

**Files:**
- Modify: `README.md`

**Step 1: Add dApp section to README**

Add a section after "Project Structure" explaining how to run the dApp:

```markdown
## dApp

The `app/` directory contains a React frontend for interacting with the protocol.

### Run Locally

```bash
cd app
npm install
npm run dev
```

Opens at http://localhost:5173. Requires OPWallet browser extension.
```

**Step 2: Update project structure tree** to include `app/`.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add dApp section to README"
```

---

## Summary

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Scaffold Vite + React | `feat(app): scaffold Vite + React project` |
| 2 | Global CSS | `feat(app): add global CSS theme matching landing page` |
| 3 | Network config | `feat(app): add network config with testnet and mainnet` |
| 4 | Contract ABIs | `feat(app): add contract ABIs for OD, ORC, and ODReserve` |
| 5 | Protocol context | `feat(app): add ProtocolContext with contract reads and 60s polling` |
| 6 | useContractCall hook | `feat(app): add useContractCall hook for simulate-then-send pattern` |
| 7 | Header + wallet + tabs | `feat(app): add Header, WalletButton, tab navigation, and providers` |
| 8 | Dashboard tab | `feat(app): add Dashboard tab with protocol stats and health bar` |
| 9 | Trade tab | `feat(app): add Trade tab with mint/burn, transfer, and approve` |
| 10 | Toast notifications | `feat(app): add toast notification system` |
| 11 | Admin tab | `feat(app): add Admin tab with bootstrap wizard and protocol status` |
| 12 | Polish + responsive | `feat(app): polish layout and responsive design` |
| 13 | Update README | `docs: add dApp section to README` |
