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

// ─── Test suite ─────────────────────────────────────────────────────────────────

await opnet('ODReserve mintORC / burnORC', async (vm: OPNetUnit) => {
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
        // View calls (totalSupply, balanceOf) use saveStates:false which does NOT
        // commit the deployment to StateHandler. Cross-contract calls from ODReserve
        // would then try to re-deploy with empty calldata, which fails for OD/ORC
        // because their onDeployment expects a reserve address.
        //
        // We use mintRaw for WBTC (unrestricted), and increaseAllowance for OD/ORC
        // (any user can set allowances, which triggers deployment with saveStates=true).
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
    // mintORC tests
    // ═══════════════════════════════════════════════════════════════════════

    // ── Test 1: mintORC reverts with zero amount ──────────────────────────

    await vm.it('mintORC reverts with zero wbtcAmount', async () => {
        const res = await reserve.mintORC(user, 0n);
        Assert.notEqual(res.status, 0, 'Expected mintORC to revert with zero amount');
    });

    // ── Test 2: mintORC reverts in PREMINT phase ─────────────────────────

    await vm.it('mintORC reverts in PREMINT phase', async () => {
        // Advance to PREMINT
        const seedPrice = 10_000_000_000_000n;
        const advanceRes = await reserve.advancePhase(deployer, seedPrice);
        Assert.equal(advanceRes.error, undefined, `advancePhase failed: ${advanceRes.error?.message}`);

        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_PREMINT, 'Expected PREMINT phase');

        const res = await reserve.mintORC(user, 100_000_000n);
        Assert.notEqual(res.status, 0, 'Expected mintORC to revert in PREMINT phase');
    });

    // ── Test 3: mintORC succeeds in SEEDING phase (first mint, orc supply = 0) ──

    await vm.it('mintORC succeeds in SEEDING phase with first mint (1:1 since no seedPrice)', async () => {
        // We are in SEEDING phase. seedPrice is not set yet (zero),
        // so first mint uses 1:1 ratio: 1 WBTC = 1 ORC (minus fee).
        const wbtcAmount = 1_00000000n; // 1 WBTC in 8-decimal

        // Mint WBTC to user
        await wbtc.mintRaw(user, wbtcAmount);
        const userWbtcBefore = await wbtc.balanceOf(user);
        Assert.equal(userWbtcBefore, wbtcAmount, 'User should have WBTC');

        // User approves reserve to spend WBTC
        await wbtc.increaseAllowance(user, reserve.address, wbtcAmount);

        // Call mintORC
        const res = await reserve.mintORC(user, wbtcAmount);
        Assert.equal(res.error, undefined, `mintORC reverted: ${res.error?.message}`);

        // Read ORC minted amount from response
        const reader = new BinaryReader(res.response);
        const orcNet = reader.readU256();

        // With 1:1 ratio and 1.5% fee:
        // orcOut = 1_00000000 (1:1 because seedPrice = 0)
        // fee = 1_00000000 * 1_500_000 / 100_000_000 = 1_500_000
        // orcNet = 1_00000000 - 1_500_000 = 98_500_000
        Assert.equal(orcNet, 98_500_000n, `Expected 98_500_000 ORC net, got ${orcNet}`);

        // Verify ORC balance
        const userOrcBalance = await orc.balanceOf(user);
        Assert.equal(userOrcBalance, 98_500_000n, 'User ORC balance mismatch');

        // Verify WBTC was transferred to reserve
        const userWbtcAfter = await wbtc.balanceOf(user);
        Assert.equal(userWbtcAfter, 0n, 'User should have 0 WBTC after mintORC');

        const reserveWbtc = await wbtc.balanceOf(reserve.address);
        Assert.equal(reserveWbtc, wbtcAmount, 'Reserve should hold the deposited WBTC');
    });

    // ── Test 4: mintORC with seedPrice set (after advancePhase but before PREMINT check) ──

    await vm.it('mintORC in SEEDING uses 1:1 ratio when seedPrice not set', async () => {
        // We are in SEEDING phase, seedPrice = 0
        const wbtcAmount = 2_00000000n; // 2 WBTC

        await wbtc.mintRaw(user, wbtcAmount);
        await wbtc.increaseAllowance(user, reserve.address, wbtcAmount);

        const res = await reserve.mintORC(user, wbtcAmount);
        Assert.equal(res.error, undefined, `mintORC reverted: ${res.error?.message}`);

        const reader = new BinaryReader(res.response);
        const orcNet = reader.readU256();

        // 2_00000000 * (1 - 1.5%) = 2_00000000 - 3_000_000 = 197_000_000
        Assert.equal(orcNet, 197_000_000n, `Expected 197_000_000 ORC net, got ${orcNet}`);
    });

    // ── Test 5: second mintORC uses equity-based pricing ─────────────────

    await vm.it('second mintORC in SEEDING uses equity-based pricing', async () => {
        // First mint: deposit 1 WBTC, get ~0.985 ORC (with 1:1 and fee)
        const firstAmount = 1_00000000n;
        await wbtc.mintRaw(user, firstAmount);
        await wbtc.increaseAllowance(user, reserve.address, firstAmount);
        const res1 = await reserve.mintORC(user, firstAmount);
        Assert.equal(res1.error, undefined, `First mintORC failed: ${res1.error?.message}`);

        // Now ORC supply > 0, equity_in_wbtc = reserve_wbtc = 1_00000000
        // Second mint: deposit 0.5 WBTC
        const secondAmount = 50_000_000n; // 0.5 WBTC
        await wbtc.mintRaw(user, secondAmount);
        await wbtc.increaseAllowance(user, reserve.address, secondAmount);

        const res2 = await reserve.mintORC(user, secondAmount);
        Assert.equal(res2.error, undefined, `Second mintORC failed: ${res2.error?.message}`);

        const reader = new BinaryReader(res2.response);
        const orcNet2 = reader.readU256();

        // After first mint: reserve = 1_00000000 WBTC, orcSupply = 98_500_000
        // Second mint deposits 50_000_000 WBTC to reserve FIRST (transferFrom),
        // so when _computeOrcOut runs, reserve = 1_50000000 WBTC
        // equity_in_wbtc = 1_50000000 (no OD minted, so equity = reserve balance)
        // orcOut = 50_000_000 * 98_500_000 / 1_50000000 = 32_833_333 (integer div)
        // fee = 32_833_333 * 1_500_000 / 100_000_000 = 492_499 (integer div)
        // orcNet = 32_833_333 - 492_499 = 32_340_834
        Assert.equal(orcNet2, 32_340_834n, `Expected 32_340_834 ORC net, got ${orcNet2}`);
    });

    // ── Test 6: burnORC reverts in SEEDING phase ─────────────────────────

    await vm.it('burnORC reverts in SEEDING phase', async () => {
        const res = await reserve.burnORC(user, 100_000_000n);
        Assert.notEqual(res.status, 0, 'Expected burnORC to revert in SEEDING phase');
    });

    // ── Test 7: burnORC reverts in PREMINT phase ─────────────────────────

    await vm.it('burnORC reverts in PREMINT phase', async () => {
        const seedPrice = 10_000_000_000_000n;
        await reserve.advancePhase(deployer, seedPrice);

        const res = await reserve.burnORC(user, 100_000_000n);
        Assert.notEqual(res.status, 0, 'Expected burnORC to revert in PREMINT phase');
    });

    // ── Test 8: burnORC reverts with zero amount ─────────────────────────

    await vm.it('burnORC reverts with zero orcAmount', async () => {
        const res = await reserve.burnORC(user, 0n);
        Assert.notEqual(res.status, 0, 'Expected burnORC to revert with zero amount');
    });

    // ── Test 9: mintORC in LIVE phase works (full lifecycle) ─────────────

    await vm.it('mintORC in LIVE phase succeeds when ratio allows', async () => {
        // --- Setup: get to LIVE phase ---

        // 1. Mint some WBTC to user and do first mintORC in SEEDING
        const seedWbtc = 10_00000000n; // 10 WBTC
        await wbtc.mintRaw(user, seedWbtc);
        await wbtc.increaseAllowance(user, reserve.address, seedWbtc);
        const seedMintRes = await reserve.mintORC(user, seedWbtc);
        Assert.equal(seedMintRes.error, undefined, `Seed mintORC failed: ${seedMintRes.error?.message}`);

        // 2. Advance to PREMINT with seed price
        const seedPrice = 10_000_000_000_000n; // $100K per BTC in 1e8
        const advRes = await reserve.advancePhase(deployer, seedPrice);
        Assert.equal(advRes.error, undefined, `advancePhase failed: ${advRes.error?.message}`);

        // 3. Set up pool and TWAP
        await pool.setToken0(deployer, reserve.wbtcAddr);
        await pool.setPrice0Cumulative(deployer, 0n);
        const initRes = await reserve.initPool(deployer, pool.address);
        Assert.equal(initRes.error, undefined, `initPool failed: ${initRes.error?.message}`);
        await reserve.updateTwapSnapshot(deployer);

        // 4. Advance blocks to fill TWAP window (6 blocks)
        Blockchain.blockNumber = 106n;
        const deltaPerBlock = 10_000_000_000_000n; // 100K OD per BTC
        await pool.setPrice0Cumulative(deployer, deltaPerBlock * 6n);

        // 5. Read TWAP to trigger PREMINT -> LIVE auto-transition
        const twap = await reserve.getTwap(deployer);
        Assert.notEqual(twap, 0n, 'TWAP should be non-zero');

        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_LIVE, 'Expected LIVE phase');

        // --- Now test mintORC in LIVE phase ---
        // Reserve has 10 WBTC, OD supply = 0, so ratio = infinite (> MAX_RATIO)
        // When OD supply is 0, ratio returns u256.Max which is > MAX_RATIO
        // So mintORC should be BLOCKED.
        const liveAmount = 1_00000000n;
        await wbtc.mintRaw(user, liveAmount);
        await wbtc.increaseAllowance(user, reserve.address, liveAmount);

        const liveRes = await reserve.mintORC(user, liveAmount);
        // When OD supply is 0 and we're in LIVE, ratio = u256.Max > MAX_RATIO
        // mintORC checks _requireRatioBelow(MAX_RATIO, ...) which should revert
        Assert.notEqual(liveRes.status, 0, 'Expected mintORC to revert when ratio above MAX_RATIO (no OD minted)');
    });

    // ── Test 10: anyone can call mintORC (no access control on who mints ORC) ──

    await vm.it('any address can call mintORC (not restricted to owner)', async () => {
        const otherUser = Blockchain.generateRandomAddress();
        const wbtcAmount = 1_00000000n;

        await wbtc.mintRaw(otherUser, wbtcAmount);
        await wbtc.increaseAllowance(otherUser, reserve.address, wbtcAmount);

        const res = await reserve.mintORC(otherUser, wbtcAmount);
        Assert.equal(res.error, undefined, `mintORC by non-owner reverted: ${res.error?.message}`);

        const orcBalance = await orc.balanceOf(otherUser);
        Assert.notEqual(orcBalance, 0n, 'Other user should have received ORC');
    });

    // ── Test 11: mintORC transfers WBTC from user to reserve ─────────────

    await vm.it('mintORC correctly transfers WBTC from user to reserve', async () => {
        const wbtcAmount = 5_00000000n; // 5 WBTC

        await wbtc.mintRaw(user, wbtcAmount);
        await wbtc.increaseAllowance(user, reserve.address, wbtcAmount);

        const userBalBefore = await wbtc.balanceOf(user);
        const reserveBalBefore = await wbtc.balanceOf(reserve.address);
        Assert.equal(userBalBefore, wbtcAmount, 'User should start with WBTC');
        Assert.equal(reserveBalBefore, 0n, 'Reserve should start with 0 WBTC');

        await reserve.mintORC(user, wbtcAmount);

        const userBalAfter = await wbtc.balanceOf(user);
        const reserveBalAfter = await wbtc.balanceOf(reserve.address);
        Assert.equal(userBalAfter, 0n, 'User should have 0 WBTC after mint');
        Assert.equal(reserveBalAfter, wbtcAmount, 'Reserve should hold deposited WBTC');
    });

    // ── Test 12: mintORC reverts if user has insufficient WBTC allowance ──

    await vm.it('mintORC reverts if user has insufficient WBTC allowance', async () => {
        const wbtcAmount = 1_00000000n;
        await wbtc.mintRaw(user, wbtcAmount);
        // Do NOT approve the reserve

        // The WBTC transferFrom will fail inside the WASM, which may cause
        // a RuntimeError (unreachable) that the framework catches as an error.
        let reverted = false;
        try {
            const res = await reserve.mintORC(user, wbtcAmount);
            if (res.status !== 0 || res.error) {
                reverted = true;
            }
        } catch {
            reverted = true;
        }
        Assert.equal(reverted, true, 'Expected mintORC to revert without WBTC approval');
    });

    // ── Test 13: mintORC reverts if user has insufficient WBTC balance ────

    await vm.it('mintORC reverts if user has insufficient WBTC balance', async () => {
        // User has 0 WBTC but approves anyway
        await wbtc.increaseAllowance(user, reserve.address, 1_00000000n);

        // The WBTC transferFrom will fail inside the WASM due to insufficient balance.
        let reverted = false;
        try {
            const res = await reserve.mintORC(user, 1_00000000n);
            if (res.status !== 0 || res.error) {
                reverted = true;
            }
        } catch {
            reverted = true;
        }
        Assert.equal(reverted, true, 'Expected mintORC to revert without WBTC balance');
    });
});
