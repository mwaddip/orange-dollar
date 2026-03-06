import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SharedNetworkConfig {
  label: string;
  rpcUrl: string;
  addresses: {
    od: string;
    orc: string;
    reserve: string;
    wbtc: string;
    factory: string;
    router: string;
  };
}

export interface ServerConfig {
  port: number;
  ecdsaPrivateKey: string | null;
  walletPassphrase: string;
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

function loadSharedConfig(networkName: string): SharedNetworkConfig {
  // Production: /etc/orange-dollar/config.json
  // Development: ../../shared/config.json (relative to server/src/)
  const prodPath = '/etc/orange-dollar/config.json';
  const devPath = resolve(__dirname, '../../shared/config.json');
  const configPath = existsSync(prodPath) ? prodPath : devPath;

  if (!existsSync(configPath)) {
    console.error(`Config not found at ${prodPath} or ${devPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, SharedNetworkConfig>;
  const net = raw[networkName];
  if (!net) {
    console.error(`Network "${networkName}" not found in ${configPath}`);
    process.exit(1);
  }

  return net;
}

export function loadConfig(): ServerConfig {
  const networkName = process.env['OPNET_NETWORK'] ?? 'testnet';
  const shared = loadSharedConfig(networkName);

  return {
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    ecdsaPrivateKey: process.env['ECDSA_PRIVATE_KEY'] || null,
    walletPassphrase: required('WALLET_PASSPHRASE'),
    opnetNodeUrl: shared.rpcUrl,
    opnetNetwork: networkName,
    permafrostPublicKey: required('PERMAFROST_PUBLIC_KEY'),
    addresses: shared.addresses,
  };
}
