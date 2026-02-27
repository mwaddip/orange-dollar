/**
 * deploy.ts -- Deploy OD, ORC, and ODReserve contracts to OPNet.
 *
 * Deployment sequence:
 *   1. Deploy OD       (no constructor args — reserve set post-deploy)
 *   2. Deploy ORC      (no constructor args — reserve set post-deploy)
 *   3. Deploy ODReserve (onDeployment reads: odAddr, orcAddr, wbtcAddr, factoryAddr)
 *   4. Call OD.setReserve(odReserveAddress)   — owner-only, one-shot
 *   5. Call ORC.setReserve(odReserveAddress)  — owner-only, one-shot
 *
 * Steps 4-5 are handled by bootstrap.ts (step 0) since they require
 * contract interaction (not deployment).
 *
 * Prerequisites:
 *   - source ~/projects/sharedenv/opnet-regtest.env (or opnet-testnet.env)
 *   - WBTC contract already deployed (address in env or passed as arg)
 *   - Build artifacts in build/ directory (npm run build)
 *   - Funded deployer wallet (BTC UTXOs at the deployer's p2tr address)
 *
 * Environment variables:
 *   OPNET_DEPLOYER_MNEMONIC   -- Deployer wallet mnemonic (required)
 *   OPNET_NODE_URL             -- OPNet node URL (default: https://testnet.opnet.org)
 *   OPNET_NETWORK              -- "regtest" | "testnet" | "bitcoin" (default: testnet)
 *   OPNET_WBTC_ADDRESS         -- WBTC contract address (required)
 *   OPNET_MOTOSWAP_FACTORY     -- MotoSwap factory address (required)
 *   FEE_RATE                   -- Fee rate in sat/vB (default: 100)
 *   GAS_SAT_FEE                -- Gas fee in satoshis (default: 100000)
 *
 * Usage:
 *   npx tsx scripts/deploy.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    Mnemonic,
    MLDSASecurityLevel,
    TransactionFactory,
    BinaryWriter,
    type Address,
    type Wallet,
    type IDeploymentParameters,
    type UTXO,
    type DeploymentResult,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks, type Network } from '@btc-vision/bitcoin';

// ── Configuration ───────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`ERROR: Environment variable ${name} is required but not set.`);
        process.exit(1);
    }
    return value;
}

function optionalEnv(name: string, fallback: string): string {
    return process.env[name] || fallback;
}

function resolveNetwork(name: string): Network {
    switch (name) {
        case 'bitcoin':
            return networks.bitcoin;
        case 'testnet':
            return networks.opnetTestnet;
        case 'regtest':
            return networks.regtest;
        default:
            console.error(`ERROR: Unknown network "${name}". Use bitcoin, testnet, or regtest.`);
            process.exit(1);
    }
}

// ── Build artifacts ─────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(PROJECT_ROOT, 'build');

function loadBytecode(filename: string): Uint8Array {
    const filePath = path.join(BUILD_DIR, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`ERROR: Build artifact not found: ${filePath}`);
        console.error('Run "npm run build" first.');
        process.exit(1);
    }
    return fs.readFileSync(filePath);
}

// ── Calldata builders ───────────────────────────────────────────────────────

/**
 * Build calldata for ODReserve.onDeployment(odAddr, orcAddr, wbtcAddr, factoryAddr).
 */
function buildReserveCalldata(
    odAddr: Address,
    orcAddr: Address,
    wbtcAddr: Address,
    factoryAddr: Address,
): Uint8Array {
    const writer = new BinaryWriter();
    writer.writeAddress(odAddr);
    writer.writeAddress(orcAddr);
    writer.writeAddress(wbtcAddr);
    writer.writeAddress(factoryAddr);
    return writer.getBuffer();
}

// ── Deployment helper ───────────────────────────────────────────────────────

interface DeployParams {
    factory: TransactionFactory;
    provider: JSONRpcProvider;
    wallet: Wallet;
    network: Network;
    feeRate: number;
    gasSatFee: bigint;
    utxos: UTXO[];
}

async function deployContract(
    params: DeployParams,
    bytecode: Uint8Array,
    calldata: Uint8Array,
    label: string,
): Promise<{ result: DeploymentResult; nextUtxos: UTXO[] }> {
    const { factory, provider, wallet, network, feeRate, gasSatFee, utxos } = params;

    console.log(`\n--- Deploying ${label} ---`);
    console.log(`  UTXOs available: ${utxos.length}`);

    const challenge = await provider.getChallenge();

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
        calldata,
        challenge,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey: true,
    };

    const result = await factory.signDeployment(deploymentParams);

    console.log(`  Contract address: ${result.contractAddress}`);

    // Broadcast funding transaction
    const fundingResult = await provider.sendRawTransaction(result.transaction[0], false);
    console.log(`  Funding TX:      ${fundingResult.result ?? '(broadcast success)'}`);

    // Broadcast deployment transaction
    const revealResult = await provider.sendRawTransaction(result.transaction[1], false);
    console.log(`  Reveal TX:       ${revealResult.result ?? '(broadcast success)'}`);

    console.log(`  Remaining UTXOs: ${result.utxos.length}`);

    return { result, nextUtxos: result.utxos };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // Read configuration
    const mnemonicPhrase = requiredEnv('OPNET_DEPLOYER_MNEMONIC');
    const nodeUrl = optionalEnv('OPNET_NODE_URL', 'https://testnet.opnet.org');
    const networkName = optionalEnv('OPNET_NETWORK', 'testnet');
    const wbtcAddressHex = requiredEnv('OPNET_WBTC_ADDRESS');
    const factoryAddressHex = requiredEnv('OPNET_MOTOSWAP_FACTORY');
    const feeRate = parseInt(optionalEnv('FEE_RATE', '100'), 10);
    const gasSatFee = BigInt(optionalEnv('GAS_SAT_FEE', '100000'));

    const network = resolveNetwork(networkName);

    console.log('=== OD System Deployment ===');
    console.log(`Network:  ${networkName}`);
    console.log(`Node:     ${nodeUrl}`);
    console.log(`Fee rate: ${feeRate} sat/vB`);
    console.log(`Gas fee:  ${gasSatFee} sat`);

    // Initialise wallet (BIP86 path matching OPWallet)
    const mnemonic = new Mnemonic(mnemonicPhrase, '', network, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(undefined, 0, 0, false);
    console.log(`Deployer: ${wallet.p2tr}`);
    console.log(`OPNet ID: ${wallet.address.toHex()}`);

    // Initialise provider and factory
    const provider = new JSONRpcProvider({ url: nodeUrl, network });
    const factory = new TransactionFactory();

    // Resolve pre-existing contract addresses to Address objects
    // (needed for BinaryWriter.writeAddress in ODReserve calldata)
    console.log('\nResolving contract addresses...');
    const wbtcAddr = await provider.getPublicKeyInfo(wbtcAddressHex, true);
    const factoryAddr = await provider.getPublicKeyInfo(factoryAddressHex, true);
    console.log(`  WBTC:    ${wbtcAddr.toHex()}`);
    console.log(`  Factory: ${factoryAddr.toHex()}`);

    // Load bytecode
    const odBytecode = loadBytecode('OD.wasm');
    const orcBytecode = loadBytecode('ORC.wasm');
    const reserveBytecode = loadBytecode('ODReserve.wasm');

    console.log(`\nBytecode sizes:`);
    console.log(`  OD:        ${odBytecode.length} bytes`);
    console.log(`  ORC:       ${orcBytecode.length} bytes`);
    console.log(`  ODReserve: ${reserveBytecode.length} bytes`);

    // Fetch initial UTXOs
    let utxos = await provider.utxoManager.getUTXOs({
        address: wallet.p2tr,
    });

    if (utxos.length === 0) {
        console.error('\nERROR: No UTXOs available at deployer address.');
        console.error('Fund the address first:', wallet.p2tr);
        process.exit(1);
    }

    console.log(`\nInitial UTXOs: ${utxos.length}`);

    // ── Deploy contracts ────────────────────────────────────────────────

    const deployParams: DeployParams = {
        factory,
        provider,
        wallet,
        network,
        feeRate,
        gasSatFee,
        utxos,
    };

    // 1. Deploy OD (no constructor calldata — reserve set via setReserve post-deploy)
    const odDeploy = await deployContract(deployParams, odBytecode, new Uint8Array(0), 'OD (Orange Dollar)');
    utxos = odDeploy.nextUtxos;
    deployParams.utxos = utxos;

    // 2. Deploy ORC (no constructor calldata)
    const orcDeploy = await deployContract(deployParams, orcBytecode, new Uint8Array(0), 'ORC (Orange Reserve Coin)');
    utxos = orcDeploy.nextUtxos;
    deployParams.utxos = utxos;

    // 3. Deploy ODReserve — resolve just-deployed OD/ORC addresses for calldata
    console.log('\nResolving OD/ORC addresses for ODReserve calldata...');
    const odAddr = await provider.getPublicKeyInfo(odDeploy.result.contractAddress, true);
    const orcAddr = await provider.getPublicKeyInfo(orcDeploy.result.contractAddress, true);

    const reserveCalldata = buildReserveCalldata(odAddr, orcAddr, wbtcAddr, factoryAddr);
    const reserveDeploy = await deployContract(deployParams, reserveBytecode, reserveCalldata, 'ODReserve');

    // ── Summary ─────────────────────────────────────────────────────────

    console.log('\n=== Deployment Complete ===');
    console.log(`OD contract:        ${odDeploy.result.contractAddress}`);
    console.log(`ORC contract:       ${orcDeploy.result.contractAddress}`);
    console.log(`ODReserve contract: ${reserveDeploy.result.contractAddress}`);
    console.log(`WBTC address:       ${wbtcAddressHex}`);
    console.log(`Factory address:    ${factoryAddressHex}`);

    console.log('\nIMPORTANT: Run bootstrap.ts step 0 to call setReserve on OD and ORC.');
    console.log('This links the tokens to the ODReserve contract.\n');
    console.log('Save these for bootstrap.ts:');
    console.log(`  export OD_ADDRESS="${odDeploy.result.contractAddress}"`);
    console.log(`  export ORC_ADDRESS="${orcDeploy.result.contractAddress}"`);
    console.log(`  export ODRESERVE_ADDRESS="${reserveDeploy.result.contractAddress}"`);

    // Cleanup
    mnemonic.zeroize();
    wallet.zeroize();
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
