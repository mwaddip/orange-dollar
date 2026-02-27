/**
 * deploy-mock-wbtc.ts -- Deploy MockWBTC to OPNet testnet.
 *
 * Usage:
 *   source ~/projects/sharedenv/opnet-regtest.env
 *   npx tsx scripts/deploy-mock-wbtc.ts
 *
 * Env vars:
 *   OPNET_DEPLOYER_MNEMONIC  -- Deployer mnemonic (required)
 *   OPNET_NODE_URL            -- RPC URL (default: testnet)
 *   OPNET_NETWORK             -- Network name (default: testnet)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    Mnemonic,
    MLDSASecurityLevel,
    TransactionFactory,
    type IDeploymentParameters,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks, type Network } from '@btc-vision/bitcoin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

async function main(): Promise<void> {
    const mnemonicPhrase = process.env.OPNET_DEPLOYER_MNEMONIC;
    if (!mnemonicPhrase) {
        console.error('ERROR: OPNET_DEPLOYER_MNEMONIC not set.');
        console.error('Run: source ~/projects/sharedenv/opnet-regtest.env');
        process.exit(1);
    }

    const nodeUrl = process.env.OPNET_NODE_URL || 'https://testnet.opnet.org';
    const networkName = process.env.OPNET_NETWORK || 'testnet';
    const feeRate = parseInt(process.env.FEE_RATE || '100', 10);
    const gasSatFee = BigInt(process.env.GAS_SAT_FEE || '100000');

    const network = resolveNetwork(networkName);

    console.log('=== Deploy MockWBTC ===');
    console.log(`Network:  ${networkName}`);
    console.log(`Node:     ${nodeUrl}`);
    console.log(`Fee rate: ${feeRate} sat/vB`);
    console.log(`Gas fee:  ${gasSatFee} sat`);

    // Load bytecode
    const wasmPath = path.resolve(__dirname, '..', 'build', 'MockWBTC.wasm');
    if (!fs.existsSync(wasmPath)) {
        console.error(`ERROR: ${wasmPath} not found. Run "npm run build" first.`);
        process.exit(1);
    }
    const bytecode = fs.readFileSync(wasmPath);
    console.log(`Bytecode: ${bytecode.length} bytes`);

    // Init wallet (deriveOPWallet uses BIP86 path matching OPWallet)
    const mnemonic = new Mnemonic(mnemonicPhrase, '', network, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(undefined, 0, 0, false);
    console.log(`Deployer: ${wallet.p2tr}`);
    console.log(`OPNet ID: ${wallet.address.toHex()}`);

    // Provider
    const provider = new JSONRpcProvider({ url: nodeUrl, network });

    // Fetch UTXOs
    const utxos = await provider.utxoManager.getUTXOs({
        address: wallet.p2tr,
    });
    console.log(`UTXOs:    ${utxos.length}`);

    if (utxos.length === 0) {
        console.error('\nERROR: No UTXOs at deployer address.');
        console.error('Fund this address:', wallet.p2tr);
        process.exit(1);
    }

    // Get challenge
    const challenge = await provider.getChallenge();

    // Deploy
    const factory = new TransactionFactory();
    const deploymentParams: IDeploymentParameters = {
        from: wallet.p2tr,
        utxos,
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network,
        feeRate,
        priorityFee: 0n,
        gasSatFee,
        bytecode,
        calldata: new Uint8Array(0),
        challenge,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey: true,
    };

    console.log('\nSigning deployment...');
    const result = await factory.signDeployment(deploymentParams);
    console.log(`Contract address: ${result.contractAddress}`);

    // Broadcast
    console.log('Broadcasting funding TX...');
    const fundingResult = await provider.sendRawTransaction(result.transaction[0], false);
    console.log(`Funding TX:  ${fundingResult.result ?? '(success)'}`);

    console.log('Broadcasting reveal TX...');
    const revealResult = await provider.sendRawTransaction(result.transaction[1], false);
    console.log(`Reveal TX:   ${revealResult.result ?? '(success)'}`);

    console.log(`\n=== MockWBTC Deployed ===`);
    console.log(`Address: ${result.contractAddress}`);
    console.log(`\nSave this:`);
    console.log(`  export OPNET_WBTC_ADDRESS="${result.contractAddress}"`);

    mnemonic.zeroize();
    wallet.zeroize();
}

main().catch((err) => {
    console.error('Deploy failed:', err);
    process.exit(1);
});
