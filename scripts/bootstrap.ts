/**
 * bootstrap.ts -- Bootstrap the OD system from SEEDING to LIVE.
 *
 * This script walks through the entire bootstrap lifecycle:
 *
 *   Post-deploy setup:
 *     Step 0. Owner calls OD.setReserve(reserveAddr) and ORC.setReserve(reserveAddr)
 *
 *   Phase 0 (SEEDING):
 *     Step 1. Investor(s) call mintORC() to seed the reserve with WBTC
 *
 *   Phase 1 (PREMINT):
 *     Step 2. Owner calls advancePhase(seedPrice) to enter PREMINT
 *     Step 3. Owner calls premintOD(odAmount) to mint initial OD supply
 *     Step 4. Owner approves router to spend WBTC and OD
 *     Step 5. Owner creates MotoSwap WBTC/OD pool via factory.createPool()
 *     Step 6. Owner adds initial liquidity via router.addLiquidity()
 *     Step 7. Owner calls reserve.initPool(poolAddress) to register the pool
 *
 *   Phase 2 (LIVE) -- automatic:
 *     Step 8. Wait for 6 blocks (~1 hour on Bitcoin) for TWAP window to fill
 *     Step 9. Any user interaction that calls _computeTwap() triggers the
 *             automatic PREMINT -> LIVE transition
 *
 * Each step is a separate function. The script runs them in sequence, but you
 * can also call individual steps if re-running after a partial bootstrap.
 *
 * Prerequisites:
 *   - All three contracts deployed (run deploy.ts first)
 *   - Deployer wallet has WBTC for seeding + liquidity
 *   - Deployer wallet has BTC UTXOs for transaction fees
 *
 * Environment variables:
 *   OPNET_DEPLOYER_MNEMONIC   -- Deployer wallet mnemonic (required)
 *   OPNET_NODE_URL             -- OPNet node URL (default: https://testnet.opnet.org)
 *   OPNET_NETWORK              -- "regtest" | "testnet" | "bitcoin" (default: testnet)
 *   OD_ADDRESS                 -- Deployed OD contract address (required)
 *   ORC_ADDRESS                -- Deployed ORC contract address (required)
 *   ODRESERVE_ADDRESS          -- Deployed ODReserve contract address (required)
 *   OPNET_WBTC_ADDRESS         -- WBTC contract address (required)
 *   OPNET_MOTOSWAP_FACTORY     -- MotoSwap Factory address (required)
 *   OPNET_MOTOSWAP_ROUTER      -- MotoSwap Router address (required)
 *
 *   SEED_WBTC_AMOUNT           -- WBTC to deposit in SEEDING phase (default: 1_00000000 = 1 WBTC)
 *   SEED_PRICE                 -- BTC/USD price in 1e8 (default: 10_000_000_000_000 = $100,000)
 *   PREMINT_OD_AMOUNT          -- OD to premint (default: computed for ~500% ratio)
 *   LIQUIDITY_WBTC             -- WBTC to pair with OD in pool (default: 10000000 = 0.1 WBTC)
 *   LIQUIDITY_OD               -- OD to pair with WBTC in pool (default: computed from seedPrice)
 *
 * Usage:
 *   npx tsx scripts/bootstrap.ts [step]
 *
 *   step: optional step number (0-8) to run a single step.
 *         If omitted, runs all steps in sequence.
 */

import {
    Mnemonic,
    MLDSASecurityLevel,
    type Address,
    type Wallet,
} from '@btc-vision/transaction';
import {
    getContract,
    JSONRpcProvider,
    MotoSwapFactoryAbi,
    MOTOSWAP_ROUTER_ABI,
    type TransactionParameters,
    type IMotoswapFactoryContract,
    type IMotoswapRouterContract,
    type IOP20Contract,
    OP_20_ABI,
} from 'opnet';
import { networks, type Network } from '@btc-vision/bitcoin';

import {
    OD_ORC_ABI,
    OD_RESERVE_ABI,
    type IODReserveContract,
    type IODORCContract,
} from './abi';

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

// ── Types ───────────────────────────────────────────────────────────────────

interface BootstrapContext {
    provider: JSONRpcProvider;
    wallet: Wallet;
    network: Network;
    txParams: TransactionParameters;

    // Contract instances
    od: IODORCContract & IOP20Contract;
    orc: IODORCContract & IOP20Contract;
    wbtc: IOP20Contract;
    reserve: IODReserveContract;
    factory: IMotoswapFactoryContract;
    router: IMotoswapRouterContract;

    // Resolved Address objects (needed for contract method params)
    odAddr: Address;
    orcAddr: Address;
    reserveAddr: Address;
    wbtcAddr: Address;
    factoryAddr: Address;
    routerAddr: Address;

    // Bootstrap parameters
    seedWbtcAmount: bigint;
    seedPrice: bigint;
    premintOdAmount: bigint;
    liquidityWbtc: bigint;
    liquidityOd: bigint;
}

// ── Step implementations ────────────────────────────────────────────────────

/**
 * Step 0: Set the ODReserve address on OD and ORC tokens.
 *
 * This must be done after deployment, before any other step.
 * OD.setReserve(reserveAddr) and ORC.setReserve(reserveAddr) are owner-only,
 * one-shot calls that link the tokens to the reserve contract.
 */
async function step0_setReserve(ctx: BootstrapContext): Promise<void> {
    console.log('\n=== Step 0: Set Reserve Address on OD & ORC ===');
    console.log(`  Reserve address: ${ctx.reserveAddr.toHex()}`);

    // OD.setReserve(reserveAddr)
    console.log('  Calling OD.setReserve...');
    const odResult = await ctx.od.setReserve(ctx.reserveAddr);
    if (odResult.revert) {
        throw new Error(`OD.setReserve reverted: ${odResult.revert}`);
    }
    const odTx = await odResult.sendTransaction(ctx.txParams);
    console.log(`  OD.setReserve TX: ${odTx.transactionId}`);

    // ORC.setReserve(reserveAddr)
    console.log('  Calling ORC.setReserve...');
    const orcResult = await ctx.orc.setReserve(ctx.reserveAddr);
    if (orcResult.revert) {
        throw new Error(`ORC.setReserve reverted: ${orcResult.revert}`);
    }
    const orcTx = await orcResult.sendTransaction(ctx.txParams);
    console.log(`  ORC.setReserve TX: ${orcTx.transactionId}`);
}

/**
 * Step 1: Seed the reserve by depositing WBTC and receiving ORC.
 *
 * The deployer/investor calls:
 *   1. WBTC.increaseAllowance(reserve, amount)  -- allow reserve to pull WBTC
 *   2. ODReserve.mintORC(wbtcAmount)             -- deposit WBTC, receive ORC
 */
async function step1_seedReserve(ctx: BootstrapContext): Promise<void> {
    console.log('\n=== Step 1: Seed Reserve (mintORC) ===');
    console.log(`  Depositing ${ctx.seedWbtcAmount} WBTC sats into the reserve`);

    // 1. Approve WBTC spending by the reserve
    console.log('  Approving WBTC...');
    const approveResult = await ctx.wbtc.increaseAllowance(ctx.reserveAddr, ctx.seedWbtcAmount);
    if (approveResult.revert) {
        throw new Error(`WBTC approve reverted: ${approveResult.revert}`);
    }
    const approveTx = await approveResult.sendTransaction(ctx.txParams);
    console.log(`  Approve TX: ${approveTx.transactionId}`);

    // 2. Call mintORC on the reserve
    console.log('  Calling mintORC...');
    const mintResult = await ctx.reserve.mintORC(ctx.seedWbtcAmount);
    if (mintResult.revert) {
        throw new Error(`mintORC reverted: ${mintResult.revert}`);
    }
    const mintTx = await mintResult.sendTransaction(ctx.txParams);
    console.log(`  mintORC TX: ${mintTx.transactionId}`);
    console.log(`  ORC minted: ${mintResult.properties['orcMinted']}`);
}

/**
 * Step 2: Advance from SEEDING to PREMINT phase.
 *
 * Owner calls ODReserve.advancePhase(seedPrice).
 */
async function step2_advancePhase(ctx: BootstrapContext): Promise<void> {
    console.log('\n=== Step 2: Advance Phase (SEEDING -> PREMINT) ===');
    console.log(`  Seed price: ${ctx.seedPrice} (WBTC/USD in 1e8 scale)`);

    console.log('  Calling advancePhase...');
    const result = await ctx.reserve.advancePhase(ctx.seedPrice);
    if (result.revert) {
        throw new Error(`advancePhase reverted: ${result.revert}`);
    }
    const tx = await result.sendTransaction(ctx.txParams);
    console.log(`  advancePhase TX: ${tx.transactionId}`);
}

/**
 * Step 3: Premint OD tokens for initial liquidity.
 *
 * Owner calls ODReserve.premintOD(odAmount).
 */
async function step3_premintOD(ctx: BootstrapContext): Promise<void> {
    console.log('\n=== Step 3: Premint OD ===');
    console.log(`  Preminting ${ctx.premintOdAmount} OD sats`);

    console.log('  Calling premintOD...');
    const result = await ctx.reserve.premintOD(ctx.premintOdAmount);
    if (result.revert) {
        throw new Error(`premintOD reverted: ${result.revert}`);
    }
    const tx = await result.sendTransaction(ctx.txParams);
    console.log(`  premintOD TX: ${tx.transactionId}`);
}

/**
 * Step 4: Approve MotoSwap Router to spend WBTC and OD.
 *
 * Required before addLiquidity:
 *   - WBTC.increaseAllowance(router, liquidityWbtc)
 *   - OD.increaseAllowance(router, liquidityOd)
 */
async function step4_approveRouter(ctx: BootstrapContext): Promise<void> {
    console.log('\n=== Step 4: Approve Router ===');

    // Approve WBTC
    console.log(`  Approving ${ctx.liquidityWbtc} WBTC sats for router...`);
    const wbtcApprove = await ctx.wbtc.increaseAllowance(ctx.routerAddr, ctx.liquidityWbtc);
    if (wbtcApprove.revert) {
        throw new Error(`WBTC approve for router reverted: ${wbtcApprove.revert}`);
    }
    const wbtcTx = await wbtcApprove.sendTransaction(ctx.txParams);
    console.log(`  WBTC approve TX: ${wbtcTx.transactionId}`);

    // Approve OD
    console.log(`  Approving ${ctx.liquidityOd} OD sats for router...`);
    const odApprove = await ctx.od.increaseAllowance(ctx.routerAddr, ctx.liquidityOd);
    if (odApprove.revert) {
        throw new Error(`OD approve for router reverted: ${odApprove.revert}`);
    }
    const odTx = await odApprove.sendTransaction(ctx.txParams);
    console.log(`  OD approve TX: ${odTx.transactionId}`);
}

/**
 * Step 5: Create the WBTC/OD pool on MotoSwap.
 *
 * Owner calls factory.createPool(wbtcAddr, odAddr).
 * Returns the pool address.
 */
async function step5_createPool(ctx: BootstrapContext): Promise<Address> {
    console.log('\n=== Step 5: Create MotoSwap WBTC/OD Pool ===');

    const createResult = await ctx.factory.createPool(ctx.wbtcAddr, ctx.odAddr);
    if (createResult.revert) {
        throw new Error(`createPool reverted: ${createResult.revert}`);
    }

    const poolAddress = createResult.properties.address;
    console.log(`  Pool address: ${poolAddress.toHex()}`);

    const tx = await createResult.sendTransaction(ctx.txParams);
    console.log(`  Create pool TX: ${tx.transactionId}`);

    return poolAddress;
}

/**
 * Step 6: Add initial WBTC/OD liquidity to the pool.
 *
 * Owner calls router.addLiquidity(wbtc, od, amounts...).
 */
async function step6_addLiquidity(ctx: BootstrapContext): Promise<void> {
    console.log('\n=== Step 6: Add Initial Liquidity ===');
    console.log(`  WBTC: ${ctx.liquidityWbtc} sats`);
    console.log(`  OD:   ${ctx.liquidityOd} sats`);

    // Deadline: far in the future (milliseconds since epoch as bigint)
    const deadline = BigInt(Date.now()) + BigInt(3600) * BigInt(1000);

    const addLiqResult = await ctx.router.addLiquidity(
        ctx.wbtcAddr,
        ctx.odAddr,
        ctx.liquidityWbtc,
        ctx.liquidityOd,
        BigInt(1),             // amountAMin: accept any slippage
        BigInt(1),             // amountBMin: accept any slippage
        ctx.wallet.address,    // LP tokens to deployer
        deadline,
    );

    if (addLiqResult.revert) {
        throw new Error(`addLiquidity reverted: ${addLiqResult.revert}`);
    }

    const tx = await addLiqResult.sendTransaction(ctx.txParams);
    console.log(`  Add liquidity TX: ${tx.transactionId}`);
    console.log(`  Liquidity added: WBTC=${addLiqResult.properties.amountA}, OD=${addLiqResult.properties.amountB}`);
    console.log(`  LP tokens: ${addLiqResult.properties.liquidity}`);
}

/**
 * Step 7: Register the pool with ODReserve.
 *
 * Owner calls ODReserve.initPool(poolAddress).
 * This records the pool address, determines token ordering, and takes the
 * initial TWAP snapshot.
 */
async function step7_initPool(ctx: BootstrapContext, poolAddress: Address): Promise<void> {
    console.log('\n=== Step 7: Register Pool with ODReserve ===');
    console.log(`  Pool address: ${poolAddress.toHex()}`);

    console.log('  Calling initPool...');
    const result = await ctx.reserve.initPool(poolAddress);
    if (result.revert) {
        throw new Error(`initPool reverted: ${result.revert}`);
    }
    const tx = await result.sendTransaction(ctx.txParams);
    console.log(`  initPool TX: ${tx.transactionId}`);
}

/**
 * Step 8: Wait for TWAP window and trigger LIVE transition.
 *
 * After initPool, the TWAP snapshot is taken. We need to wait for at least
 * 6 blocks (the TWAP window) before the system can transition to LIVE.
 *
 * On regtest, blocks can be mined manually. On testnet/mainnet, this is ~1 hour.
 *
 * Any call that invokes _computeTwap() after the window has elapsed will
 * automatically trigger the PREMINT -> LIVE transition.
 */
async function step8_waitForTwap(_ctx: BootstrapContext): Promise<void> {
    console.log('\n=== Step 8: Wait for TWAP Window ===');
    console.log('  The TWAP window is 6 blocks (~1 hour on mainnet).');
    console.log('  On regtest, mine 6 blocks: bitcoin-cli generatetoaddress 6 <address>');
    console.log('');
    console.log('  After the window fills, any user interaction (mintOD, burnOD,');
    console.log('  mintORC, burnORC) will automatically trigger the PREMINT -> LIVE');
    console.log('  transition via _computeTwap().');
    console.log('');
    console.log('  You can also manually trigger a TWAP update by calling:');
    console.log('  ODReserve.updateTwapSnapshot()');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // Parse optional step argument
    const stepArg = process.argv[2];
    const singleStep = stepArg ? parseInt(stepArg, 10) : null;
    if (singleStep !== null && (isNaN(singleStep) || singleStep < 0 || singleStep > 8)) {
        console.error('Usage: npx tsx scripts/bootstrap.ts [step]');
        console.error('  step: 0-8 (optional, runs all if omitted)');
        process.exit(1);
    }

    // Read configuration
    const mnemonicPhrase = requiredEnv('OPNET_DEPLOYER_MNEMONIC');
    const nodeUrl = optionalEnv('OPNET_NODE_URL', 'https://testnet.opnet.org');
    const networkName = optionalEnv('OPNET_NETWORK', 'testnet');

    const odAddressHex = requiredEnv('OD_ADDRESS');
    const orcAddressHex = requiredEnv('ORC_ADDRESS');
    const reserveAddressHex = requiredEnv('ODRESERVE_ADDRESS');
    const wbtcAddressHex = requiredEnv('OPNET_WBTC_ADDRESS');
    const factoryAddressHex = requiredEnv('OPNET_MOTOSWAP_FACTORY');
    const routerAddressHex = requiredEnv('OPNET_MOTOSWAP_ROUTER');

    const network = resolveNetwork(networkName);

    // Bootstrap parameters
    // seedWbtcAmount: 1 WBTC (100,000,000 sats) for initial reserve seeding
    const seedWbtcAmount = BigInt(optionalEnv('SEED_WBTC_AMOUNT', '100000000'));
    // seedPrice: BTC/USD price in 1e8 scale. $100,000 = 100_000 * 1e8 = 10_000_000_000_000
    const seedPrice = BigInt(optionalEnv('SEED_PRICE', '10000000000000'));
    // premintOdAmount: amount of OD to premint (should keep ratio > 400%)
    // Default: seedWbtcAmount * seedPrice / RATIO_SCALE / 5 (for ~500% reserve ratio)
    const defaultPremintOd = (seedWbtcAmount * seedPrice / BigInt(100_000_000)) / BigInt(5);
    const premintOdAmount = BigInt(optionalEnv('PREMINT_OD_AMOUNT', defaultPremintOd.toString()));
    // Liquidity amounts
    const liquidityWbtc = BigInt(optionalEnv('LIQUIDITY_WBTC', '10000000')); // 0.1 WBTC
    const defaultLiquidityOd = liquidityWbtc * seedPrice / BigInt(100_000_000);
    const liquidityOd = BigInt(optionalEnv('LIQUIDITY_OD', defaultLiquidityOd.toString()));

    console.log('=== OD System Bootstrap ===');
    console.log(`Network:          ${networkName}`);
    console.log(`Node:             ${nodeUrl}`);
    console.log(`OD address:       ${odAddressHex}`);
    console.log(`ORC address:      ${orcAddressHex}`);
    console.log(`ODReserve:        ${reserveAddressHex}`);
    console.log(`WBTC:             ${wbtcAddressHex}`);
    console.log(`Factory:          ${factoryAddressHex}`);
    console.log(`Router:           ${routerAddressHex}`);
    console.log(`Seed WBTC:        ${seedWbtcAmount} sats`);
    console.log(`Seed price:       ${seedPrice} (1e8 scale)`);
    console.log(`Premint OD:       ${premintOdAmount} sats`);
    console.log(`Liquidity WBTC:   ${liquidityWbtc} sats`);
    console.log(`Liquidity OD:     ${liquidityOd} sats`);

    // Initialise wallet (BIP86 path matching OPWallet)
    const mnemonic = new Mnemonic(mnemonicPhrase, '', network, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(undefined, 0, 0, false);
    console.log(`\nDeployer:         ${wallet.p2tr}`);
    console.log(`OPNet ID:         ${wallet.address.toHex()}`);

    // Initialise provider
    const provider = new JSONRpcProvider({ url: nodeUrl, network });

    // Resolve all contract addresses to Address objects (async RPC calls)
    console.log('\nResolving contract addresses...');
    const [odAddr, orcAddr, reserveAddr, wbtcAddr, factoryAddr, routerAddr] =
        await Promise.all([
            provider.getPublicKeyInfo(odAddressHex, true),
            provider.getPublicKeyInfo(orcAddressHex, true),
            provider.getPublicKeyInfo(reserveAddressHex, true),
            provider.getPublicKeyInfo(wbtcAddressHex, true),
            provider.getPublicKeyInfo(factoryAddressHex, true),
            provider.getPublicKeyInfo(routerAddressHex, true),
        ]);
    console.log('  All addresses resolved.');

    // Create contract instances using opnet's getContract
    // Note: getContract first arg accepts string | Address — pass strings directly
    const od = getContract<IODORCContract & IOP20Contract>(
        odAddressHex, OD_ORC_ABI, provider, network, wallet.address,
    );
    const orc = getContract<IODORCContract & IOP20Contract>(
        orcAddressHex, OD_ORC_ABI, provider, network, wallet.address,
    );
    const wbtc = getContract<IOP20Contract>(
        wbtcAddressHex, OP_20_ABI, provider, network, wallet.address,
    );
    const reserve = getContract<IODReserveContract>(
        reserveAddressHex, OD_RESERVE_ABI, provider, network, wallet.address,
    );
    const factoryContract = getContract<IMotoswapFactoryContract>(
        factoryAddressHex, MotoSwapFactoryAbi, provider, network, wallet.address,
    );
    const routerContract = getContract<IMotoswapRouterContract>(
        routerAddressHex, MOTOSWAP_ROUTER_ABI, provider, network, wallet.address,
    );

    // Transaction parameters for sending transactions via opnet
    const txParams: TransactionParameters = {
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        refundTo: wallet.p2tr,
        maximumAllowedSatToSpend: BigInt(100_000),
        feeRate: 100,
        network,
    };

    // Build context
    const ctx: BootstrapContext = {
        provider,
        wallet,
        network,
        txParams,
        od: od as unknown as IODORCContract & IOP20Contract,
        orc: orc as unknown as IODORCContract & IOP20Contract,
        wbtc: wbtc as unknown as IOP20Contract,
        reserve: reserve as unknown as IODReserveContract,
        factory: factoryContract as unknown as IMotoswapFactoryContract,
        router: routerContract as unknown as IMotoswapRouterContract,
        odAddr,
        orcAddr,
        reserveAddr,
        wbtcAddr,
        factoryAddr,
        routerAddr,
        seedWbtcAmount,
        seedPrice,
        premintOdAmount,
        liquidityWbtc,
        liquidityOd,
    };

    // ── Run steps ───────────────────────────────────────────────────────

    // Track pool address across steps
    let poolAddress: Address | null = null;

    const steps: Array<{ num: number; name: string; fn: () => Promise<void> }> = [
        {
            num: 0,
            name: 'Set Reserve on OD & ORC',
            fn: () => step0_setReserve(ctx),
        },
        {
            num: 1,
            name: 'Seed Reserve (mintORC)',
            fn: () => step1_seedReserve(ctx),
        },
        {
            num: 2,
            name: 'Advance Phase (SEEDING -> PREMINT)',
            fn: () => step2_advancePhase(ctx),
        },
        {
            num: 3,
            name: 'Premint OD',
            fn: () => step3_premintOD(ctx),
        },
        {
            num: 4,
            name: 'Approve Router',
            fn: () => step4_approveRouter(ctx),
        },
        {
            num: 5,
            name: 'Create MotoSwap Pool',
            fn: async () => {
                poolAddress = await step5_createPool(ctx);
            },
        },
        {
            num: 6,
            name: 'Add Initial Liquidity',
            fn: () => step6_addLiquidity(ctx),
        },
        {
            num: 7,
            name: 'Register Pool with ODReserve',
            fn: async () => {
                if (!poolAddress) {
                    // Try to look up the pool from the factory
                    console.log('  Looking up pool address from factory...');
                    const poolResult = await ctx.factory.getPool(ctx.wbtcAddr, ctx.odAddr);
                    if (poolResult.revert) {
                        throw new Error('Pool not found. Run step 5 first.');
                    }
                    poolAddress = poolResult.properties.pool;
                    console.log(`  Found pool: ${poolAddress.toHex()}`);
                }
                await step7_initPool(ctx, poolAddress);
            },
        },
        {
            num: 8,
            name: 'Wait for TWAP Window',
            fn: () => step8_waitForTwap(ctx),
        },
    ];

    if (singleStep !== null) {
        const step = steps.find((s) => s.num === singleStep);
        if (!step) {
            console.error(`Step ${singleStep} not found.`);
            process.exit(1);
        }
        console.log(`\nRunning step ${step.num}: ${step.name}`);
        await step.fn();
    } else {
        console.log('\nRunning all bootstrap steps...');
        for (const step of steps) {
            try {
                await step.fn();
            } catch (err) {
                console.error(`\nStep ${step.num} (${step.name}) failed:`, err);
                console.error(`\nRe-run with: npx tsx scripts/bootstrap.ts ${step.num}`);
                process.exit(1);
            }
        }
    }

    console.log('\n=== Bootstrap Complete ===');
    console.log('Steps 0-7 set up the contracts and pool.');
    console.log('Step 8 requires waiting for 6 blocks.');
    console.log('After 6 blocks, any user interaction triggers LIVE mode.');

    // Cleanup
    mnemonic.zeroize();
    wallet.zeroize();
}

main().catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
});
