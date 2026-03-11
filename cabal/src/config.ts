import { networks, type Network } from '@btc-vision/bitcoin';

export interface NetworkConfig {
  name: string;
  label: string;
  rpcUrl: string;
  network: Network;
  /** PERMAFROST threshold ML-DSA public key (hex). When set, the admin page
   *  enables multi-party threshold signing mode. */
  permafrostPublicKey?: string;
  /** CABAL submission server URL. When set, threshold signatures are
   *  auto-submitted to the server for execution. */
  cabalApiUrl?: string;
  /** Encrypted relay server URL for WebSocket-based ceremony coordination. */
  relayUrl?: string;
  addresses: {
    od: string;
    orc: string;
    reserve: string;
    wbtc: string;
    factory: string;
    router: string;
  };
}

interface RawNetworkEntry {
  label: string;
  rpcUrl: string;
  permafrostPublicKey?: string;
  relayUrl?: string;
  addresses: NetworkConfig['addresses'];
}

const NETWORK_MAP: Record<string, Network> = {
  testnet: networks.opnetTestnet,
  mainnet: networks.bitcoin,
};

export async function loadNetworks(): Promise<Record<string, NetworkConfig>> {
  const res = await fetch('/config.json');
  if (!res.ok) throw new Error(`Failed to load /config.json: ${res.status}`);
  const data = (await res.json()) as Record<string, RawNetworkEntry>;

  return Object.fromEntries(
    Object.entries(data).map(([name, entry]) => [
      name,
      {
        name,
        label: entry.label,
        rpcUrl: entry.rpcUrl,
        network: NETWORK_MAP[name] ?? networks.opnetTestnet,
        permafrostPublicKey: entry.permafrostPublicKey,
        cabalApiUrl: '/api/cabal',
        relayUrl: entry.relayUrl,
        addresses: entry.addresses,
      },
    ]),
  );
}

// Default network: testnet until March 17 2026, then mainnet
const now = new Date();
const MAINNET_DATE = new Date('2026-03-17');
export const DEFAULT_NETWORK = now >= MAINNET_DATE ? 'mainnet' : 'testnet';
