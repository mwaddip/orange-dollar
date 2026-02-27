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

const SET_RESERVE_SELECTOR = 0xb86a7d16;

class ODTokenContract extends OP20 {
    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
    ) {
        super({ file: OD_WASM_PATH, address, deployer, decimals: 8 });
    }

    async setReserve(
        caller: import('@btc-vision/transaction').Address,
        reserve: import('@btc-vision/transaction').Address,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(SET_RESERVE_SELECTOR);
        calldata.writeAddress(reserve);
        return this.execute({ calldata: calldata.getBuffer(), sender: caller, txOrigin: caller });
    }
}

// ─── ORC token wrapper ──────────────────────────────────────────────────────────

class ORCTokenContract extends OP20 {
    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
    ) {
        super({ file: ORC_WASM_PATH, address, deployer, decimals: 8 });
    }

    async setReserve(
        caller: import('@btc-vision/transaction').Address,
        reserve: import('@btc-vision/transaction').Address,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(SET_RESERVE_SELECTOR);
        calldata.writeAddress(reserve);
        return this.execute({ calldata: calldata.getBuffer(), sender: caller, txOrigin: caller });
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

    // OD and ORC are deployed with the reserve address as the authorized minter
    const od = new ODTokenContract(odAddress, deployer);
    const orc = new ORCTokenContract(orcAddress, deployer);
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

await opnet('ODReserve premintOD / getReserveRatio / getEquity', async (vm: OPNetUnit) => {
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

        // Set the reserve address on OD and ORC (one-shot, owner-only).
        await od.setReserve(deployer, reserve.address);
        await orc.setReserve(deployer, reserve.address);

        // Force WBTC deployment commit.
        const dummyAddr = Blockchain.generateRandomAddress();
        await wbtc.mintRaw(dummyAddr, 0n);

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
    // premintOD tests
    // ═══════════════════════════════════════════════════════════════════════

    // ── Test 1: premintOD reverts for non-owner ─────────────────────────

    await vm.it('premintOD reverts for non-owner', async () => {
        // Seed reserve and advance to PREMINT
        const seedWbtc = 10_00000000n;
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        await reserve.mintORC(user, seedWbtc);
        await reserve.advancePhase(deployer, 10_000_000_000_000n);

        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_PREMINT, 'Expected PREMINT phase');

        // Non-owner tries to premint
        const nonOwner = Blockchain.generateRandomAddress();
        const res = await reserve.premintOD(nonOwner, 1_000_000_000_000n);
        Assert.notEqual(res.status, 0, 'Expected premintOD to revert for non-owner');
    });

    // ── Test 2: premintOD reverts in SEEDING phase ──────────────────────

    await vm.it('premintOD reverts in SEEDING phase', async () => {
        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_SEEDING, 'Expected SEEDING phase');

        const res = await reserve.premintOD(deployer, 1_000_000_000_000n);
        Assert.notEqual(res.status, 0, 'Expected premintOD to revert in SEEDING phase');
    });

    // ── Test 3: premintOD reverts in LIVE phase ─────────────────────────

    await vm.it('premintOD reverts in LIVE phase', async () => {
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n;
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_LIVE, 'Expected LIVE phase');

        const res = await reserve.premintOD(deployer, 1_000_000_000_000n);
        Assert.notEqual(res.status, 0, 'Expected premintOD to revert in LIVE phase');
    });

    // ── Test 4: premintOD reverts with zero amount ──────────────────────

    await vm.it('premintOD reverts with zero amount', async () => {
        // Advance to PREMINT with some WBTC in reserve
        const seedWbtc = 10_00000000n;
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        await reserve.mintORC(user, seedWbtc);
        await reserve.advancePhase(deployer, 10_000_000_000_000n);

        const res = await reserve.premintOD(deployer, 0n);
        Assert.notEqual(res.status, 0, 'Expected premintOD to revert with zero amount');
    });

    // ── Test 5: premintOD succeeds in PREMINT phase, OD minted to owner ─

    await vm.it('premintOD succeeds in PREMINT phase, OD minted to owner', async () => {
        // Seed reserve with 10 WBTC
        const seedWbtc = 10_00000000n;
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        await reserve.mintORC(user, seedWbtc);

        // Advance to PREMINT with seedPrice = $100K
        const seedPrice = 10_000_000_000_000n;
        await reserve.advancePhase(deployer, seedPrice);

        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_PREMINT, 'Expected PREMINT phase');

        // Premint a reasonable amount of OD.
        // Reserve has 10 WBTC = 10_00000000 sats. seedPrice = 10_000_000_000_000.
        // ratio = wbtcBal * seedPrice / odAmount
        // For 400% ratio: odAmount = wbtcBal * seedPrice / 400_000_000
        //   = 10_00000000 * 10_000_000_000_000 / 400_000_000
        //   = 10^9 * 10^13 / 4*10^8
        //   = 10^22 / 4*10^8
        //   = 2.5 * 10^13
        // So premint of 2_500_000_000_000 would be exactly at 400% (borderline).
        // Let's premint 1_000_000_000_000 (well within ratio).
        // ratio = 10_00000000 * 10_000_000_000_000 / 1_000_000_000_000
        //       = 10^9 * 10^13 / 10^12 = 10^10 = 10_000_000_000
        // That's 10_000_000_000 / 100_000_000 = 100x = 10000% ratio. OK!
        const odAmount = 1_000_000_000_000n; // 10,000 OD
        const res = await reserve.premintOD(deployer, odAmount);
        Assert.equal(res.error, undefined, `premintOD failed: ${res.error?.message}`);

        // Verify OD was minted to the owner (deployer)
        const ownerOdBalance = await od.balanceOf(deployer);
        Assert.equal(ownerOdBalance, odAmount, `Owner should have ${odAmount} OD, got ${ownerOdBalance}`);
    });

    // ── Test 6: premintOD reverts on second call ────────────────────────

    await vm.it('premintOD reverts on second call (_premintDone flag)', async () => {
        // Seed and advance to PREMINT
        const seedWbtc = 10_00000000n;
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        await reserve.mintORC(user, seedWbtc);
        await reserve.advancePhase(deployer, 10_000_000_000_000n);

        // First premint succeeds
        const odAmount = 1_000_000_000_000n;
        const res1 = await reserve.premintOD(deployer, odAmount);
        Assert.equal(res1.error, undefined, `First premintOD failed: ${res1.error?.message}`);

        // Second premint should revert
        const res2 = await reserve.premintOD(deployer, odAmount);
        Assert.notEqual(res2.status, 0, 'Expected premintOD to revert on second call');
    });

    // ── Test 7: premintOD respects ratio: large premint that breaches 400% reverts ─

    await vm.it('premintOD reverts when premint would breach 400% ratio', async () => {
        // Seed with 1 WBTC
        const seedWbtc = 1_00000000n;
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        await reserve.mintORC(user, seedWbtc);

        const seedPrice = 10_000_000_000_000n; // $100K
        await reserve.advancePhase(deployer, seedPrice);

        // Max OD for 400% ratio with 1 WBTC:
        // ratio = wbtcBal * seedPrice / odAmount >= MIN_RATIO (400_000_000)
        // odAmount <= wbtcBal * seedPrice / MIN_RATIO
        //          = 1_00000000 * 10_000_000_000_000 / 400_000_000
        //          = 10^8 * 10^13 / 4*10^8
        //          = 10^21 / 4*10^8
        //          = 2_500_000_000_000
        //
        // So preminting 2_500_000_000_001 should breach ratio and revert.
        const tooMuchOD = 2_500_000_000_001n;
        const res = await reserve.premintOD(deployer, tooMuchOD);
        Assert.notEqual(res.status, 0, 'Expected premintOD to revert when ratio would breach 400%');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // getReserveRatio tests
    // ═══════════════════════════════════════════════════════════════════════

    // ── Test 8: getReserveRatio returns u256.Max when no OD supply ──────

    await vm.it('getReserveRatio returns u256.Max when no OD supply', async () => {
        // Seed with some WBTC and go to LIVE. No OD minted.
        const fixtures = { reserve, pool, wbtc, od, orc };
        const seedWbtc = 10_00000000n;
        await bootstrapToLive(fixtures, deployer, user, seedWbtc);

        const ratio = await reserve.getReserveRatio(deployer);

        // u256.Max is a very large number (2^256 - 1)
        const u256Max = (1n << 256n) - 1n;
        Assert.equal(ratio, u256Max, `Expected u256.Max, got ${ratio}`);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // getEquity tests
    // ═══════════════════════════════════════════════════════════════════════

    // ── Test 9: getEquity returns wbtcBalance when no TWAP ──────────────

    await vm.it('getEquity returns wbtcBalance when no TWAP', async () => {
        // Seed with 5 WBTC in SEEDING phase (no pool, no TWAP)
        const seedWbtc = 5_00000000n;
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        const seedRes = await reserve.mintORC(user, seedWbtc);
        Assert.equal(seedRes.error, undefined, `Seed mintORC failed: ${seedRes.error?.message}`);

        // No pool set, so TWAP returns 0 => equity = wbtcBalance
        const equity = await reserve.getEquity(deployer);
        Assert.equal(equity, seedWbtc, `Expected equity to be ${seedWbtc}, got ${equity}`);
    });
});
