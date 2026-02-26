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
const BURN_ORC_SELECTOR        = 0x2eed53fc;
const MINT_OD_SELECTOR         = 0x77e95295;
const BURN_OD_SELECTOR         = 0x9e53ed6b;
const PREMINT_OD_SELECTOR      = 0x941a791a;
const GET_RESERVE_RATIO_SEL    = 0x15663669;
const GET_EQUITY_SEL           = 0x39a98de3;

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

    async burnORC(
        caller: import('@btc-vision/transaction').Address,
        orcAmount: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(BURN_ORC_SELECTOR);
        calldata.writeU256(orcAmount);
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

    async premintOD(
        caller: import('@btc-vision/transaction').Address,
        odAmount: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(PREMINT_OD_SELECTOR);
        calldata.writeU256(odAmount);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async getReserveRatio(caller?: import('@btc-vision/transaction').Address): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(GET_RESERVE_RATIO_SEL);
        const result = await this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
        if (result.error) {
            throw new Error(`getReserveRatio reverted: ${result.error.message}`);
        }
        return new BinaryReader(result.response).readU256();
    }

    async getEquity(caller?: import('@btc-vision/transaction').Address): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(GET_EQUITY_SEL);
        const result = await this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
        if (result.error) {
            throw new Error(`getEquity reverted: ${result.error.message}`);
        }
        return new BinaryReader(result.response).readU256();
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
 * 4. Optionally premint OD
 * 5. Advance blocks to fill TWAP window, triggering PREMINT -> LIVE
 *
 * Returns the TWAP value.
 */
async function bootstrapToLive(
    fixtures: TestFixtures,
    deployer: import('@btc-vision/transaction').Address,
    user: import('@btc-vision/transaction').Address,
    seedWbtc: bigint,
    premintOdAmount?: bigint,
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

    // 3b. Optional premint of OD
    if (premintOdAmount !== undefined && premintOdAmount > 0n) {
        const pmRes = await reserve.premintOD(deployer, premintOdAmount);
        Assert.equal(pmRes.error, undefined, `premintOD failed: ${pmRes.error?.message}`);
    }

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

await opnet('ODReserve Integration: end-to-end', async (vm: OPNetUnit) => {
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
    // Scenario 1: Full Bootstrap SEEDING -> PREMINT -> LIVE
    // ═══════════════════════════════════════════════════════════════════════

    await vm.it('full bootstrap: SEEDING -> PREMINT -> LIVE with premintOD', async () => {
        // Step 1: Verify initial state is SEEDING
        const phase0 = await reserve.getPhase();
        Assert.equal(phase0, PHASE_SEEDING, 'Initial phase should be SEEDING');

        // Step 2: Investor seeds the reserve with 10 WBTC via mintORC
        const seedWbtc = 10_00000000n; // 10 WBTC
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        const seedRes = await reserve.mintORC(user, seedWbtc);
        Assert.equal(seedRes.error, undefined, `Seed mintORC failed: ${seedRes.error?.message}`);

        // Verify ORC was minted to the investor
        const userOrc = await orc.balanceOf(user);
        // First mint, 1:1 ratio, fee = 1.5%: 10_00000000 * 0.985 = 985_000_000
        Assert.equal(userOrc, 985_000_000n, `Expected 985_000_000 ORC, got ${userOrc}`);

        // Verify WBTC transferred to reserve
        const reserveWbtc = await wbtc.balanceOf(reserve.address);
        Assert.equal(reserveWbtc, seedWbtc, 'Reserve should hold 10 WBTC');

        // Step 3: Owner calls advancePhase with seedPrice -> PREMINT
        const seedPrice = 10_000_000_000_000n; // $100K in 1e8 scale
        const advRes = await reserve.advancePhase(deployer, seedPrice);
        Assert.equal(advRes.error, undefined, `advancePhase failed: ${advRes.error?.message}`);

        const phase1 = await reserve.getPhase();
        Assert.equal(phase1, PHASE_PREMINT, 'Phase should be PREMINT after advancePhase');

        // Step 4: Owner calls initPool to set MotoSwap pool
        await pool.setToken0(deployer, reserve.wbtcAddr);
        await pool.setPrice0Cumulative(deployer, 0n);
        const initPoolRes = await reserve.initPool(deployer, pool.address);
        Assert.equal(initPoolRes.error, undefined, `initPool failed: ${initPoolRes.error?.message}`);

        // Step 5: Owner calls premintOD to mint initial OD supply
        // With 10 WBTC and seedPrice = $100K, max OD for 400% ratio:
        //   odAmount <= 10_00000000 * 10_000_000_000_000 / 400_000_000 = 2_500_000_000_000_0
        // Let's premint 1_000_000_000_000 OD (10,000 OD) — well within limits.
        const premintAmount = 1_000_000_000_000n;
        const pmRes = await reserve.premintOD(deployer, premintAmount);
        Assert.equal(pmRes.error, undefined, `premintOD failed: ${pmRes.error?.message}`);

        // Verify OD was minted to the owner
        const ownerOd = await od.balanceOf(deployer);
        Assert.equal(ownerOd, premintAmount, `Owner should have ${premintAmount} OD`);

        // Step 6: Advance blocks so TWAP window fills
        await reserve.updateTwapSnapshot(deployer);
        Blockchain.blockNumber = 106n;
        const deltaPerBlock = 10_000_000_000_000n;
        await pool.setPrice0Cumulative(deployer, deltaPerBlock * 6n);

        // Step 7: Any operation triggers auto-transition to LIVE
        const twap = await reserve.getTwap(deployer);
        Assert.notEqual(twap, 0n, 'TWAP should be non-zero');

        // Step 8: Verify phase is LIVE
        const phase2 = await reserve.getPhase();
        Assert.equal(phase2, PHASE_LIVE, 'Phase should be LIVE after TWAP window fills');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 2: Normal Operation Cycles (mintOD, burnOD, mintORC)
    // ═══════════════════════════════════════════════════════════════════════

    await vm.it('normal operation: mintOD, burnOD, mintORC in LIVE phase', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        // Use 10 WBTC seed with preminted OD to get ratio into 400%-800% range.
        // ratio = reserve * twap / od_supply
        //   = 10_00000000 * 10_000_000_000_000 / premintOd
        // For 600%: premintOd = 10e8 * 1e13 / 6e8 = 1.667e13
        // We premint 15_000_000_000_000 OD for a starting ratio of ~667%.
        const seedWbtc = 10_00000000n; // 10 WBTC
        const premintOd = 15_000_000_000_000n; // ~150,000 OD
        await bootstrapToLive(fixtures, deployer, user, seedWbtc, premintOd);

        // After bootstrap:
        // reserve = 10 WBTC, od_supply = 15_000_000_000_000
        // ratio = 10_00000000 * 10_000_000_000_000 / 15_000_000_000_000 = 666_666_666 (~667%)

        // ── User mints OD (deposits 1 WBTC, receives OD) ──
        const wbtcForOd = 1_00000000n; // 1 WBTC
        await wbtc.mintRaw(user, wbtcForOd);
        await wbtc.increaseAllowance(user, reserve.address, wbtcForOd);

        const mintOdRes = await reserve.mintOD(user, wbtcForOd);
        Assert.equal(mintOdRes.error, undefined, `mintOD failed: ${mintOdRes.error?.message}`);

        const odMinted = new BinaryReader(mintOdRes.response).readU256();
        // od_gross = 1_00000000 * 10_000_000_000_000 / 100_000_000 = 10_000_000_000_000
        // fee = 10_000_000_000_000 * 1_500_000 / 100_000_000 = 150_000_000_000
        // od_out = 9_850_000_000_000
        Assert.equal(odMinted, 9_850_000_000_000n, `Expected 9_850_000_000_000 OD, got ${odMinted}`);

        const userOdAfterMint = await od.balanceOf(user);
        Assert.equal(userOdAfterMint, 9_850_000_000_000n, 'User should have OD after mintOD');

        const reserveWbtcAfterMintOd = await wbtc.balanceOf(reserve.address);
        Assert.equal(reserveWbtcAfterMintOd, 11_00000000n, 'Reserve should hold 11 WBTC');

        // ── User burns OD (returns 1000 OD, receives WBTC) ──
        const odToBurn = 100_000_000_000n; // 1000 OD

        const burnOdRes = await reserve.burnOD(user, odToBurn);
        Assert.equal(burnOdRes.error, undefined, `burnOD failed: ${burnOdRes.error?.message}`);

        const wbtcFromBurn = new BinaryReader(burnOdRes.response).readU256();
        // wbtc_gross = 100_000_000_000 * 100_000_000 / 10_000_000_000_000 = 1_000_000
        // fee = 1_000_000 * 1_500_000 / 100_000_000 = 15_000
        // wbtc_out = 985_000
        Assert.equal(wbtcFromBurn, 985_000n, `Expected 985_000 WBTC out, got ${wbtcFromBurn}`);

        const userOdAfterBurn = await od.balanceOf(user);
        Assert.equal(userOdAfterBurn, 9_850_000_000_000n - 100_000_000_000n,
            'User OD should decrease by burned amount');

        const userWbtcAfterBurn = await wbtc.balanceOf(user);
        Assert.equal(userWbtcAfterBurn, 985_000n, 'User should have received WBTC from burnOD');

        // ── User mints ORC (deposits 0.5 WBTC, receives ORC) ──
        // After mintOD + burnOD:
        // reserve ~= 11_00000000 - 985_000 = 10_99015000 WBTC
        // od_supply = 15_000_000_000_000 + 9_850_000_000_000 - 100_000_000_000 = 24_750_000_000_000
        // ratio = 10_99015000 * 10_000_000_000_000 / 24_750_000_000_000 ~= 443,844,444 (~444%)
        // 444% < 800% so mintORC is allowed.

        const orcMintAmount = 50_000_000n; // 0.5 WBTC
        await wbtc.mintRaw(user, orcMintAmount);
        await wbtc.increaseAllowance(user, reserve.address, orcMintAmount);

        const mintOrcRes = await reserve.mintORC(user, orcMintAmount);
        Assert.equal(mintOrcRes.error, undefined, `mintORC in LIVE failed: ${mintOrcRes.error?.message}`);

        const orcMinted = new BinaryReader(mintOrcRes.response).readU256();
        Assert.notEqual(orcMinted, 0n, 'Should receive non-zero ORC from mintORC');

        // Verify user ORC balance increased
        const userOrcFinal = await orc.balanceOf(user);
        Assert.notEqual(userOrcFinal, 0n, 'User should have ORC balance');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 3: Reserve Ratio Enforcement
    // ═══════════════════════════════════════════════════════════════════════

    await vm.it('ratio enforcement: mintOD blocked near 400%, burnOD still works, mintORC still works', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 1_00000000n; // 1 WBTC (small reserve for tight ratio)
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        // Mint OD to bring ratio down toward 400%.
        // With 1 WBTC reserve at $100K TWAP, the post-mint ratio for X sats deposited is:
        //   od_out ~= X * TWAP / RATIO_SCALE * 0.985
        //   ratio_after = (1e8 + X) * TWAP / (od_out)
        //
        // First mint: 0.24 WBTC
        const firstMint = 24_000_000n;
        await wbtc.mintRaw(user, firstMint);
        await wbtc.increaseAllowance(user, reserve.address, firstMint);
        const m1 = await reserve.mintOD(user, firstMint);
        Assert.equal(m1.error, undefined, `First mintOD failed: ${m1.error?.message}`);

        const odFromFirst = new BinaryReader(m1.response).readU256();
        // od_gross = 24_000_000 * 10_000_000_000_000 / 100_000_000 = 2_400_000_000_000
        // fee = 2_400_000_000_000 * 1_500_000 / 100_000_000 = 36_000_000_000
        // od_out = 2_364_000_000_000
        Assert.equal(odFromFirst, 2_364_000_000_000n, 'First OD mint amount check');

        // After first mint: reserve = 1_24000000, od_supply = 2_364_000_000_000
        // ratio = 1_24000000 * 10_000_000_000_000 / 2_364_000_000_000
        //       = 1.24e8 * 1e13 / 2.364e12 = 1.24e21 / 2.364e12 ~= 524_534_161 (~524%)

        // Try a second large mint of 0.5 WBTC that would breach 400%:
        // od_gross = 50_000_000 * 10_000_000_000_000 / 100_000_000 = 5_000_000_000_000
        // fee = 5_000_000_000_000 * 1_500_000 / 100_000_000 = 75_000_000_000
        // od_out_2 = 4_925_000_000_000
        // new_reserve = 1_24000000 + 50_000_000 = 1_74000000
        // new_od_supply = 2_364_000_000_000 + 4_925_000_000_000 = 7_289_000_000_000
        // ratio = 1_74000000 * 10_000_000_000_000 / 7_289_000_000_000
        //       = 1.74e8 * 1e13 / 7.289e12 = 1.74e21 / 7.289e12 ~= 238_715_875 (~238%)
        // 238% < 400% => BLOCKED!
        const hugeAmount = 50_000_000n;
        await wbtc.mintRaw(user, hugeAmount);
        await wbtc.increaseAllowance(user, reserve.address, hugeAmount);
        const m2 = await reserve.mintOD(user, hugeAmount);
        Assert.notEqual(m2.status, 0, 'mintOD should be blocked when ratio would breach 400%');

        // Verify burnOD still works (Djed invariant: burn is never blocked)
        const burnAmount = 100_000_000_000n; // 1000 OD
        const burnRes = await reserve.burnOD(user, burnAmount);
        Assert.equal(burnRes.error, undefined, `burnOD should succeed even near min ratio: ${burnRes.error?.message}`);

        const wbtcFromBurn = new BinaryReader(burnRes.response).readU256();
        Assert.notEqual(wbtcFromBurn, 0n, 'Should receive WBTC from burnOD');

        // Verify mintORC is still allowed (brings ratio UP by adding equity)
        // After the burn, ratio should be slightly higher. With ratio ~524% before
        // and burning reduces OD supply, ratio goes UP.
        // But we're now near max ratio (high), so mintORC requires ratio < 800%.
        // After burn: od_supply = 2_364_000_000_000 - 100_000_000_000 = 2_264_000_000_000
        // reserve ~= 1_24000000 - 985_000 = 1_23015000
        // ratio = 1_23015000 * 10_000_000_000_000 / 2_264_000_000_000
        //       = 1.23015e8 * 1e13 / 2.264e12 ~= 543_353_356 (~543%)
        // 543% < 800%, so mintORC should succeed.
        const orcMintWbtc = 10_000_000n; // 0.1 WBTC
        await wbtc.mintRaw(user, orcMintWbtc);
        await wbtc.increaseAllowance(user, reserve.address, orcMintWbtc);
        const mintOrcRes = await reserve.mintORC(user, orcMintWbtc);
        Assert.equal(mintOrcRes.error, undefined, `mintORC should succeed near min ratio: ${mintOrcRes.error?.message}`);

        const orcMinted = new BinaryReader(mintOrcRes.response).readU256();
        Assert.notEqual(orcMinted, 0n, 'Should receive ORC from mintORC');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 4: Fees Accrue to Reserve
    // ═══════════════════════════════════════════════════════════════════════

    await vm.it('fees accrue to reserve: equity increases after mintOD + burnOD cycle', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n; // 10 WBTC
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        // Note equity before the mint/burn cycle.
        // No OD minted yet, so equity = wbtcBalance = 10 WBTC.
        const equityBefore = await reserve.getEquity(deployer);
        Assert.equal(equityBefore, 10_00000000n, 'Initial equity should be 10 WBTC');

        // Execute mintOD: deposit 1 WBTC -> get OD
        const wbtcForOd = 1_00000000n;
        await wbtc.mintRaw(user, wbtcForOd);
        await wbtc.increaseAllowance(user, reserve.address, wbtcForOd);
        const mintRes = await reserve.mintOD(user, wbtcForOd);
        Assert.equal(mintRes.error, undefined, `mintOD failed: ${mintRes.error?.message}`);

        const odMinted = new BinaryReader(mintRes.response).readU256();
        // od_out = 9_850_000_000_000

        // Execute burnOD: return ALL minted OD -> get WBTC back
        const burnRes = await reserve.burnOD(user, odMinted);
        Assert.equal(burnRes.error, undefined, `burnOD failed: ${burnRes.error?.message}`);

        const wbtcReturned = new BinaryReader(burnRes.response).readU256();
        // wbtc_gross = 9_850_000_000_000 * 100_000_000 / 10_000_000_000_000 = 98_500_000
        // fee = 98_500_000 * 1_500_000 / 100_000_000 = 1_477_500
        // wbtc_out = 97_022_500

        // After full round-trip: reserve has 10 WBTC + 1 WBTC - 97_022_500 sats
        //   = 11_00000000 - 97_022_500 = 10_02977500
        // OD supply is back to 0, so equity = reserve balance = 10_02977500
        const equityAfter = await reserve.getEquity(deployer);
        Assert.equal(equityAfter > equityBefore, true,
            `Equity should increase after mint/burn cycle. Before: ${equityBefore}, After: ${equityAfter}`);

        // Verify exact equity: fees stayed in reserve
        // User deposited 1 WBTC, got back 97_022_500 sats.
        // Reserve gained: 100_000_000 - 97_022_500 = 2_977_500 sats
        const expectedEquity = 10_00000000n + (1_00000000n - 97_022_500n);
        Assert.equal(equityAfter, expectedEquity,
            `Expected equity ${expectedEquity}, got ${equityAfter}`);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Scenario 5: ORC Burn Blocked When Under-Collateralized
    // ═══════════════════════════════════════════════════════════════════════

    await vm.it('burnORC blocked when it would drop ratio below 400%', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        // Use a moderate seed to set up conditions where burning ORC would be problematic
        const seedWbtc = 5_00000000n; // 5 WBTC

        // We premint enough OD so that the ratio is around 500%
        // For 5 WBTC at seedPrice $100K:
        //   ratio = 5_00000000 * 10_000_000_000_000 / odAmount
        //   For 500%: odAmount = 5e8 * 1e13 / 500_000_000 = 5e21 / 5e8 = 1e13 = 10_000_000_000_000
        // Let's premint 8_000_000_000_000 OD (~80K OD) for a ratio of ~625%.
        const premintOd = 8_000_000_000_000n;
        await bootstrapToLive(fixtures, deployer, user, seedWbtc, premintOd);

        // After bootstrap: reserve = 5 WBTC, OD supply = 8_000_000_000_000
        // ORC supply from seeding = 5_00000000 * 0.985 = 492_500_000
        // equity = 5_00000000 - 8_000_000_000_000 * 100_000_000 / 10_000_000_000_000
        //        = 5_00000000 - 80_000_000 = 420_000_000

        // Check that the user has ORC to burn
        const userOrc = await orc.balanceOf(user);
        Assert.notEqual(userOrc, 0n, 'User should have ORC from seeding');

        // ratio = 5_00000000 * 10_000_000_000_000 / 8_000_000_000_000
        //       = 5e8 * 1e13 / 8e12 = 5e21 / 8e12 = 625_000_000 (~625%)

        // Burning ORC removes equity (pays out WBTC proportional to equity/orcSupply).
        // If we burn ALL ORC, we'd remove all equity, leaving the reserve dangerously
        // under-collateralized.
        //
        // burnORC sends: wbtcOut = orcAmount * equity / orcSupply - fee
        // For burning all ORC (492_500_000):
        //   wbtcOut_raw = 492_500_000 * 420_000_000 / 492_500_000 = 420_000_000
        //   fee = 420_000_000 * 1_500_000 / 100_000_000 = 6_300_000
        //   wbtcNet = 413_700_000
        //
        // After burn: reserve = 5_00000000 - 413_700_000 = 86_300_000
        // ratio = 86_300_000 * 10_000_000_000_000 / 8_000_000_000_000
        //       = 8.63e7 * 1e13 / 8e12 = 8.63e20 / 8e12 ~= 107_875_000 (~107%)
        // 107% < 400% => BLOCKED!

        const burnAllRes = await reserve.burnORC(user, userOrc);
        Assert.notEqual(burnAllRes.status, 0,
            'burnORC should be blocked when it would drop ratio below 400%');

        // Verify that a small burnORC also fails if it would breach the ratio.
        // With 625% ratio and target 400%, we can remove (625-400)/625 * equity
        // of the equity before hitting the floor. That's about 36% of equity.
        // equity = 420_000_000, 36% = 151_200_000 WBTC out max
        // orcAmount for 151_200_000 WBTC: orcAmount = wbtcOut * orcSupply / equity
        //   ~= 151_200_000 * 492_500_000 / 420_000_000 ~= 177_214_285
        // But we also have the fee, so actual threshold is a bit different.
        //
        // Let's just try burning 80% of ORC (should fail) and 10% of ORC (should succeed).

        // 80% of ORC should fail
        const burn80pct = userOrc * 80n / 100n;
        const burnLargeRes = await reserve.burnORC(user, burn80pct);
        Assert.notEqual(burnLargeRes.status, 0,
            'burnORC of 80% should be blocked when it would drop ratio below 400%');

        // 10% of ORC should succeed — only removes ~10% of equity, ratio stays above 400%
        const burn10pct = userOrc * 10n / 100n;
        const burnSmallRes = await reserve.burnORC(user, burn10pct);
        Assert.equal(burnSmallRes.error, undefined,
            `burnORC of 10% should succeed: ${burnSmallRes.error?.message}`);

        const wbtcFromSmallBurn = new BinaryReader(burnSmallRes.response).readU256();
        Assert.notEqual(wbtcFromSmallBurn, 0n, 'Should receive WBTC from small burnORC');
    });
});
