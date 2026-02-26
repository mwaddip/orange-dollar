import { opnet, OPNetUnit, Assert, Blockchain, ContractRuntime, OP20 } from '@btc-vision/unit-test-framework';
import { BinaryWriter, BinaryReader } from '@btc-vision/transaction';
import { BytecodeManager } from '@btc-vision/unit-test-framework';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Compiled WASM paths ────────────────────────────────────────────────────────
const RESERVE_WASM_PATH   = path.resolve(__dirname, '../build/ODReserve.wasm');
const POOL_WASM_PATH      = path.resolve(__dirname, '../build/MockMotoSwapPool.wasm');
const OD_WASM_PATH        = path.resolve(__dirname, '../build/OD.wasm');
const ORC_WASM_PATH       = path.resolve(__dirname, '../build/ORC.wasm');
const MOCK_WBTC_WASM_PATH = path.resolve(__dirname, '../build/MockWBTC.wasm');

// ─── ODReserve selectors ────────────────────────────────────────────────────────
const GET_PHASE_SELECTOR       = 0x8605fcee;
const ADVANCE_PHASE_SELECTOR   = 0xd1ee3cb1;
const INIT_POOL_SELECTOR       = 0xbc5abaf5;
const GET_TWAP_SELECTOR        = 0xfa12b920;
const UPDATE_TWAP_SNAPSHOT_SEL = 0x60d1eba2;
const MINT_ORC_SELECTOR        = 0xcb8d2560;
const MINT_OD_SELECTOR         = 0x77e95295;
const BURN_OD_SELECTOR         = 0x9e53ed6b;

// ─── MockMotoSwapPool selectors ─────────────────────────────────────────────────
const SET_PRICE0_SELECTOR = 0x05a98b81;
const SET_TOKEN0_SELECTOR = 0x962bebd4;

// ─── Phase constants ────────────────────────────────────────────────────────────
const PHASE_SEEDING = 0;
const PHASE_PREMINT = 1;
const PHASE_LIVE    = 2;

// ─── MockMotoSwapPool wrapper ───────────────────────────────────────────────────

class MockPoolContract extends ContractRuntime {
    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
    ) {
        super({ address, deployer });
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode(POOL_WASM_PATH, this.address);
    }

    async setPrice0Cumulative(
        caller: import('@btc-vision/transaction').Address,
        price: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(SET_PRICE0_SELECTOR);
        calldata.writeU256(price);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async setToken0(
        caller: import('@btc-vision/transaction').Address,
        token: import('@btc-vision/transaction').Address,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(SET_TOKEN0_SELECTOR);
        calldata.writeAddress(token);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }
}

// ─── MockWBTC wrapper (OP20 with unrestricted mint) ─────────────────────────────

class MockWBTCContract extends OP20 {
    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
    ) {
        super({
            file: MOCK_WBTC_WASM_PATH,
            address,
            deployer,
            decimals: 8,
        });
    }
}

// ─── OD token wrapper ───────────────────────────────────────────────────────────

class ODTokenContract extends OP20 {
    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
        reserveAddress: import('@btc-vision/transaction').Address,
    ) {
        const deploymentCalldata = new BinaryWriter();
        deploymentCalldata.writeAddress(reserveAddress);

        super({
            file: OD_WASM_PATH,
            address,
            deployer,
            decimals: 8,
            deploymentCalldata: deploymentCalldata.getBuffer(),
        });
    }
}

// ─── ORC token wrapper ──────────────────────────────────────────────────────────

class ORCTokenContract extends OP20 {
    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
        reserveAddress: import('@btc-vision/transaction').Address,
    ) {
        const deploymentCalldata = new BinaryWriter();
        deploymentCalldata.writeAddress(reserveAddress);

        super({
            file: ORC_WASM_PATH,
            address,
            deployer,
            decimals: 8,
            deploymentCalldata: deploymentCalldata.getBuffer(),
        });
    }
}

// ─── ODReserve wrapper ──────────────────────────────────────────────────────────

class ODReserveContract extends ContractRuntime {
    public readonly odAddr: import('@btc-vision/transaction').Address;
    public readonly orcAddr: import('@btc-vision/transaction').Address;
    public readonly wbtcAddr: import('@btc-vision/transaction').Address;
    public readonly factoryAddr: import('@btc-vision/transaction').Address;

    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
        odAddr: import('@btc-vision/transaction').Address,
        orcAddr: import('@btc-vision/transaction').Address,
        wbtcAddr: import('@btc-vision/transaction').Address,
        factoryAddr: import('@btc-vision/transaction').Address,
    ) {
        const deploymentCalldata = new BinaryWriter();
        deploymentCalldata.writeAddress(odAddr);
        deploymentCalldata.writeAddress(orcAddr);
        deploymentCalldata.writeAddress(wbtcAddr);
        deploymentCalldata.writeAddress(factoryAddr);

        super({
            address,
            deployer,
            deploymentCalldata: deploymentCalldata.getBuffer(),
        });

        this.odAddr = odAddr;
        this.orcAddr = orcAddr;
        this.wbtcAddr = wbtcAddr;
        this.factoryAddr = factoryAddr;
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode(RESERVE_WASM_PATH, this.address);
    }

    async getPhase(): Promise<number> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(GET_PHASE_SELECTOR);
        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });
        if (result.error) {
            throw new Error(`getPhase reverted: ${result.error.message}`);
        }
        return new BinaryReader(result.response).readU8();
    }

    async advancePhase(
        caller: import('@btc-vision/transaction').Address,
        seedPrice: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(ADVANCE_PHASE_SELECTOR);
        calldata.writeU256(seedPrice);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async initPool(
        caller: import('@btc-vision/transaction').Address,
        poolAddress: import('@btc-vision/transaction').Address,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(INIT_POOL_SELECTOR);
        calldata.writeAddress(poolAddress);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async getTwap(caller?: import('@btc-vision/transaction').Address): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(GET_TWAP_SELECTOR);
        const result = await this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
        if (result.error) {
            throw new Error(`getTwap reverted: ${result.error.message}`);
        }
        return new BinaryReader(result.response).readU256();
    }

    async updateTwapSnapshot(caller?: import('@btc-vision/transaction').Address) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(UPDATE_TWAP_SNAPSHOT_SEL);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async mintORC(
        caller: import('@btc-vision/transaction').Address,
        wbtcAmount: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(MINT_ORC_SELECTOR);
        calldata.writeU256(wbtcAmount);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async mintOD(
        caller: import('@btc-vision/transaction').Address,
        wbtcAmount: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(MINT_OD_SELECTOR);
        calldata.writeU256(wbtcAmount);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async burnOD(
        caller: import('@btc-vision/transaction').Address,
        odAmount: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(BURN_OD_SELECTOR);
        calldata.writeU256(odAmount);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }
}

// ─── Test helpers ───────────────────────────────────────────────────────────────

interface TestFixtures {
    reserve: ODReserveContract;
    pool: MockPoolContract;
    wbtc: MockWBTCContract;
    od: ODTokenContract;
    orc: ORCTokenContract;
}

function createFixtures(deployer: import('@btc-vision/transaction').Address): TestFixtures {
    const reserveAddress = Blockchain.generateRandomAddress();
    const poolAddress    = Blockchain.generateRandomAddress();
    const odAddress      = Blockchain.generateRandomAddress();
    const orcAddress     = Blockchain.generateRandomAddress();
    const wbtcAddress    = Blockchain.generateRandomAddress();
    const factoryAddr    = Blockchain.generateRandomAddress();

    // OD and ORC are deployed with the reserve address as the authorized minter
    const od = new ODTokenContract(odAddress, deployer, reserveAddress);
    const orc = new ORCTokenContract(orcAddress, deployer, reserveAddress);
    const wbtc = new MockWBTCContract(wbtcAddress, deployer);
    const pool = new MockPoolContract(poolAddress, deployer);

    const reserve = new ODReserveContract(
        reserveAddress,
        deployer,
        odAddress,
        orcAddress,
        wbtcAddress,
        factoryAddr,
    );

    // Register all contracts with the blockchain
    Blockchain.register(reserve);
    Blockchain.register(pool);
    Blockchain.register(od);
    Blockchain.register(orc);
    Blockchain.register(wbtc);

    return { reserve, pool, wbtc, od, orc };
}

/**
 * Helper: bootstrap the system to LIVE phase.
 *
 * 1. Seed the reserve with WBTC via mintORC in SEEDING phase
 * 2. Advance to PREMINT with seedPrice
 * 3. Configure pool and TWAP
 * 4. Advance blocks to fill TWAP window, triggering PREMINT -> LIVE
 *
 * Returns the TWAP value.
 */
async function bootstrapToLive(
    fixtures: TestFixtures,
    deployer: import('@btc-vision/transaction').Address,
    user: import('@btc-vision/transaction').Address,
    seedWbtc: bigint,
): Promise<bigint> {
    const { reserve, pool, wbtc } = fixtures;

    // 1. Seed the reserve with WBTC via mintORC in SEEDING
    await wbtc.mintRaw(user, seedWbtc);
    await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
    const seedRes = await reserve.mintORC(user, seedWbtc);
    Assert.equal(seedRes.error, undefined, `Seed mintORC failed: ${seedRes.error?.message}`);

    // 2. Advance to PREMINT
    const seedPrice = 10_000_000_000_000n; // $100K in 1e8 scale
    const advRes = await reserve.advancePhase(deployer, seedPrice);
    Assert.equal(advRes.error, undefined, `advancePhase failed: ${advRes.error?.message}`);

    // 3. Set up pool: WBTC is token0
    await pool.setToken0(deployer, reserve.wbtcAddr);
    await pool.setPrice0Cumulative(deployer, 0n);
    const initRes = await reserve.initPool(deployer, pool.address);
    Assert.equal(initRes.error, undefined, `initPool failed: ${initRes.error?.message}`);
    await reserve.updateTwapSnapshot(deployer);

    // 4. Advance 6 blocks and set cumulative for TWAP = $100K
    Blockchain.blockNumber = 106n;
    const deltaPerBlock = 10_000_000_000_000n; // 100K * 1e8 OD per WBTC
    await pool.setPrice0Cumulative(deployer, deltaPerBlock * 6n);

    // 5. Read TWAP to trigger PREMINT -> LIVE
    const twap = await reserve.getTwap(deployer);
    Assert.notEqual(twap, 0n, 'TWAP should be non-zero after bootstrap');

    const phase = await reserve.getPhase();
    Assert.equal(phase, PHASE_LIVE, 'Expected LIVE phase after bootstrap');

    return twap;
}

// ─── Test suite ─────────────────────────────────────────────────────────────────

await opnet('ODReserve mintOD / burnOD', async (vm: OPNetUnit) => {
    let reserve: ODReserveContract;
    let pool: MockPoolContract;
    let wbtc: MockWBTCContract;
    let od: ODTokenContract;
    let orc: ORCTokenContract;
    let deployer: import('@btc-vision/transaction').Address;
    let user: import('@btc-vision/transaction').Address;

    vm.beforeEach(async () => {
        Blockchain.clearContracts();
        await Blockchain.init();

        deployer = Blockchain.generateRandomAddress();
        user = Blockchain.generateRandomAddress();

        const fixtures = createFixtures(deployer);
        reserve = fixtures.reserve;
        pool    = fixtures.pool;
        wbtc    = fixtures.wbtc;
        od      = fixtures.od;
        orc     = fixtures.orc;

        await reserve.init();
        await pool.init();
        await wbtc.init();
        await od.init();
        await orc.init();

        // Force deployment of OP-20 contracts by calling a state-changing method.
        const dummyAddr = Blockchain.generateRandomAddress();
        await wbtc.mintRaw(dummyAddr, 0n);
        await od.increaseAllowance(deployer, dummyAddr, 0n);
        await orc.increaseAllowance(deployer, dummyAddr, 0n);

        // Reset block number for reproducible tests
        Blockchain.blockNumber = 100n;
    });

    vm.afterEach(() => {
        reserve.dispose();
        pool.dispose();
        wbtc.dispose();
        od.dispose();
        orc.dispose();
        Blockchain.clearContracts();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // mintOD tests
    // ═══════════════════════════════════════════════════════════════════════

    // ── Test 1: mintOD reverts with zero amount ─────────────────────────

    await vm.it('mintOD reverts with zero wbtcAmount', async () => {
        const res = await reserve.mintOD(user, 0n);
        Assert.notEqual(res.status, 0, 'Expected mintOD to revert with zero amount');
    });

    // ── Test 2: mintOD reverts in SEEDING phase ─────────────────────────

    await vm.it('mintOD reverts in SEEDING phase', async () => {
        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_SEEDING, 'Expected SEEDING phase');

        const res = await reserve.mintOD(user, 100_000_000n);
        Assert.notEqual(res.status, 0, 'Expected mintOD to revert in SEEDING phase');
    });

    // ── Test 3: mintOD reverts in PREMINT phase ─────────────────────────

    await vm.it('mintOD reverts in PREMINT phase', async () => {
        // Advance to PREMINT
        const seedPrice = 10_000_000_000_000n;
        await reserve.advancePhase(deployer, seedPrice);

        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_PREMINT, 'Expected PREMINT phase');

        const res = await reserve.mintOD(user, 100_000_000n);
        Assert.notEqual(res.status, 0, 'Expected mintOD to revert in PREMINT phase');
    });

    // ── Test 4: mintOD succeeds in LIVE phase ───────────────────────────

    await vm.it('mintOD succeeds in LIVE phase: 1 WBTC at $100K TWAP yields ~98,500 OD', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n; // 10 WBTC
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        // Mint 1 WBTC worth of OD
        const wbtcAmount = 1_00000000n; // 1 WBTC
        await wbtc.mintRaw(user, wbtcAmount);
        await wbtc.increaseAllowance(user, reserve.address, wbtcAmount);

        const res = await reserve.mintOD(user, wbtcAmount);
        Assert.equal(res.error, undefined, `mintOD reverted: ${res.error?.message}`);

        // Read OD minted from response
        const reader = new BinaryReader(res.response);
        const odOut = reader.readU256();

        // Math:
        //   TWAP = 10_000_000_000_000 (100K * 1e8)
        //   od_gross = 100_000_000 * 10_000_000_000_000 / 100_000_000 = 10_000_000_000_000
        //   fee = 10_000_000_000_000 * 1_500_000 / 100_000_000 = 150_000_000_000
        //   od_out = 10_000_000_000_000 - 150_000_000_000 = 9_850_000_000_000
        Assert.equal(odOut, 9_850_000_000_000n, `Expected 9_850_000_000_000 OD, got ${odOut}`);

        // Verify OD balance
        const userOdBalance = await od.balanceOf(user);
        Assert.equal(userOdBalance, 9_850_000_000_000n, 'User OD balance mismatch');

        // Verify WBTC was transferred to reserve
        const userWbtcAfter = await wbtc.balanceOf(user);
        Assert.equal(userWbtcAfter, 0n, 'User should have 0 WBTC after mintOD');

        // Reserve should have original 10 WBTC + 1 WBTC = 11 WBTC
        const reserveWbtc = await wbtc.balanceOf(reserve.address);
        Assert.equal(reserveWbtc, 11_00000000n, 'Reserve should hold 11 WBTC');
    });

    // ── Test 5: mintOD blocked if ratio would drop below 400% ───────────

    await vm.it('mintOD blocked if ratio would drop below 400%', async () => {
        // Seed with minimal WBTC to make ratio tight
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 1_00000000n; // 1 WBTC
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        // Now try to mint a huge amount of OD that would breach ratio.
        // Reserve has 1 WBTC. At TWAP $100K, with 1 WBTC:
        //   If we try to mint 0.25 WBTC worth of OD:
        //   od_gross = 25_000_000 * 10_000_000_000_000 / 100_000_000 = 2_500_000_000_000
        //   fee = 2_500_000_000_000 * 1_500_000 / 100_000_000 = 37_500_000_000
        //   od_out = 2_462_500_000_000
        //   new_reserve = 1_00000000 + 25_000_000 = 125_000_000
        //   new_od_supply = 2_462_500_000_000
        //   ratio = 125_000_000 * 10_000_000_000_000 * 100_000_000 / 2_462_500_000_000
        //         = 125 * 10^6 * 10^13 * 10^8 / (2.4625 * 10^12)
        //         = 125 * 10^27 / (2.4625 * 10^12) = 5.076... * 10^16
        //         ~= 507,614,213 which is > 400,000,000 (passes)
        //
        // We need to push the ratio below 400%. With 1 WBTC reserve at $100K:
        // max_od before 400% breach: ratio = reserve * twap * RATIO_SCALE / od_supply = 400_000_000
        // od_supply = reserve * twap * RATIO_SCALE / 400_000_000
        //           = 1_00000000 * 10_000_000_000_000 * 100_000_000 / 400_000_000
        //           = 10^8 * 10^13 * 10^8 / (4 * 10^8) = 10^29 / (4 * 10^8) = 2.5 * 10^20
        // But we also add WBTC to reserve, so need to account for that.
        //
        // Let's try depositing 0.24 WBTC:
        //   od_gross = 24_000_000 * 10_000_000_000_000 / 100_000_000 = 2_400_000_000_000
        //   fee = 2_400_000_000_000 * 1_500_000 / 100_000_000 = 36_000_000_000
        //   od_out = 2_364_000_000_000
        //   new_reserve = 1_24000000
        //   ratio = 124_000_000 * 10_000_000_000_000 * 100_000_000 / 2_364_000_000_000
        //         = 124 * 10^6 * 10^21 / (2.364 * 10^12) = 1.24 * 10^29 / 2.364 * 10^12
        //         = 5.245 * 10^16 = passes
        //
        // Actually for 1 WBTC at $100K, the ratio is extremely high since we start with 0 OD.
        // We need to first mint some OD to lower the ratio, then try minting more.
        //
        // Strategy: mint OD repeatedly until ratio is close to 400%, then try one more.
        // Or: use very small seed.
        //
        // Actually, with 1 WBTC reserve and TWAP=100K:
        //   If someone deposits X sats of WBTC:
        //   od_out ~= X * TWAP / RATIO_SCALE * 0.985
        //   new_reserve = 1e8 + X sats
        //   ratio = (1e8 + X) * TWAP * RATIO_SCALE / od_out
        //         = (1e8 + X) * TWAP * RATIO_SCALE / (X * TWAP / RATIO_SCALE * 0.985)
        //         = (1e8 + X) * RATIO_SCALE^2 / (X * 0.985)
        //         = (1e8 + X) * 1e16 / (0.985 * X)
        //
        // For ratio = 400% = 4e8:
        //   (1e8 + X) * 1e16 / (0.985 * X) = 4e8
        //   (1e8 + X) * 1e16 = 3.94e8 * X
        //   1e24 + X * 1e16 = 3.94e8 * X
        //   1e24 = X * (3.94e8 - 1e16)
        //   Since 3.94e8 << 1e16, this means X * 1e16 ≈ 1e24, X ≈ 1e8
        //   More precisely: 1e24 = X * (1e16 - 3.94e8) ≈ X * 1e16
        //   X ≈ 1e8 = 100_000_000 = 1 WBTC
        //
        // Hmm, depositing ~1 WBTC when reserve is 1 WBTC gives ~400% ratio.
        // Let's just try depositing a large amount to guarantee a breach.
        // With od_out approaching the full value, we need a lot of WBTC deposit.
        //
        // Simpler approach: mint most of OD first, then try another mint.
        // After first mint of 0.24 WBTC (ratio ~ 525%), then try 0.24 more.

        // First mint: bring ratio down
        const firstAmount = 24_000_000n; // 0.24 WBTC
        await wbtc.mintRaw(user, firstAmount);
        await wbtc.increaseAllowance(user, reserve.address, firstAmount);
        const first = await reserve.mintOD(user, firstAmount);
        Assert.equal(first.error, undefined, `First mintOD failed: ${first.error?.message}`);

        // Now try another large mint that would breach ratio.
        // After first mint:
        //   reserve = 1_24000000 sats
        //   od_supply = od from first mint
        // Let's try to mint another huge amount
        const hugeAmount = 50_000_000n; // 0.5 WBTC
        await wbtc.mintRaw(user, hugeAmount);
        await wbtc.increaseAllowance(user, reserve.address, hugeAmount);
        const second = await reserve.mintOD(user, hugeAmount);

        // Calculate if this should pass or fail:
        // od from first mint:
        //   od_gross = 24_000_000 * 10_000_000_000_000 / 100_000_000 = 2_400_000_000_000
        //   fee = 2_400_000_000_000 * 1_500_000 / 100_000_000 = 36_000_000_000
        //   od_out_1 = 2_364_000_000_000
        //
        // Second mint attempt (0.5 WBTC):
        //   od_gross = 50_000_000 * 10_000_000_000_000 / 100_000_000 = 5_000_000_000_000
        //   fee = 5_000_000_000_000 * 1_500_000 / 100_000_000 = 75_000_000_000
        //   od_out_2 = 4_925_000_000_000
        //   new_reserve = 1_24000000 + 50_000_000 = 1_74000000
        //   new_od_supply = 2_364_000_000_000 + 4_925_000_000_000 = 7_289_000_000_000
        //   ratio = 174_000_000 * 10_000_000_000_000 * 100_000_000 / 7_289_000_000_000
        //         = 1.74e8 * 1e13 * 1e8 / 7.289e12
        //         = 1.74e29 / 7.289e12 = 2.387e16
        //         = ~238,700,000 which is below 400_000_000!
        // So this SHOULD fail!
        Assert.notEqual(second.status, 0, 'Expected mintOD to revert when ratio would breach 400%');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // burnOD tests
    // ═══════════════════════════════════════════════════════════════════════

    // ── Test 6: burnOD reverts with zero amount ─────────────────────────

    await vm.it('burnOD reverts with zero odAmount', async () => {
        const res = await reserve.burnOD(user, 0n);
        Assert.notEqual(res.status, 0, 'Expected burnOD to revert with zero amount');
    });

    // ── Test 7: burnOD reverts in SEEDING phase ─────────────────────────

    await vm.it('burnOD reverts in SEEDING phase', async () => {
        const res = await reserve.burnOD(user, 100_000_000n);
        Assert.notEqual(res.status, 0, 'Expected burnOD to revert in SEEDING phase');
    });

    // ── Test 8: burnOD reverts in PREMINT phase ─────────────────────────

    await vm.it('burnOD reverts in PREMINT phase', async () => {
        const seedPrice = 10_000_000_000_000n;
        await reserve.advancePhase(deployer, seedPrice);

        const res = await reserve.burnOD(user, 100_000_000n);
        Assert.notEqual(res.status, 0, 'Expected burnOD to revert in PREMINT phase');
    });

    // ── Test 9: burnOD succeeds in LIVE phase ───────────────────────────

    await vm.it('burnOD succeeds in LIVE phase: burns OD and receives WBTC', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n; // 10 WBTC
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        // First mint some OD so user has OD to burn
        const wbtcForMint = 1_00000000n; // 1 WBTC
        await wbtc.mintRaw(user, wbtcForMint);
        await wbtc.increaseAllowance(user, reserve.address, wbtcForMint);
        const mintRes = await reserve.mintOD(user, wbtcForMint);
        Assert.equal(mintRes.error, undefined, `mintOD failed: ${mintRes.error?.message}`);

        const mintReader = new BinaryReader(mintRes.response);
        const odMinted = mintReader.readU256();
        Assert.equal(odMinted, 9_850_000_000_000n, 'Expected 9_850_000_000_000 OD minted');

        // Verify user has OD
        const userOdBefore = await od.balanceOf(user);
        Assert.equal(userOdBefore, 9_850_000_000_000n, 'User should have OD from mint');

        // Now burn 1000 OD = 100_000_000_000 base units
        const odToBurn = 100_000_000_000n; // 1000 OD

        // User needs to approve the reserve to burn OD (OP20 burn requires from == caller or approval)
        // Actually, looking at OD.burn(), it calls _burn(from, amount) via cross-contract call
        // from ODReserve. The ODReserve is the tx.sender (for the OD contract), and it passes
        // user as `from`. The OD._burn should work because the reserve is the authorized caller.
        // But the OD contract checks _onlyReserve() which checks tx.sender == reserve.
        // Then it calls this._burn(from, amount) which is the OP20 internal _burn.
        // OP20._burn should burn from the `from` address directly.

        const burnRes = await reserve.burnOD(user, odToBurn);
        Assert.equal(burnRes.error, undefined, `burnOD reverted: ${burnRes.error?.message}`);

        const burnReader = new BinaryReader(burnRes.response);
        const wbtcOut = burnReader.readU256();

        // Math:
        //   wbtc_gross = 100_000_000_000 * 100_000_000 / 10_000_000_000_000 = 1_000_000
        //   fee = 1_000_000 * 1_500_000 / 100_000_000 = 15_000
        //   wbtc_out = 1_000_000 - 15_000 = 985_000
        Assert.equal(wbtcOut, 985_000n, `Expected 985_000 WBTC out, got ${wbtcOut}`);

        // Verify OD was burned
        const userOdAfter = await od.balanceOf(user);
        const expectedOdAfter = 9_850_000_000_000n - 100_000_000_000n;
        Assert.equal(userOdAfter, expectedOdAfter, 'User OD balance should be reduced');

        // Verify user received WBTC
        const userWbtcAfter = await wbtc.balanceOf(user);
        Assert.equal(userWbtcAfter, 985_000n, 'User should have received WBTC from burn');
    });

    // ── Test 10: burnOD is NEVER blocked by ratio (Djed invariant) ──────

    await vm.it('burnOD is never blocked by ratio (Djed invariant)', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n; // 10 WBTC
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        // Mint a large amount of OD to bring ratio close to minimum
        // We'll mint using most of the allowed range
        const wbtcForMint = 2_00000000n; // 2 WBTC
        await wbtc.mintRaw(user, wbtcForMint);
        await wbtc.increaseAllowance(user, reserve.address, wbtcForMint);
        const mintRes = await reserve.mintOD(user, wbtcForMint);
        Assert.equal(mintRes.error, undefined, `mintOD failed: ${mintRes.error?.message}`);

        const mintReader = new BinaryReader(mintRes.response);
        const odMinted = mintReader.readU256();

        // odMinted = 19_700_000_000_000 (2 WBTC * 100K * 0.985)
        // Reserve now has 12 WBTC, OD supply = 19_700_000_000_000
        // ratio = 12e8 * 1e13 * 1e8 / 19.7e12 = 1.2e29 / 1.97e13 = 6.09e15
        // = 609,137,055 ~= 609% which is above 400%

        // Now burn a large portion of OD. Even if this causes the ratio to
        // go way above 400%, burnOD should still succeed (it doesn't check ratio).
        // This confirms the Djed invariant.
        const burnAmount = odMinted; // burn ALL minted OD
        const burnRes = await reserve.burnOD(user, burnAmount);
        Assert.equal(burnRes.error, undefined, `burnOD should never be blocked by ratio: ${burnRes.error?.message}`);

        const burnReader = new BinaryReader(burnRes.response);
        const wbtcReturned = burnReader.readU256();
        Assert.notEqual(wbtcReturned, 0n, 'Should receive non-zero WBTC from burnOD');

        // Verify OD was fully burned
        const userOdAfter = await od.balanceOf(user);
        Assert.equal(userOdAfter, 0n, 'User should have 0 OD after burning all');
    });

    // ── Test 11: mintOD and burnOD round-trip ────────────────────────────

    await vm.it('mintOD then burnOD round-trip: user receives less WBTC due to fees', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n; // 10 WBTC
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        // Mint 1 WBTC -> OD
        const wbtcAmount = 1_00000000n;
        await wbtc.mintRaw(user, wbtcAmount);
        await wbtc.increaseAllowance(user, reserve.address, wbtcAmount);

        const mintRes = await reserve.mintOD(user, wbtcAmount);
        Assert.equal(mintRes.error, undefined, `mintOD failed: ${mintRes.error?.message}`);

        const odMinted = new BinaryReader(mintRes.response).readU256();

        // Now burn all OD back -> WBTC
        const burnRes = await reserve.burnOD(user, odMinted);
        Assert.equal(burnRes.error, undefined, `burnOD failed: ${burnRes.error?.message}`);

        const wbtcReturned = new BinaryReader(burnRes.response).readU256();

        // User should get back less than 1 WBTC due to two rounds of fees:
        // mintOD fee: 1.5% on OD output
        // burnOD fee: 1.5% on WBTC output
        //
        // Mint: od_out = 9_850_000_000_000
        // Burn: wbtc_gross = 9_850_000_000_000 * 100_000_000 / 10_000_000_000_000 = 98_500_000
        //   fee = 98_500_000 * 1_500_000 / 100_000_000 = 1_477_500
        //   wbtc_out = 98_500_000 - 1_477_500 = 97_022_500
        Assert.equal(wbtcReturned, 97_022_500n, `Expected 97_022_500 WBTC returned, got ${wbtcReturned}`);

        // User started with 1 WBTC (100_000_000 sats), ended with 97_022_500 sats
        // Total fee taken: 100_000_000 - 97_022_500 = 2_977_500 sats (~2.978%)
        Assert.equal(wbtcReturned < wbtcAmount, true, 'User should receive less WBTC than deposited');
    });

    // ── Test 12: any user can call mintOD (no owner restriction) ─────────

    await vm.it('any address can call mintOD (not restricted to owner)', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n;
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        const otherUser = Blockchain.generateRandomAddress();
        const wbtcAmount = 50_000_000n; // 0.5 WBTC

        await wbtc.mintRaw(otherUser, wbtcAmount);
        await wbtc.increaseAllowance(otherUser, reserve.address, wbtcAmount);

        const res = await reserve.mintOD(otherUser, wbtcAmount);
        Assert.equal(res.error, undefined, `mintOD by non-owner reverted: ${res.error?.message}`);

        const odBalance = await od.balanceOf(otherUser);
        Assert.notEqual(odBalance, 0n, 'Other user should have received OD');
    });
});
