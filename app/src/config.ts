import { networks, type Network } from '@btc-vision/bitcoin';

export interface NetworkConfig {
  name: string;
  label: string;
  rpcUrl: string;
  network: Network;
  /** Optional PERMAFROST threshold ML-DSA public key (hex). When set and
   *  the connected wallet is NOT the contract owner, the admin page enables
   *  multi-party threshold signing mode. */
  permafrostPublicKey?: string;
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
      od: '0x32aa95fa34585c7f01d70e02a191548cc7af6ad1cd74c13e16e19c2dad88123b',
      orc: '0xfebf1d5da9cec9c9b37ed1e841df4470ac3c6608ab0d02af2a6557204a4ae190',
      reserve: '0x3de883cb1919e92bfa8521ee25308e80fb5eed787fd128e0afee2494628eb50c',
      wbtc: '0xbc9affbfdb6a3c88835ddf388a169c30b77fd877c71f3ba349127a6924a015d0',
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
