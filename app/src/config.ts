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
    network: networks.testnet,
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
