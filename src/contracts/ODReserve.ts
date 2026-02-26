import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    OP_NET,
    Revert,
    SafeMath,
    StoredAddress,
    StoredBoolean,
    StoredU256,
} from '@btc-vision/btc-runtime/runtime';
import {
    SEL_TOKEN0,
    SEL_PRICE0_CUMULATIVE_LAST,
    SEL_PRICE1_CUMULATIVE_LAST,
} from '../selectors';

// ─── Phase constants ──────────────────────────────────────────────────────────

/** SEEDING phase: RC minting only */
const PHASE_SEEDING: u8 = 0;
/** PREMINT phase: owner premints OD */
const PHASE_PREMINT: u8 = 1;
/** LIVE phase: all operations */
const PHASE_LIVE: u8 = 2;

// ─── Ratio / fee constants ────────────────────────────────────────────────────

/** 400% collateral ratio in 1e8 scale */
const MIN_RATIO: u256 = u256.fromU64(400_000_000);
/** 800% collateral ratio in 1e8 scale */
const MAX_RATIO: u256 = u256.fromU64(800_000_000);
/** Scale factor 1e8 */
const RATIO_SCALE: u256 = u256.fromU64(100_000_000);
/** Default fee: 1.5% in 1e8 scale */
const DEFAULT_FEE: u256 = u256.fromU64(1_500_000);
/** Fee scale: 1e8 */
const FEE_SCALE: u256 = u256.fromU64(100_000_000);
/** Maximum allowed fee: 5% in 1e8 scale */
const MAX_FEE: u256 = u256.fromU64(5_000_000);
/** Default TWAP window in blocks */
const TWAP_WINDOW_DEFAULT: u256 = u256.fromU64(6);

// ─── Storage pointer allocation (module-level — MUST be before class) ─────────

const POINTER_PHASE: u16 = Blockchain.nextPointer;
const POINTER_SEED_PRICE: u16 = Blockchain.nextPointer;
const POINTER_OD_ADDR: u16 = Blockchain.nextPointer;
const POINTER_ORC_ADDR: u16 = Blockchain.nextPointer;
const POINTER_WBTC_ADDR: u16 = Blockchain.nextPointer;
const POINTER_FACTORY_ADDR: u16 = Blockchain.nextPointer;
const POINTER_POOL_ADDR: u16 = Blockchain.nextPointer;
const POINTER_WBTC_IS_TOKEN0: u16 = Blockchain.nextPointer;
const POINTER_TWAP_SNAPSHOT: u16 = Blockchain.nextPointer;
const POINTER_TWAP_SNAPSHOT_BLOCK: u16 = Blockchain.nextPointer;
const POINTER_CURRENT_TWAP: u16 = Blockchain.nextPointer;
const POINTER_TWAP_WINDOW: u16 = Blockchain.nextPointer;
const POINTER_FEE: u16 = Blockchain.nextPointer;
const POINTER_PREMINT_DONE: u16 = Blockchain.nextPointer;
const POINTER_OWNER: u16 = Blockchain.nextPointer;

// ─── Contract ────────────────────────────────────────────────────────────────

/**
 * ODReserve — Collateral reserve contract for the Orange Dollar system.
 *
 * Manages minting/burning of OD and ORC based on BTC collateral.
 * Phase machine: SEEDING (0) → PREMINT (1) → LIVE (2).
 */
@final
export class ODReserve extends OP_NET {
    // ── Storage slots ──────────────────────────────────────────────────────

    /** Current phase (0 = SEEDING, 1 = PREMINT, 2 = LIVE) */
    private readonly _phase: StoredU256;
    /** Initial WBTC/USD price in 8-decimal units, set when advancing to PREMINT */
    private readonly _seedPrice: StoredU256;
    /** OD contract address */
    private readonly _odAddr: StoredAddress;
    /** ORC contract address */
    private readonly _orcAddr: StoredAddress;
    /** WBTC contract address */
    private readonly _wbtcAddr: StoredAddress;
    /** MotoSwap Factory address */
    private readonly _factoryAddr: StoredAddress;
    /** MotoSwap WBTC/OD pool address (set after pool creation) */
    private readonly _poolAddr: StoredAddress;
    /** Whether WBTC is token0 in the MotoSwap pool */
    private readonly _wbtcIsToken0: StoredBoolean;
    /** Cumulative price at last TWAP snapshot */
    private readonly _twapSnapshot: StoredU256;
    /** Block number at last TWAP snapshot */
    private readonly _twapSnapshotBlock: StoredU256;
    /** Last computed TWAP value */
    private readonly _currentTwap: StoredU256;
    /** TWAP window in blocks */
    private readonly _twapWindow: StoredU256;
    /** Fee rate (1.5% = 1_500_000 in 1e8 scale) */
    private readonly _fee: StoredU256;
    /** Whether premintOD has been called */
    private readonly _premintDone: StoredBoolean;
    /** Deployer / owner address */
    private readonly _owner: StoredAddress;

    public constructor() {
        super();

        this._phase = new StoredU256(POINTER_PHASE, EMPTY_POINTER);
        this._seedPrice = new StoredU256(POINTER_SEED_PRICE, EMPTY_POINTER);
        this._odAddr = new StoredAddress(POINTER_OD_ADDR);
        this._orcAddr = new StoredAddress(POINTER_ORC_ADDR);
        this._wbtcAddr = new StoredAddress(POINTER_WBTC_ADDR);
        this._factoryAddr = new StoredAddress(POINTER_FACTORY_ADDR);
        this._poolAddr = new StoredAddress(POINTER_POOL_ADDR);
        this._wbtcIsToken0 = new StoredBoolean(POINTER_WBTC_IS_TOKEN0, false);
        this._twapSnapshot = new StoredU256(POINTER_TWAP_SNAPSHOT, EMPTY_POINTER);
        this._twapSnapshotBlock = new StoredU256(POINTER_TWAP_SNAPSHOT_BLOCK, EMPTY_POINTER);
        this._currentTwap = new StoredU256(POINTER_CURRENT_TWAP, EMPTY_POINTER);
        this._twapWindow = new StoredU256(POINTER_TWAP_WINDOW, EMPTY_POINTER);
        this._fee = new StoredU256(POINTER_FEE, EMPTY_POINTER);
        this._premintDone = new StoredBoolean(POINTER_PREMINT_DONE, false);
        this._owner = new StoredAddress(POINTER_OWNER);
    }

    // ── Deployment ─────────────────────────────────────────────────────────

    /**
     * Called once when the contract is deployed.
     *
     * Reads four addresses from calldata:
     *   1. OD contract address
     *   2. ORC contract address
     *   3. WBTC contract address
     *   4. MotoSwap Factory address
     *
     * Stores the deployer as owner, sets phase to SEEDING,
     * fee to DEFAULT_FEE, and TWAP window to TWAP_WINDOW_DEFAULT.
     *
     * @param calldata - Four addresses in sequence.
     */
    public override onDeployment(calldata: Calldata): void {
        const odAddr: Address = calldata.readAddress();
        const orcAddr: Address = calldata.readAddress();
        const wbtcAddr: Address = calldata.readAddress();
        const factoryAddr: Address = calldata.readAddress();

        this._odAddr.value = odAddr;
        this._orcAddr.value = orcAddr;
        this._wbtcAddr.value = wbtcAddr;
        this._factoryAddr.value = factoryAddr;

        // Store deployer as owner (tx.sender at deployment time is the deployer)
        this._owner.value = Blockchain.tx.sender;

        // Initialise phase machine
        this._phase.value = u256.fromU64(<u64>PHASE_SEEDING);

        // Initialise fee and TWAP window
        this._fee.value = DEFAULT_FEE;
        this._twapWindow.value = TWAP_WINDOW_DEFAULT;
    }

    public override onUpdate(_calldata: Calldata): void {
        // Migration logic reserved for future upgrades.
    }

    // ── View methods ───────────────────────────────────────────────────────

    /**
     * Returns the current phase as a u8.
     * Phase 0 = SEEDING, 1 = PREMINT, 2 = LIVE.
     */
    @method()
    @returns({ name: 'phase', type: ABIDataTypes.UINT8 })
    public getPhase(_: Calldata): BytesWriter {
        const phase: u8 = <u8>this._phase.value.toU32();
        const response = new BytesWriter(1);
        response.writeU8(phase);
        return response;
    }

    // ── Phase advancement ──────────────────────────────────────────────────

    /**
     * Advances the contract from SEEDING to PREMINT phase.
     *
     * Can only be called by the owner.
     * Can only be called once (when phase = SEEDING).
     * Requires a non-zero seedPrice (WBTC/USD in 8-decimal units,
     * e.g. $100,000 = 10_000_000_000_000 = 100_000 * 1e8).
     *
     * @param calldata - seedPrice: u256
     */
    @method({ name: 'seedPrice', type: ABIDataTypes.UINT256 })
    public advancePhase(calldata: Calldata): BytesWriter {
        this._onlyOwner();

        const currentPhase: u8 = <u8>this._phase.value.toU32();
        if (currentPhase !== PHASE_SEEDING) {
            throw new Revert('ODReserve: can only advance from SEEDING phase');
        }

        const seedPrice: u256 = calldata.readU256();
        if (u256.eq(seedPrice, u256.Zero)) {
            throw new Revert('ODReserve: seedPrice must be non-zero');
        }

        this._seedPrice.value = seedPrice;
        this._phase.value = u256.fromU64(<u64>PHASE_PREMINT);

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    // ── TWAP Oracle ────────────────────────────────────────────────────────

    /**
     * Sets the MotoSwap WBTC/OD pool address and determines token ordering.
     *
     * Owner-only. Calls pool's token0() to determine whether WBTC is token0,
     * then takes the initial TWAP snapshot.
     *
     * @param calldata - poolAddress: Address
     */
    @method({ name: 'poolAddress', type: ABIDataTypes.ADDRESS })
    public initPool(calldata: Calldata): BytesWriter {
        this._onlyOwner();

        const poolAddress: Address = calldata.readAddress();
        this._poolAddr.value = poolAddress;

        // Determine token ordering: call token0() on the pool
        const w = new BytesWriter(4);
        w.writeSelector(SEL_TOKEN0);
        const result = Blockchain.call(this._poolAddr.value, w, true);
        const token0: Address = result.data.readAddress();

        // WBTC is token0 if the pool reports our WBTC address as token0
        this._wbtcIsToken0.value = token0 == this._wbtcAddr.value;

        // Take the initial snapshot
        this._takeSnapshot();

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Returns the current TWAP value (WBTC price in OD units, 8-decimal scale).
     *
     * If the pool is not set or the snapshot window has not filled, returns zero.
     */
    @method()
    @returns({ name: 'twap', type: ABIDataTypes.UINT256 })
    public getTwap(_: Calldata): BytesWriter {
        const twap: u256 = this._computeTwap();
        const response = new BytesWriter(32);
        response.writeU256(twap);
        return response;
    }

    /**
     * Returns the TWAP window size in blocks.
     */
    @method()
    @returns({ name: 'blocks', type: ABIDataTypes.UINT256 })
    public getTwapWindow(_: Calldata): BytesWriter {
        const response = new BytesWriter(32);
        response.writeU256(this._twapWindow.value);
        return response;
    }

    /**
     * Manually triggers a TWAP snapshot (for testing).
     *
     * Public and unauthenticated — only records current state, no financial impact.
     */
    @method()
    @returns({ name: 'ok', type: ABIDataTypes.BOOL })
    public updateTwapSnapshot(_: Calldata): BytesWriter {
        this._takeSnapshot();
        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    // ── Private helpers ────────────────────────────────────────────────────

    /**
     * Reverts if the immediate caller is not the stored owner.
     */
    private _onlyOwner(): void {
        if (Blockchain.tx.sender != this._owner.value) {
            throw new Revert('ODReserve: caller is not owner');
        }
    }

    /**
     * Records the current cumulative price and block number as a snapshot.
     */
    private _takeSnapshot(): void {
        const cumulative: u256 = this._readPoolCumulative();
        this._twapSnapshot.value = cumulative;
        this._twapSnapshotBlock.value = Blockchain.block.numberU256;
    }

    /**
     * Makes a cross-contract call to read the appropriate cumulative price from the pool.
     *
     * Uses price0CumulativeLast() when WBTC is token0, otherwise price1CumulativeLast().
     *
     * @returns The u256 cumulative price value from the pool.
     */
    private _readPoolCumulative(): u256 {
        const poolAddr: Address = this._poolAddr.value;
        if (poolAddr.isZero()) {
            throw new Revert('ODReserve: pool address not set');
        }

        const selector: u32 = this._wbtcIsToken0.value
            ? SEL_PRICE0_CUMULATIVE_LAST
            : SEL_PRICE1_CUMULATIVE_LAST;

        const w = new BytesWriter(4);
        w.writeSelector(selector);
        const result = Blockchain.call(poolAddr, w, true);
        return result.data.readU256();
    }

    /**
     * Computes the TWAP from the last snapshot to the current block.
     *
     * - If pool is not set, returns u256.Zero.
     * - If snapshot block is zero (no snapshot taken), takes a snapshot and returns zero.
     * - If current block equals snapshot block, returns the last computed TWAP.
     * - If deltaBlocks >= twapWindow, refreshes snapshot, updates _currentTwap, and
     *   auto-transitions from PREMINT to LIVE.
     *
     * @returns The computed TWAP value, or zero if insufficient data.
     */
    private _computeTwap(): u256 {
        // If pool address not set, return zero gracefully
        if (this._poolAddr.value.isZero()) {
            return u256.Zero;
        }

        const currentCumulative: u256 = this._readPoolCumulative();
        const snapshotBlock: u256 = this._twapSnapshotBlock.value;

        // If no snapshot yet, take one and return zero
        if (u256.eq(snapshotBlock, u256.Zero)) {
            this._takeSnapshot();
            return u256.Zero;
        }

        const currentBlock: u256 = Blockchain.block.numberU256;

        // If same block as snapshot, return last computed TWAP
        if (u256.eq(currentBlock, snapshotBlock)) {
            return this._currentTwap.value;
        }

        // Compute deltas using SafeMath
        const deltaBlocks: u256 = SafeMath.sub(currentBlock, snapshotBlock);
        const snapshotCumulative: u256 = this._twapSnapshot.value;
        const deltaCumulative: u256 = SafeMath.sub(currentCumulative, snapshotCumulative);

        // Compute TWAP = deltaCumulative / deltaBlocks
        const twap: u256 = SafeMath.div(deltaCumulative, deltaBlocks);

        // If the window has filled, update the stored TWAP and refresh snapshot
        const twapWindow: u256 = this._twapWindow.value;
        if (u256.ge(deltaBlocks, twapWindow)) {
            this._takeSnapshot();
            this._currentTwap.value = twap;

            // Auto-transition: PREMINT → LIVE when TWAP window fills
            const currentPhase: u8 = <u8>this._phase.value.toU32();
            if (currentPhase === PHASE_PREMINT) {
                this._phase.value = u256.fromU64(<u64>PHASE_LIVE);
            }
        }

        return twap;
    }
}
