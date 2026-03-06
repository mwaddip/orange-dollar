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

interface RawNetworkEntry {
  label: string;
  rpcUrl: string;
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
        addresses: entry.addresses,
      },
    ]),
  );
}

// Default network: testnet until March 17 2026, then mainnet
const now = new Date();
const MAINNET_DATE = new Date('2026-03-17');
export const DEFAULT_NETWORK = now >= MAINNET_DATE ? 'mainnet' : 'testnet';
