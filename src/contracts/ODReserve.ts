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
    SEL_MINT,
    SEL_BURN,
    SEL_TRANSFER,
    SEL_TRANSFER_FROM,
    SEL_BALANCE_OF,
    SEL_TOTAL_SUPPLY,
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

    /**
     * Returns the current reserve ratio in 1e8 scale.
     * If no TWAP is available or no OD supply exists, returns u256.Max.
     */
    @method()
    @returns({ name: 'ratio', type: ABIDataTypes.UINT256 })
    public getReserveRatio(_: Calldata): BytesWriter {
        const twap: u256 = this._computeTwap();
        let ratio: u256;
        if (u256.eq(twap, u256.Zero)) {
            ratio = u256.Max;
        } else {
            ratio = this._computeReserveRatio(twap, u256.Zero, u256.Zero);
        }
        const response = new BytesWriter(32);
        response.writeU256(ratio);
        return response;
    }

    /**
     * Returns equity in WBTC terms.
     * equity = reserve_wbtc - od_supply * RATIO_SCALE / twap
     * If no TWAP is available, returns the full WBTC balance.
     */
    @method()
    @returns({ name: 'equity', type: ABIDataTypes.UINT256 })
    public getEquity(_: Calldata): BytesWriter {
        const twap: u256 = this._computeTwap();
        let equity: u256;
        if (u256.eq(twap, u256.Zero)) {
            equity = this._wbtcBalance();
        } else {
            equity = this._computeEquityInWbtc(twap);
        }
        const response = new BytesWriter(32);
        response.writeU256(equity);
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

    // ── OD premint ─────────────────────────────────────────────────────────

    /**
     * premintOD — Owner premints OD tokens during the PREMINT phase.
     *
     * Used once during bootstrap to seed the MotoSwap liquidity pool.
     * Can only be called once, only in PREMINT phase, only by owner.
     *
     * Validates that the reserve ratio (computed with seedPrice since TWAP
     * is not yet available) stays above MIN_RATIO (400%).
     *
     * @param calldata - odAmount: u256 (amount of OD to premint)
     */
    @method({ name: 'odAmount', type: ABIDataTypes.UINT256 })
    public premintOD(calldata: Calldata): BytesWriter {
        this._onlyOwner();

        const currentPhase: u8 = <u8>this._phase.value.toU32();
        if (currentPhase !== PHASE_PREMINT) {
            throw new Revert('ODReserve: premintOD only allowed in PREMINT phase');
        }

        if (this._premintDone.value) {
            throw new Revert('ODReserve: premintOD already called');
        }

        const odAmount: u256 = calldata.readU256();
        if (u256.eq(odAmount, u256.Zero)) {
            throw new Revert('ODReserve: odAmount must be non-zero');
        }

        // Validate ratio using seedPrice (TWAP not available yet)
        // Same pattern as _computeReserveRatio but with seedPrice instead of twap:
        // ratio = wbtcBalance * seedPrice / odAmount
        const seedPrice: u256 = this._seedPrice.value;
        const wbtcBal: u256 = this._wbtcBalance();
        const numerator: u256 = SafeMath.mul(wbtcBal, seedPrice);
        const ratio: u256 = SafeMath.div(numerator, odAmount);
        if (u256.lt(ratio, MIN_RATIO)) {
            throw new Revert('ODReserve: would breach minimum reserve ratio');
        }

        this._premintDone.value = true;

        // Mint OD to the owner
        this._odMint(this._owner.value, odAmount);

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

    // ── ORC minting / burning ────────────────────────────────────────────

    /**
     * mintORC — Deposit WBTC, receive ORC reserve-coin tokens.
     *
     * Allowed in SEEDING and LIVE phases.
     * In LIVE phase: blocked when reserve ratio is already above MAX_RATIO (800%).
     * In SEEDING phase: no ratio check (OD supply is 0, ratio undefined).
     *
     * ORC pricing:
     *   equity_in_wbtc = reserve_wbtc - od_supply / twap
     *   orc_out = wbtcIn * orc_supply / equity_in_wbtc
     *   If orc_supply == 0 (first mint): orc_out = wbtcIn * seedPrice / RATIO_SCALE
     *   Fee is deducted from ORC output.
     *
     * @param calldata - wbtcAmount: u256 (amount of WBTC to deposit)
     */
    @method({ name: 'wbtcAmount', type: ABIDataTypes.UINT256 })
    public mintORC(calldata: Calldata): BytesWriter {
        const wbtcAmount: u256 = calldata.readU256();
        if (u256.eq(wbtcAmount, u256.Zero)) {
            throw new Revert('ODReserve: wbtcAmount must be non-zero');
        }

        const currentPhase: u8 = <u8>this._phase.value.toU32();
        if (currentPhase !== PHASE_SEEDING && currentPhase !== PHASE_LIVE) {
            throw new Revert('ODReserve: mintORC not allowed in current phase');
        }

        // In LIVE phase, block if ratio is already above MAX_RATIO
        if (currentPhase === PHASE_LIVE) {
            const twap: u256 = this._computeTwap();
            if (u256.eq(twap, u256.Zero)) {
                throw new Revert('ODReserve: TWAP is zero');
            }
            this._requireRatioBelow(MAX_RATIO, wbtcAmount, u256.Zero, twap);
        }

        // Pull WBTC from sender to this contract
        this._wbtcTransferFrom(Blockchain.tx.sender, this.address, wbtcAmount);

        // Compute ORC output
        const orcOut: u256 = this._computeOrcOut(wbtcAmount);
        if (u256.eq(orcOut, u256.Zero)) {
            throw new Revert('ODReserve: orcOut is zero');
        }

        // Deduct fee from ORC output
        const feeRate: u256 = this._fee.value;
        const feeAmount: u256 = SafeMath.div(SafeMath.mul(orcOut, feeRate), FEE_SCALE);
        const orcNet: u256 = SafeMath.sub(orcOut, feeAmount);
        if (u256.eq(orcNet, u256.Zero)) {
            throw new Revert('ODReserve: orcNet is zero after fee');
        }

        // Mint ORC to sender
        this._orcMint(Blockchain.tx.sender, orcNet);

        const response = new BytesWriter(32);
        response.writeU256(orcNet);
        return response;
    }

    /**
     * burnORC — Return ORC, receive WBTC from the reserve.
     *
     * Only allowed in LIVE phase.
     * Blocked when burning would drop the reserve ratio below MIN_RATIO (400%).
     *
     * WBTC pricing:
     *   equity_in_wbtc = reserve_wbtc - od_supply / twap
     *   wbtc_out = orcIn * equity_in_wbtc / orc_supply
     *   Fee is deducted from WBTC output.
     *
     * @param calldata - orcAmount: u256 (amount of ORC to burn)
     */
    @method({ name: 'orcAmount', type: ABIDataTypes.UINT256 })
    public burnORC(calldata: Calldata): BytesWriter {
        const orcAmount: u256 = calldata.readU256();
        if (u256.eq(orcAmount, u256.Zero)) {
            throw new Revert('ODReserve: orcAmount must be non-zero');
        }

        const currentPhase: u8 = <u8>this._phase.value.toU32();
        if (currentPhase !== PHASE_LIVE) {
            throw new Revert('ODReserve: burnORC only allowed in LIVE phase');
        }

        const twap: u256 = this._computeTwap();
        if (u256.eq(twap, u256.Zero)) {
            throw new Revert('ODReserve: TWAP is zero');
        }

        // Compute WBTC output before burning ORC
        const equityInWbtc: u256 = this._computeEquityInWbtc(twap);
        const orcSupply: u256 = this._readOrcSupply();
        if (u256.eq(orcSupply, u256.Zero)) {
            throw new Revert('ODReserve: ORC supply is zero');
        }

        // wbtcOut = orcAmount * equityInWbtc / orcSupply
        const wbtcOutRaw: u256 = SafeMath.div(SafeMath.mul(orcAmount, equityInWbtc), orcSupply);
        if (u256.eq(wbtcOutRaw, u256.Zero)) {
            throw new Revert('ODReserve: wbtcOut is zero');
        }

        // Deduct fee from WBTC output
        const feeRate: u256 = this._fee.value;
        const feeAmount: u256 = SafeMath.div(SafeMath.mul(wbtcOutRaw, feeRate), FEE_SCALE);
        const wbtcNet: u256 = SafeMath.sub(wbtcOutRaw, feeAmount);
        if (u256.eq(wbtcNet, u256.Zero)) {
            throw new Revert('ODReserve: wbtcNet is zero after fee');
        }

        // Check that ratio stays above MIN_RATIO after the WBTC leaves
        this._requireRatioAbove(MIN_RATIO, u256.Zero, wbtcNet, twap);

        // Burn ORC from sender
        this._orcBurn(Blockchain.tx.sender, orcAmount);

        // Transfer WBTC to sender
        this._wbtcTransfer(Blockchain.tx.sender, wbtcNet);

        const response = new BytesWriter(32);
        response.writeU256(wbtcNet);
        return response;
    }

    // ── OD minting / burning ─────────────────────────────────────────────

    /**
     * mintOD — Deposit WBTC, receive OD stablecoin tokens.
     *
     * Only allowed in LIVE phase.
     * TWAP must be non-zero.
     * Blocked when minting would drop the reserve ratio below MIN_RATIO (400%).
     *
     * OD pricing (at TWAP rate):
     *   od_gross = wbtcIn * twap / RATIO_SCALE
     *   fee      = od_gross * fee_rate / FEE_SCALE
     *   od_out   = od_gross - fee
     *
     * @param calldata - wbtcAmount: u256 (amount of WBTC to deposit)
     */
    @method({ name: 'wbtcAmount', type: ABIDataTypes.UINT256 })
    public mintOD(calldata: Calldata): BytesWriter {
        const wbtcAmount: u256 = calldata.readU256();
        if (u256.eq(wbtcAmount, u256.Zero)) {
            throw new Revert('ODReserve: wbtcAmount must be non-zero');
        }

        const currentPhase: u8 = <u8>this._phase.value.toU32();
        if (currentPhase !== PHASE_LIVE) {
            throw new Revert('ODReserve: mintOD only allowed in LIVE phase');
        }

        const twap: u256 = this._computeTwap();
        this._requireTwap(twap);

        // Compute OD output: od_gross = wbtcIn * twap / RATIO_SCALE
        const odGross: u256 = SafeMath.div(SafeMath.mul(wbtcAmount, twap), RATIO_SCALE);
        if (u256.eq(odGross, u256.Zero)) {
            throw new Revert('ODReserve: odGross is zero');
        }

        // Deduct fee from OD output
        const feeRate: u256 = this._fee.value;
        const feeAmount: u256 = SafeMath.div(SafeMath.mul(odGross, feeRate), FEE_SCALE);
        const odOut: u256 = SafeMath.sub(odGross, feeAmount);
        if (u256.eq(odOut, u256.Zero)) {
            throw new Revert('ODReserve: odOut is zero after fee');
        }

        // Check that ratio stays above MIN_RATIO after the mint
        this._requireRatioAboveAfterMintOD(wbtcAmount, odOut, twap);

        // Pull WBTC from sender to this contract
        this._wbtcTransferFrom(Blockchain.tx.sender, this.address, wbtcAmount);

        // Mint OD to sender
        this._odMint(Blockchain.tx.sender, odOut);

        const response = new BytesWriter(32);
        response.writeU256(odOut);
        return response;
    }

    /**
     * burnOD — Return OD stablecoin, receive WBTC from the reserve.
     *
     * Only allowed in LIVE phase.
     * TWAP must be non-zero.
     * NEVER blocked by reserve ratio — this is the Djed invariant:
     * users can always redeem their OD for WBTC.
     *
     * WBTC pricing (at TWAP rate):
     *   wbtc_gross = odIn * RATIO_SCALE / twap
     *   fee        = wbtc_gross * fee_rate / FEE_SCALE
     *   wbtc_out   = wbtc_gross - fee
     *
     * @param calldata - odAmount: u256 (amount of OD to burn)
     */
    @method({ name: 'odAmount', type: ABIDataTypes.UINT256 })
    public burnOD(calldata: Calldata): BytesWriter {
        const odAmount: u256 = calldata.readU256();
        if (u256.eq(odAmount, u256.Zero)) {
            throw new Revert('ODReserve: odAmount must be non-zero');
        }

        const currentPhase: u8 = <u8>this._phase.value.toU32();
        if (currentPhase !== PHASE_LIVE) {
            throw new Revert('ODReserve: burnOD only allowed in LIVE phase');
        }

        const twap: u256 = this._computeTwap();
        this._requireTwap(twap);

        // Compute WBTC output: wbtc_gross = odIn * RATIO_SCALE / twap
        const wbtcGross: u256 = SafeMath.div(SafeMath.mul(odAmount, RATIO_SCALE), twap);
        if (u256.eq(wbtcGross, u256.Zero)) {
            throw new Revert('ODReserve: wbtcGross is zero');
        }

        // Deduct fee from WBTC output
        const feeRate: u256 = this._fee.value;
        const feeAmount: u256 = SafeMath.div(SafeMath.mul(wbtcGross, feeRate), FEE_SCALE);
        const wbtcOut: u256 = SafeMath.sub(wbtcGross, feeAmount);
        if (u256.eq(wbtcOut, u256.Zero)) {
            throw new Revert('ODReserve: wbtcOut is zero after fee');
        }

        // NO ratio check — Djed invariant: burnOD is never blocked

        // Burn OD from sender
        this._odBurn(Blockchain.tx.sender, odAmount);

        // Transfer WBTC to sender
        this._wbtcTransfer(Blockchain.tx.sender, wbtcOut);

        const response = new BytesWriter(32);
        response.writeU256(wbtcOut);
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

    // ── Cross-contract call helpers ─────────────────────────────────────

    /**
     * Calls WBTC.transferFrom(from, to, amount) to pull WBTC into the reserve.
     * Reverts on failure.
     */
    private _wbtcTransferFrom(from: Address, to: Address, amount: u256): void {
        const w = new BytesWriter(100);
        w.writeSelector(SEL_TRANSFER_FROM);
        w.writeAddress(from);
        w.writeAddress(to);
        w.writeU256(amount);
        const result = Blockchain.call(this._wbtcAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: WBTC transferFrom failed');
        }
    }

    /**
     * Calls WBTC.transfer(to, amount) to send WBTC from the reserve.
     * Reverts on failure.
     */
    private _wbtcTransfer(to: Address, amount: u256): void {
        const w = new BytesWriter(68);
        w.writeSelector(SEL_TRANSFER);
        w.writeAddress(to);
        w.writeU256(amount);
        const result = Blockchain.call(this._wbtcAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: WBTC transfer failed');
        }
    }

    /**
     * Calls ORC.mint(to, amount) to mint ORC tokens.
     * Reverts on failure.
     */
    private _orcMint(to: Address, amount: u256): void {
        const w = new BytesWriter(68);
        w.writeSelector(SEL_MINT);
        w.writeAddress(to);
        w.writeU256(amount);
        const result = Blockchain.call(this._orcAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: ORC mint failed');
        }
    }

    /**
     * Calls ORC.burn(from, amount) to burn ORC tokens.
     * Reverts on failure.
     */
    private _orcBurn(from: Address, amount: u256): void {
        const w = new BytesWriter(68);
        w.writeSelector(SEL_BURN);
        w.writeAddress(from);
        w.writeU256(amount);
        const result = Blockchain.call(this._orcAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: ORC burn failed');
        }
    }

    /**
     * Calls OD.mint(to, amount) to mint OD tokens.
     * Reverts on failure.
     */
    private _odMint(to: Address, amount: u256): void {
        const w = new BytesWriter(68);
        w.writeSelector(SEL_MINT);
        w.writeAddress(to);
        w.writeU256(amount);
        const result = Blockchain.call(this._odAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: OD mint failed');
        }
    }

    /**
     * Calls OD.burn(from, amount) to burn OD tokens.
     * Reverts on failure.
     */
    private _odBurn(from: Address, amount: u256): void {
        const w = new BytesWriter(68);
        w.writeSelector(SEL_BURN);
        w.writeAddress(from);
        w.writeU256(amount);
        const result = Blockchain.call(this._odAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: OD burn failed');
        }
    }

    /**
     * Reverts if the TWAP is zero (oracle not ready).
     */
    private _requireTwap(twap: u256): void {
        if (u256.eq(twap, u256.Zero)) {
            throw new Revert('ODReserve: TWAP not ready');
        }
    }

    /**
     * Checks that the reserve ratio stays above MIN_RATIO after minting OD.
     *
     * Both reserve WBTC and OD supply change when minting OD:
     *   new_reserve   = current_wbtc_balance + wbtcIn
     *   new_od_supply = current_od_supply + odOut
     *   ratio         = new_reserve * twap / new_od_supply
     *
     * Reverts if the post-mint ratio would be below MIN_RATIO.
     */
    private _requireRatioAboveAfterMintOD(wbtcIn: u256, odOut: u256, twap: u256): void {
        const newReserve: u256 = SafeMath.add(this._wbtcBalance(), wbtcIn);
        const newOdSupply: u256 = SafeMath.add(this._readOdSupply(), odOut);
        if (u256.eq(newOdSupply, u256.Zero)) return; // No liability = infinite ratio
        const numerator: u256 = SafeMath.mul(newReserve, twap);
        const ratio: u256 = SafeMath.div(numerator, newOdSupply);
        if (u256.lt(ratio, MIN_RATIO)) {
            throw new Revert('ODReserve: would breach minimum reserve ratio');
        }
    }

    /**
     * Reads WBTC.balanceOf(this contract) to get the reserve's WBTC balance.
     */
    private _wbtcBalance(): u256 {
        const w = new BytesWriter(36);
        w.writeSelector(SEL_BALANCE_OF);
        w.writeAddress(this.address);
        const result = Blockchain.call(this._wbtcAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: WBTC balanceOf failed');
        }
        return result.data.readU256();
    }

    /**
     * Reads OD.totalSupply() to get the current OD supply.
     */
    private _readOdSupply(): u256 {
        const w = new BytesWriter(4);
        w.writeSelector(SEL_TOTAL_SUPPLY);
        const result = Blockchain.call(this._odAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: OD totalSupply failed');
        }
        return result.data.readU256();
    }

    /**
     * Reads ORC.totalSupply() to get the current ORC supply.
     */
    private _readOrcSupply(): u256 {
        const w = new BytesWriter(4);
        w.writeSelector(SEL_TOTAL_SUPPLY);
        const result = Blockchain.call(this._orcAddr.value, w, true);
        if (!result.success) {
            throw new Revert('ODReserve: ORC totalSupply failed');
        }
        return result.data.readU256();
    }

    /**
     * Computes equity in WBTC terms:
     *   equity_in_wbtc = reserve_wbtc - od_supply * RATIO_SCALE / twap
     *
     * The TWAP is encoded as OD-per-WBTC scaled by 1e8 (RATIO_SCALE), so
     * converting OD back to WBTC requires: wbtc = od * RATIO_SCALE / twap.
     *
     * If liability > reserve, equity is zero (capped at zero).
     *
     * @param twap - Current TWAP value (WBTC price in OD, scaled by 1e8)
     * @returns equity in WBTC units
     */
    private _computeEquityInWbtc(twap: u256): u256 {
        const reserveWbtc: u256 = this._wbtcBalance();
        const odSupply: u256 = this._readOdSupply();

        if (u256.eq(twap, u256.Zero)) {
            return reserveWbtc;
        }
        // liability_in_wbtc = od_supply * RATIO_SCALE / twap
        const liabilityInWbtc: u256 = SafeMath.div(SafeMath.mul(odSupply, RATIO_SCALE), twap);

        if (u256.gt(liabilityInWbtc, reserveWbtc)) {
            return u256.Zero;
        }
        return SafeMath.sub(reserveWbtc, liabilityInWbtc);
    }

    /**
     * Computes the ORC amount for a given WBTC deposit.
     *
     * If ORC supply is zero (first mint): orc_out = wbtcIn * seedPrice / RATIO_SCALE
     * Otherwise: orc_out = wbtcIn * orc_supply / equity_in_wbtc
     *
     * @param wbtcIn - Amount of WBTC being deposited
     * @returns Amount of ORC to mint (before fee deduction)
     */
    private _computeOrcOut(wbtcIn: u256): u256 {
        const orcSupply: u256 = this._readOrcSupply();

        // First mint: use seed price
        if (u256.eq(orcSupply, u256.Zero)) {
            const seedPrice: u256 = this._seedPrice.value;
            if (u256.eq(seedPrice, u256.Zero)) {
                // In SEEDING phase, seedPrice is not yet set.
                // Use a 1:1 ratio: 1 WBTC = 1 ORC
                return wbtcIn;
            }
            // orc_out = wbtcIn * seedPrice / RATIO_SCALE
            return SafeMath.div(SafeMath.mul(wbtcIn, seedPrice), RATIO_SCALE);
        }

        // Normal case: orc_out = wbtcIn * orcSupply / equityInWbtc
        const currentPhase: u8 = <u8>this._phase.value.toU32();
        let equityInWbtc: u256;

        if (currentPhase === PHASE_SEEDING) {
            // In SEEDING phase, there is no TWAP and no OD supply,
            // so equity = reserve_wbtc
            equityInWbtc = this._wbtcBalance();
        } else {
            const twap: u256 = this._computeTwap();
            equityInWbtc = this._computeEquityInWbtc(twap);
        }

        if (u256.eq(equityInWbtc, u256.Zero)) {
            throw new Revert('ODReserve: equity in WBTC is zero');
        }

        return SafeMath.div(SafeMath.mul(wbtcIn, orcSupply), equityInWbtc);
    }

    /**
     * Computes the reserve ratio: reserve_wbtc * twap / od_supply.
     * Scaled to 1e8 (e.g. 400% = 400_000_000).
     *
     * The TWAP is encoded as "OD-per-WBTC in 8-decimal scale", i.e. TWAP = price * 1e8.
     * Converting WBTC to OD: od_value = wbtc_sats * TWAP / RATIO_SCALE.
     * Ratio = od_value / od_supply * RATIO_SCALE = wbtc_sats * TWAP / od_supply.
     *
     * @param twap - Current TWAP value
     * @param extraWbtcIn - Additional WBTC being added (for post-action ratio)
     * @param extraWbtcOut - WBTC being removed (for post-action ratio)
     * @returns Reserve ratio in 1e8 scale
     */
    private _computeReserveRatio(twap: u256, extraWbtcIn: u256, extraWbtcOut: u256): u256 {
        const odSupply: u256 = this._readOdSupply();
        if (u256.eq(odSupply, u256.Zero)) {
            // No OD minted: ratio is effectively infinite
            return u256.Max;
        }

        let reserveWbtc: u256 = this._wbtcBalance();
        // Adjust for pending in/out
        reserveWbtc = SafeMath.add(reserveWbtc, extraWbtcIn);
        if (u256.gt(extraWbtcOut, reserveWbtc)) {
            return u256.Zero;
        }
        reserveWbtc = SafeMath.sub(reserveWbtc, extraWbtcOut);

        // ratio = reserveWbtc * twap / odSupply
        const numerator: u256 = SafeMath.mul(reserveWbtc, twap);
        return SafeMath.div(numerator, odSupply);
    }

    /**
     * Reverts if the (post-action) reserve ratio is above maxRatio.
     * Used by mintORC to block when reserve is already over-collateralised.
     */
    private _requireRatioBelow(maxRatio: u256, extraWbtcIn: u256, extraWbtcOut: u256, twap: u256): void {
        const ratio: u256 = this._computeReserveRatio(twap, extraWbtcIn, extraWbtcOut);
        if (u256.gt(ratio, maxRatio)) {
            throw new Revert('ODReserve: reserve ratio above maximum');
        }
    }

    /**
     * Reverts if the (post-action) reserve ratio is below minRatio.
     * Used by burnORC to block when burning would under-collateralise the reserve.
     */
    private _requireRatioAbove(minRatio: u256, extraWbtcIn: u256, extraWbtcOut: u256, twap: u256): void {
        const ratio: u256 = this._computeReserveRatio(twap, extraWbtcIn, extraWbtcOut);
        if (u256.lt(ratio, minRatio)) {
            throw new Revert('ODReserve: reserve ratio below minimum');
        }
    }
}
