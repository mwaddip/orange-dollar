import { opnet, OPNetUnit, Assert, Blockchain, ContractRuntime } from '@btc-vision/unit-test-framework';
import { BinaryWriter, BinaryReader } from '@btc-vision/transaction';
import { BytecodeManager } from '@btc-vision/unit-test-framework';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Compiled WASM paths.
 */
const RESERVE_WASM_PATH = path.resolve(__dirname, '../build/ODReserve.wasm');
const POOL_WASM_PATH = path.resolve(__dirname, '../build/MockMotoSwapPool.wasm');

// ─── ODReserve selectors ───────────────────────────────────────────────────────
const GET_PHASE_SELECTOR       = 0x8605fcee; // getPhase()
const ADVANCE_PHASE_SELECTOR   = 0xd1ee3cb1; // advancePhase(uint256)
const INIT_POOL_SELECTOR       = 0xbc5abaf5; // initPool(address)
const GET_TWAP_SELECTOR        = 0xfa12b920; // getTwap()
const GET_TWAP_WINDOW_SELECTOR = 0xb366a420; // getTwapWindow()
const UPDATE_TWAP_SNAPSHOT_SEL = 0x60d1eba2; // updateTwapSnapshot()

// ─── MockMotoSwapPool selectors ────────────────────────────────────────────────
const SET_PRICE0_SELECTOR      = 0x05a98b81; // setPrice0Cumulative(uint256)
const SET_PRICE1_SELECTOR      = 0x3c3c60ba; // setPrice1Cumulative(uint256)
const SET_TOKEN0_SELECTOR      = 0x962bebd4; // setToken0(address)

// ─── Phase constants ───────────────────────────────────────────────────────────
const PHASE_SEEDING = 0;
const PHASE_PREMINT = 1;
const PHASE_LIVE    = 2;

// ─── MockMotoSwapPool wrapper ──────────────────────────────────────────────────

/**
 * Thin wrapper around MockMotoSwapPool.wasm providing helpers for
 * setPrice0Cumulative, setPrice1Cumulative, and setToken0.
 */
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

    /** Sets price0CumulativeLast to the given value. */
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

    /** Sets price1CumulativeLast to the given value. */
    async setPrice1Cumulative(
        caller: import('@btc-vision/transaction').Address,
        price: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(SET_PRICE1_SELECTOR);
        calldata.writeU256(price);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    /** Sets the token0 address reported by the pool. */
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

// ─── ODReserve wrapper ─────────────────────────────────────────────────────────

/**
 * Thin wrapper around ODReserve.wasm exposing TWAP-related methods.
 */
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

    /** Calls getPhase() and returns the phase as a number. */
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

    /** Calls advancePhase(seedPrice) as owner to move from SEEDING to PREMINT. */
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

    /** Calls initPool(poolAddress) as owner. */
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

    /** Calls getTwap() and returns the value as a bigint. */
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

    /** Calls getTwapWindow() and returns the value as a bigint. */
    async getTwapWindow(): Promise<bigint> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(GET_TWAP_WINDOW_SELECTOR);
        const result = await this.execute({
            calldata: calldata.getBuffer(),
        });
        if (result.error) {
            throw new Error(`getTwapWindow reverted: ${result.error.message}`);
        }
        return new BinaryReader(result.response).readU256();
    }

    /** Calls updateTwapSnapshot() to manually record the current cumulative. */
    async updateTwapSnapshot(caller?: import('@btc-vision/transaction').Address) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(UPDATE_TWAP_SNAPSHOT_SEL);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }
}

// ─── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Create a fresh ODReserve and MockMotoSwapPool, register both.
 * wbtcAddr from the reserve is used so we can configure pool.setToken0() correctly.
 */
function createFixtures(deployer: import('@btc-vision/transaction').Address): {
    reserve: ODReserveContract;
    pool: MockPoolContract;
} {
    const reserveAddress = Blockchain.generateRandomAddress();
    const poolAddress    = Blockchain.generateRandomAddress();
    const odAddr         = Blockchain.generateRandomAddress();
    const orcAddr        = Blockchain.generateRandomAddress();
    const wbtcAddr       = Blockchain.generateRandomAddress();
    const factoryAddr    = Blockchain.generateRandomAddress();

    const reserve = new ODReserveContract(
        reserveAddress,
        deployer,
        odAddr,
        orcAddr,
        wbtcAddr,
        factoryAddr,
    );
    const pool = new MockPoolContract(poolAddress, deployer);

    Blockchain.register(reserve);
    Blockchain.register(pool);

    return { reserve, pool };
}

// ─── Test suite ────────────────────────────────────────────────────────────────

await opnet('ODReserve TWAP Oracle', async (vm: OPNetUnit) => {
    let reserve: ODReserveContract;
    let pool: MockPoolContract;
    let deployer: import('@btc-vision/transaction').Address;

    vm.beforeEach(async () => {
        Blockchain.clearContracts();
        await Blockchain.init();

        deployer = Blockchain.generateRandomAddress();

        const fixtures = createFixtures(deployer);
        reserve = fixtures.reserve;
        pool = fixtures.pool;

        await reserve.init();
        await pool.init();

        // Reset block number to a known value for reproducible tests
        Blockchain.blockNumber = 100n;
    });

    vm.afterEach(() => {
        reserve.dispose();
        pool.dispose();
        Blockchain.clearContracts();
    });

    // ── Test 1: getTwap() returns zero before pool is initialised ─────────────

    await vm.it('getTwap() returns zero before pool is initialised', async () => {
        const twap = await reserve.getTwap(deployer);
        Assert.equal(twap, 0n, 'Expected TWAP to be zero when pool is not set');
    });

    // ── Test 2: getTwapWindow() returns 6 ────────────────────────────────────

    await vm.it('getTwapWindow() returns 6 (default window)', async () => {
        const window = await reserve.getTwapWindow();
        Assert.equal(window, 6n, 'Expected default TWAP window to be 6 blocks');
    });

    // ── Test 3: first getTwap() after initPool returns zero ───────────────────

    await vm.it('after initPool(), first getTwap() returns zero (snapshot delta = 0)', async () => {
        // Configure pool: WBTC is token0
        await pool.setToken0(deployer, reserve.wbtcAddr);
        await pool.setPrice0Cumulative(deployer, 1_000_000_00000000n);

        // initPool as owner
        const initRes = await reserve.initPool(deployer, pool.address);
        Assert.equal(
            initRes.error,
            undefined,
            `initPool reverted: ${initRes.error?.message}`,
        );

        // Same block: delta = 0, returns stored _currentTwap which is zero initially
        const twap = await reserve.getTwap(deployer);
        Assert.equal(twap, 0n, 'Expected TWAP to be zero immediately after initPool (same block)');
    });

    // ── Test 4: TWAP computed correctly after window fills ───────────────────

    await vm.it('TWAP computed correctly: 6 blocks, delta = 600_000 * 1e8 → 100_000 * 1e8 per block', async () => {
        // Configure pool: WBTC is token0
        await pool.setToken0(deployer, reserve.wbtcAddr);

        // Set initial cumulative at block 100
        const initialCumulative = 0n;
        await pool.setPrice0Cumulative(deployer, initialCumulative);

        // initPool at block 100 — takes snapshot (cumulative=0, block=100)
        const initRes = await reserve.initPool(deployer, pool.address);
        Assert.equal(initRes.error, undefined, `initPool failed: ${initRes.error?.message}`);

        // Manually trigger snapshot at block 100 to record the baseline
        const snapRes = await reserve.updateTwapSnapshot(deployer);
        Assert.equal(snapRes.error, undefined, `updateTwapSnapshot failed: ${snapRes.error?.message}`);

        // Advance 6 blocks
        Blockchain.blockNumber = 106n;

        // Set cumulative to initial + (100_000 * 1e8 * 6) = 60_000_000_000_000
        const deltaPerBlock = 100_000_00000000n; // 100,000 OD per WBTC in 8-decimal units
        const newCumulative = initialCumulative + deltaPerBlock * 6n;
        await pool.setPrice0Cumulative(deployer, newCumulative);

        // getTwap() should compute: 60_000_000_000_000 / 6 = 10_000_000_000_000
        // Wait — the TWAP is price per block, so cumulative/block gives us the rate
        // Rate = 60_000_000_000_000 / 6 = 10_000_000_000_000
        // This is 100,000 * 1e8 = $100K per WBTC in OD (1:1 with USD)
        const expectedTwap = deltaPerBlock; // 100_000_00000000
        const twap = await reserve.getTwap(deployer);

        Assert.equal(
            twap,
            expectedTwap,
            `Expected TWAP ${expectedTwap}, got ${twap}`,
        );
    });

    // ── Test 5: phase transitions to LIVE after TWAP window fills ────────────

    await vm.it('phase transitions to LIVE after TWAP window fills', async () => {
        // First advance to PREMINT
        const seedPrice = 10_000_000_000_000n; // $100K in 1e8 units
        const advanceRes = await reserve.advancePhase(deployer, seedPrice);
        Assert.equal(advanceRes.error, undefined, `advancePhase failed: ${advanceRes.error?.message}`);

        const phaseBefore = await reserve.getPhase();
        Assert.equal(phaseBefore, PHASE_PREMINT, 'Expected PREMINT phase before TWAP window fills');

        // Configure pool: WBTC is token0
        await pool.setToken0(deployer, reserve.wbtcAddr);
        await pool.setPrice0Cumulative(deployer, 0n);

        // initPool at block 100
        const initRes = await reserve.initPool(deployer, pool.address);
        Assert.equal(initRes.error, undefined, `initPool failed: ${initRes.error?.message}`);

        // Record snapshot at block 100
        await reserve.updateTwapSnapshot(deployer);

        // Advance 6 blocks
        Blockchain.blockNumber = 106n;

        // Set new cumulative
        const deltaPerBlock = 100_000_00000000n;
        await pool.setPrice0Cumulative(deployer, deltaPerBlock * 6n);

        // getTwap() at block 106 — window has filled (106 - 100 = 6 >= 6)
        // This should auto-transition PREMINT → LIVE
        const twap = await reserve.getTwap(deployer);
        Assert.notEqual(twap, 0n, 'Expected non-zero TWAP after window fills');

        // Check phase is now LIVE
        const phaseAfter = await reserve.getPhase();
        Assert.equal(phaseAfter, PHASE_LIVE, 'Expected LIVE phase after TWAP window fills');
    });

    // ── Test 6: initPool reverts for non-owner ────────────────────────────────

    await vm.it('initPool reverts for non-owner caller', async () => {
        const attacker = Blockchain.generateRandomAddress();
        await pool.setToken0(deployer, reserve.wbtcAddr);

        const res = await reserve.initPool(attacker, pool.address);
        Assert.notEqual(res.status, 0, 'Expected initPool to revert for non-owner');
    });
});
