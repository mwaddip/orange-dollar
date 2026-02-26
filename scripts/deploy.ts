/**
 * deploy.ts -- Deploy OD, ORC, and ODReserve contracts to OPNet.
 *
 * Deployment sequence:
 *   1. Deploy OD       (onDeployment reads: reserveAddress)
 *   2. Deploy ORC      (onDeployment reads: reserveAddress)
 *   3. Deploy ODReserve (onDeployment reads: odAddr, orcAddr, wbtcAddr, factoryAddr)
 *
 * Circular dependency:
 *   OD and ORC store the ODReserve address at deployment time (immutable).
 *   ODReserve stores the OD and ORC addresses at deployment time.
 *   We cannot deploy ODReserve first because it needs OD/ORC addresses,
 *   and we cannot deploy OD/ORC first because they need the ODReserve address.
 *
 * Resolution strategy (regtest/testnet):
 *   Option A -- Pre-compute the ODReserve address from the deployer's nonce
 *               before deploying OD/ORC. This is the cleanest approach but
 *               requires knowing the OPNet address derivation formula.
 *   Option B -- Deploy OD/ORC with a placeholder reserve address, then deploy
 *               ODReserve, then upgrade OD/ORC via onUpdate to fix the address.
 *               OD/ORC currently have empty onUpdate() stubs, so this requires
 *               adding update logic first.
 *   Option C -- Deploy all three with known-good addresses from a previous run.
 *               Useful for re-deployment to the same environment.
 *
 *   This script uses Option A when ODRESERVE_ADDRESS is provided (pre-computed),
 *   and falls back to a sequential deploy that logs all addresses for Option C.
 *
 * Prerequisites:
 *   - source ~/projects/sharedenv/opnet-regtest.env
 *   - WBTC contract already deployed (address in env or passed as arg)
 *   - Build artifacts in build/ directory (npm run build)
 *   - Funded deployer wallet (BTC UTXOs at the deployer's p2tr address)
 *
 * Environment variables:
 *   OPNET_MNEMONIC            -- Deployer wallet mnemonic (required)
 *   OPNET_NODE_URL            -- OPNet node URL (default: https://regtest.opnet.org)
 *   OPNET_NETWORK             -- "regtest" | "testnet" | "bitcoin" (default: regtest)
 *   OPNET_WBTC_ADDRESS        -- WBTC contract address (required)
 *   OPNET_MOTOSWAP_FACTORY    -- MotoSwap factory address (required)
 *   ODRESERVE_ADDRESS         -- Pre-computed ODReserve address (optional, for Option A)
 *   FEE_RATE                  -- Fee rate in sat/vB (default: 5)
 *   GAS_SAT_FEE               -- Gas fee in satoshis (default: 10000)
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
    Address,
    Wallet,
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
            return networks.testnet;
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
 * Build calldata for OD.onDeployment(reserveAddress: Address).
 */
function buildOdCalldata(reserveAddress: Address): Uint8Array {
    const writer = new BinaryWriter();
    writer.writeAddress(reserveAddress);
    return writer.getBuffer();
}

/**
 * Build calldata for ORC.onDeployment(reserveAddress: Address).
 */
function buildOrcCalldata(reserveAddress: Address): Uint8Array {
    const writer = new BinaryWriter();
    writer.writeAddress(reserveAddress);
    return writer.getBuffer();
}

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
        priorityFee: BigInt(0),
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
    const mnemonicPhrase = requiredEnv('OPNET_MNEMONIC');
    const nodeUrl = optionalEnv('OPNET_NODE_URL', 'https://regtest.opnet.org');
    const networkName = optionalEnv('OPNET_NETWORK', 'regtest');
    const wbtcAddressHex = requiredEnv('OPNET_WBTC_ADDRESS');
    const factoryAddressHex = requiredEnv('OPNET_MOTOSWAP_FACTORY');
    const precomputedReserveHex = process.env['ODRESERVE_ADDRESS'] || '';
    const feeRate = parseInt(optionalEnv('FEE_RATE', '5'), 10);
    const gasSatFee = BigInt(optionalEnv('GAS_SAT_FEE', '10000'));

    const network = resolveNetwork(networkName);

    console.log('=== OD System Deployment ===');
    console.log(`Network:  ${networkName}`);
    console.log(`Node:     ${nodeUrl}`);
    console.log(`Fee rate: ${feeRate} sat/vB`);
    console.log(`Gas fee:  ${gasSatFee} sat`);

    // Initialise wallet
    const mnemonic = new Mnemonic(mnemonicPhrase, '', network, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.derive(0);
    console.log(`Deployer: ${wallet.p2tr}`);
    console.log(`OPNet ID: ${wallet.address.toHex()}`);

    // Initialise provider and factory
    const provider = new JSONRpcProvider({ url: nodeUrl, network });
    const factory = new TransactionFactory();

    // Parse addresses
    const wbtcAddr = Address.fromString(wbtcAddressHex);
    const factoryAddr = Address.fromString(factoryAddressHex);

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

    // ── Determine reserve address for OD/ORC deployment ─────────────────

    let reserveAddrForTokens: Address;

    if (precomputedReserveHex) {
        // Option A: Pre-computed address
        reserveAddrForTokens = Address.fromString(precomputedReserveHex);
        console.log(`\nUsing pre-computed ODReserve address: ${precomputedReserveHex}`);
    } else {
        // Fallback: use deployer address as placeholder.
        // OD/ORC will restrict mint/burn to this address, which means only
        // the deployer can mint/burn until the contracts are upgraded.
        //
        // TODO: Implement onUpdate in OD/ORC to accept a new reserve address,
        //       or implement address pre-computation from the deployer nonce.
        reserveAddrForTokens = wallet.address;
        console.log('\nWARNING: No ODRESERVE_ADDRESS set. Using deployer address as placeholder.');
        console.log('         OD/ORC mint/burn will be restricted to the deployer address.');
        console.log('         Set ODRESERVE_ADDRESS for production deployments.');
    }

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

    // 1. Deploy OD
    const odCalldata = buildOdCalldata(reserveAddrForTokens);
    const odDeploy = await deployContract(deployParams, odBytecode, odCalldata, 'OD (Orange Dollar)');
    utxos = odDeploy.nextUtxos;
    deployParams.utxos = utxos;

    // 2. Deploy ORC
    const orcCalldata = buildOrcCalldata(reserveAddrForTokens);
    const orcDeploy = await deployContract(deployParams, orcBytecode, orcCalldata, 'ORC (Orange Reserve Coin)');
    utxos = orcDeploy.nextUtxos;
    deployParams.utxos = utxos;

    // 3. Deploy ODReserve
    const odAddr = Address.fromString(odDeploy.result.contractAddress);
    const orcAddr = Address.fromString(orcDeploy.result.contractAddress);
    const reserveCalldata = buildReserveCalldata(odAddr, orcAddr, wbtcAddr, factoryAddr);
    const reserveDeploy = await deployContract(deployParams, reserveBytecode, reserveCalldata, 'ODReserve');

    // ── Summary ─────────────────────────────────────────────────────────

    console.log('\n=== Deployment Complete ===');
    console.log(`OD contract:        ${odDeploy.result.contractAddress}`);
    console.log(`ORC contract:       ${orcDeploy.result.contractAddress}`);
    console.log(`ODReserve contract: ${reserveDeploy.result.contractAddress}`);
    console.log(`WBTC address:       ${wbtcAddressHex}`);
    console.log(`Factory address:    ${factoryAddressHex}`);

    if (!precomputedReserveHex) {
        console.log('\n--- IMPORTANT ---');
        console.log('OD and ORC were deployed with the deployer address as the reserve.');
        console.log('The actual ODReserve address is:', reserveDeploy.result.contractAddress);
        console.log('');
        console.log('To fix this, either:');
        console.log('  1. Re-deploy with ODRESERVE_ADDRESS set to the address above');
        console.log('  2. Add setReserve() or onUpdate() support to OD/ORC and upgrade them');
        console.log('');
        console.log('For a clean re-deploy, set this environment variable and run again:');
        console.log(`  export ODRESERVE_ADDRESS="${reserveDeploy.result.contractAddress}"`);
    }

    console.log('\nSave these for bootstrap.ts:');
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
