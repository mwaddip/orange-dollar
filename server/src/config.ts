export interface ServerConfig {
  port: number;
  deployerMnemonic: string;
  opnetNodeUrl: string;
  opnetNetwork: string;
  permafrostPublicKey: string;
  addresses: {
    od: string;
    orc: string;
    reserve: string;
    wbtc: string;
    factory: string;
    router: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    deployerMnemonic: required('DEPLOYER_MNEMONIC'),
    opnetNodeUrl: process.env['OPNET_NODE_URL'] ?? 'https://testnet.opnet.org/api/v1/json-rpc',
    opnetNetwork: process.env['OPNET_NETWORK'] ?? 'testnet',
    permafrostPublicKey: required('PERMAFROST_PUBLIC_KEY'),
    addresses: {
      od: required('OD_ADDRESS'),
      orc: required('ORC_ADDRESS'),
      reserve: required('RESERVE_ADDRESS'),
      wbtc: required('WBTC_ADDRESS'),
      factory: required('MOTOSWAP_FACTORY'),
      router: required('MOTOSWAP_ROUTER'),
    },
  };
}
