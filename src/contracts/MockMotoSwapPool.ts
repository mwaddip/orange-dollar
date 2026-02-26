import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    OP_NET,
    StoredAddress,
    StoredU256,
} from '@btc-vision/btc-runtime/runtime';

// ─── Storage pointer allocation (module-level — MUST be before class) ─────────

const POINTER_PRICE0_CUMULATIVE: u16 = Blockchain.nextPointer;
const POINTER_PRICE1_CUMULATIVE: u16 = Blockchain.nextPointer;
const POINTER_RESERVE0: u16 = Blockchain.nextPointer;
const POINTER_RESERVE1: u16 = Blockchain.nextPointer;
const POINTER_TOKEN0: u16 = Blockchain.nextPointer;

// ─── Contract ────────────────────────────────────────────────────────────────

/**
 * MockMotoSwapPool — Controllable mock of a MotoSwap pool contract.
 *
 * Exposes the same 4-byte selectors as the real MotoSwap pool for
 * price0CumulativeLast(), price1CumulativeLast(), getReserves(), and token0().
 *
 * Tests call the setter methods to control the values returned by the pool
 * interface methods before exercising ODReserve logic.
 */
@final
export class MockMotoSwapPool extends OP_NET {
    // ── Storage slots ──────────────────────────────────────────────────────

    /** Controlled cumulative price for token0 */
    private readonly _price0Cumulative: StoredU256;
    /** Controlled cumulative price for token1 */
    private readonly _price1Cumulative: StoredU256;
    /** Reserve of token0 */
    private readonly _reserve0: StoredU256;
    /** Reserve of token1 */
    private readonly _reserve1: StoredU256;
    /** Address reported as token0 */
    private readonly _token0: StoredAddress;

    public constructor() {
        super();

        this._price0Cumulative = new StoredU256(POINTER_PRICE0_CUMULATIVE, EMPTY_POINTER);
        this._price1Cumulative = new StoredU256(POINTER_PRICE1_CUMULATIVE, EMPTY_POINTER);
        this._reserve0 = new StoredU256(POINTER_RESERVE0, EMPTY_POINTER);
        this._reserve1 = new StoredU256(POINTER_RESERVE1, EMPTY_POINTER);
        this._token0 = new StoredAddress(POINTER_TOKEN0);
    }

    public override onDeployment(_calldata: Calldata): void {
        // No initialization needed — defaults are zero.
    }

    public override onUpdate(_calldata: Calldata): void {
        // Reserved for future upgrades.
    }

    // ── Setter methods (called by tests to control values) ─────────────────

    /**
     * Sets the cumulative price for token0.
     *
     * @param calldata - price: u256
     */
    @method({ name: 'price', type: ABIDataTypes.UINT256 })
    @returns({ name: 'ok', type: ABIDataTypes.BOOL })
    public setPrice0Cumulative(calldata: Calldata): BytesWriter {
        const price: u256 = calldata.readU256();
        this._price0Cumulative.value = price;

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Sets the cumulative price for token1.
     *
     * @param calldata - price: u256
     */
    @method({ name: 'price', type: ABIDataTypes.UINT256 })
    @returns({ name: 'ok', type: ABIDataTypes.BOOL })
    public setPrice1Cumulative(calldata: Calldata): BytesWriter {
        const price: u256 = calldata.readU256();
        this._price1Cumulative.value = price;

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Sets the reserves for both tokens.
     *
     * @param calldata - reserve0: u256, reserve1: u256
     */
    @method(
        { name: 'reserve0', type: ABIDataTypes.UINT256 },
        { name: 'reserve1', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'ok', type: ABIDataTypes.BOOL })
    public setReserves(calldata: Calldata): BytesWriter {
        const reserve0: u256 = calldata.readU256();
        const reserve1: u256 = calldata.readU256();
        this._reserve0.value = reserve0;
        this._reserve1.value = reserve1;

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Sets the token0 address.
     *
     * @param calldata - token: Address
     */
    @method({ name: 'token', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'ok', type: ABIDataTypes.BOOL })
    public setToken0(calldata: Calldata): BytesWriter {
        const token: Address = calldata.readAddress();
        this._token0.value = token;

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    // ── Pool interface methods (same selectors as real MotoSwap pool) ───────

    /**
     * Returns the cumulative price of token0 relative to token1.
     * Selector: price0CumulativeLast() → 0x2707193d
     */
    @method()
    @returns({ name: 'price0CumulativeLast', type: ABIDataTypes.UINT256 })
    public price0CumulativeLast(_: Calldata): BytesWriter {
        const response = new BytesWriter(32);
        response.writeU256(this._price0Cumulative.value);
        return response;
    }

    /**
     * Returns the cumulative price of token1 relative to token0.
     * Selector: price1CumulativeLast() → 0x0d1238ca
     */
    @method()
    @returns({ name: 'price1CumulativeLast', type: ABIDataTypes.UINT256 })
    public price1CumulativeLast(_: Calldata): BytesWriter {
        const response = new BytesWriter(32);
        response.writeU256(this._price1Cumulative.value);
        return response;
    }

    /**
     * Returns the pool reserves and a block timestamp placeholder.
     * Selector: getReserves() → 0x06374bfc
     *
     * Returns: (reserve0: u256, reserve1: u256, blockTimestampLast: u64)
     */
    @method()
    @returns(
        { name: 'reserve0', type: ABIDataTypes.UINT256 },
        { name: 'reserve1', type: ABIDataTypes.UINT256 },
        { name: 'blockTimestampLast', type: ABIDataTypes.UINT64 },
    )
    public getReserves(_: Calldata): BytesWriter {
        // 32 bytes for reserve0 + 32 bytes for reserve1 + 8 bytes for blockTimestampLast
        const response = new BytesWriter(72);
        response.writeU256(this._reserve0.value);
        response.writeU256(this._reserve1.value);
        response.writeU64(Blockchain.block.number);
        return response;
    }

    /**
     * Returns the token0 address.
     * Selector: token0() → 0x3c1f365f
     */
    @method()
    @returns({ name: 'token0', type: ABIDataTypes.ADDRESS })
    public token0(_: Calldata): BytesWriter {
        const response = new BytesWriter(32);
        response.writeAddress(this._token0.value);
        return response;
    }
}
