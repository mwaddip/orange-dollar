import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { JSONRpcProvider, getContract } from 'opnet';
import type { IOP20Contract, CallResult, BaseContractProperties } from 'opnet';
import type { ContractDecodedObjectResult } from 'opnet';
import { Address } from '@btc-vision/transaction';
import { NETWORKS, DEFAULT_NETWORK } from '../config';
import type { NetworkConfig } from '../config';
import { OD_RESERVE_ABI } from '../abi/odReserve';
import { OD_ORC_ABI } from '../abi/op20';

// ---------------------------------------------------------------------------
// State & context value types
// ---------------------------------------------------------------------------

interface ProtocolState {
  phase: number;
  reserveRatio: bigint;
  equity: bigint;
  twap: bigint;
  twapWindow: bigint;
  odSupply: bigint;
  orcSupply: bigint;
  wbtcReserve: bigint;
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

const INITIAL_STATE: ProtocolState = {
  phase: 0,
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

const POLL_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ProtocolContext = createContext<ProtocolContextValue | null>(null);

export function useProtocol(): ProtocolContextValue {
  const ctx = useContext(ProtocolContext);
  if (!ctx) {
    throw new Error('useProtocol must be used within a ProtocolProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helper: typed result property accessor
// ---------------------------------------------------------------------------

/**
 * All contract calls via the `opnet` proxy return a `CallResult` whose
 * `properties` field is an object keyed by the ABI output `name`.
 *
 * For single-output view calls the first (and only) key gives us the
 * value we need. This helper extracts it with a type assertion.
 */
function prop<T>(result: CallResult<ContractDecodedObjectResult>, key: string): T {
  return result.properties[key] as T;
}

// ---------------------------------------------------------------------------
// Reserve contract interface (view methods only)
// ---------------------------------------------------------------------------

interface IODReserveContract extends BaseContractProperties {
  getPhase(): Promise<CallResult<{ phase: number }>>;
  getReserveRatio(): Promise<CallResult<{ ratio: bigint }>>;
  getEquity(): Promise<CallResult<{ equity: bigint }>>;
  getTwap(): Promise<CallResult<{ twap: bigint }>>;
  getTwapWindow(): Promise<CallResult<{ blocks: bigint }>>;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ProtocolProvider({ children }: { children: ReactNode }) {
  // -- Network selection ----------------------------------------------------
  const [networkName, setNetworkName] = useState<string>(DEFAULT_NETWORK);
  const networkConfig = useMemo<NetworkConfig>(() => {
    const cfg = NETWORKS[networkName];
    if (!cfg) {
      throw new Error(`Unknown network: ${networkName}`);
    }
    return cfg;
  }, [networkName]);

  // -- Wallet connection (set externally) -----------------------------------
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  // -- Protocol state -------------------------------------------------------
  const [state, setState] = useState<ProtocolState>(INITIAL_STATE);

  // -- JSON RPC provider (recreated on network change) ----------------------
  const providerRef = useRef<JSONRpcProvider | null>(null);

  useEffect(() => {
    providerRef.current = new JSONRpcProvider({
      url: networkConfig.rpcUrl,
      network: networkConfig.network,
    });
    // Provider does not need explicit cleanup for HTTP mode.
  }, [networkConfig]);

  // -- Fetch logic ----------------------------------------------------------
  const fetchAll = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) return;

    const { addresses } = networkConfig;

    // Guard: contracts not configured
    if (!addresses.od || !addresses.orc || !addresses.reserve || !addresses.wbtc) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: 'Contract addresses not configured',
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      // -- Build contract proxies -------------------------------------------
      const reserveContract = getContract<IODReserveContract>(
        addresses.reserve,
        OD_RESERVE_ABI,
        provider,
        networkConfig.network,
      );

      const odContract = getContract<IOP20Contract>(
        addresses.od,
        OD_ORC_ABI,
        provider,
        networkConfig.network,
      );

      const orcContract = getContract<IOP20Contract>(
        addresses.orc,
        OD_ORC_ABI,
        provider,
        networkConfig.network,
      );

      const wbtcContract = getContract<IOP20Contract>(
        addresses.wbtc,
        OD_ORC_ABI,
        provider,
        networkConfig.network,
      );

      // -- Protocol stats (parallel) ----------------------------------------
      const [phaseRes, ratioRes, equityRes, twapRes, twapWindowRes, odSupplyRes, orcSupplyRes, wbtcReserveRes] =
        await Promise.all([
          reserveContract.getPhase(),
          reserveContract.getReserveRatio(),
          reserveContract.getEquity(),
          reserveContract.getTwap(),
          reserveContract.getTwapWindow(),
          odContract.totalSupply(),
          orcContract.totalSupply(),
          wbtcContract.balanceOf(Address.fromString(addresses.reserve)),
        ]);

      const phase = prop<number>(phaseRes, 'phase');
      const reserveRatio = prop<bigint>(ratioRes, 'ratio');
      const equity = prop<bigint>(equityRes, 'equity');
      const twap = prop<bigint>(twapRes, 'twap');
      const twapWindow = prop<bigint>(twapWindowRes, 'blocks');
      const odSupply = prop<bigint>(odSupplyRes, 'totalSupply');
      const orcSupply = prop<bigint>(orcSupplyRes, 'totalSupply');
      const wbtcReserve = prop<bigint>(wbtcReserveRes, 'balance');

      // -- User balances (only if connected) --------------------------------
      let userOd = 0n;
      let userOrc = 0n;
      let userWbtc = 0n;

      if (connectedAddress) {
        const userAddr = Address.fromString(connectedAddress);
        const [userOdRes, userOrcRes, userWbtcRes] = await Promise.all([
          odContract.balanceOf(userAddr),
          orcContract.balanceOf(userAddr),
          wbtcContract.balanceOf(userAddr),
        ]);

        userOd = prop<bigint>(userOdRes, 'balance');
        userOrc = prop<bigint>(userOrcRes, 'balance');
        userWbtc = prop<bigint>(userWbtcRes, 'balance');
      }

      setState({
        phase,
        reserveRatio,
        equity,
        twap,
        twapWindow,
        odSupply,
        orcSupply,
        wbtcReserve,
        userOd,
        userOrc,
        userWbtc,
        loading: false,
        error: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  }, [networkConfig, connectedAddress]);

  // -- Initial fetch + 60 s polling (paused when hidden) --------------------
  useEffect(() => {
    // Fetch immediately
    void fetchAll();

    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (intervalId) return;
      intervalId = setInterval(() => {
        void fetchAll();
      }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        // Refresh immediately when returning, then resume polling
        void fetchAll();
        startPolling();
      }
    }

    // Only poll when the page is visible
    if (document.visibilityState !== 'hidden') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchAll]);

  // -- isAdmin placeholder --------------------------------------------------
  const isAdmin = false;

  // -- Context value --------------------------------------------------------
  const value = useMemo<ProtocolContextValue>(
    () => ({
      ...state,
      networkConfig,
      setNetworkName,
      connectedAddress,
      setConnectedAddress,
      isAdmin,
      refresh: fetchAll,
    }),
    [state, networkConfig, connectedAddress, fetchAll],
  );

  return (
    <ProtocolContext.Provider value={value}>
      {children}
    </ProtocolContext.Provider>
  );
}
