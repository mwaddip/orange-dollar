/**
 * resolve-addresses.ts — Resolve OPNet contract addresses to hex tweaked pubkeys.
 *
 * Usage:
 *   source ~/projects/sharedenv/opnet-testnet.env
 *   npx tsx scripts/resolve-addresses.ts <addr1> [addr2] [addr3]
 *
 * Prints each address in 0x-prefixed hex format.
 */

import { JSONRpcProvider } from 'opnet';
import { networks, type Network } from '@btc-vision/bitcoin';

function resolveNetwork(name: string): Network {
    switch (name) {
        case 'bitcoin': return networks.bitcoin;
        case 'testnet': return networks.opnetTestnet;
        case 'regtest': return networks.regtest;
        default:
            console.error(`Unknown network: ${name}`);
            process.exit(1);
    }
}

async function main() {
    const addrs = process.argv.slice(2);
    if (addrs.length === 0) {
        console.error('Usage: npx tsx scripts/resolve-addresses.ts <addr1> [addr2] ...');
        process.exit(1);
    }

    const nodeUrl = process.env['OPNET_NODE_URL'] || 'https://testnet.opnet.org';
    const networkName = process.env['OPNET_NETWORK'] || 'testnet';
    const network = resolveNetwork(networkName);

    const provider = new JSONRpcProvider({ url: nodeUrl, network });

    for (const raw of addrs) {
        try {
            const addr = await provider.getPublicKeyInfo(raw, true);
            console.log(`${raw} => ${addr.toHex()}`);
        } catch (err) {
            console.error(`Failed to resolve ${raw}:`, err);
        }
    }
}

main().catch(console.error);
