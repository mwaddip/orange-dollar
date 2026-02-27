import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    AddressMemoryMap,
    Blockchain,
    BytesWriter,
    Calldata,
    OP20,
    OP20InitParameters,
    Revert,
    SafeMath,
} from '@btc-vision/btc-runtime/runtime';

const POINTER_LAST_MINT_BLOCK: u16 = 100;
const BLOCKS_PER_DAY: u256 = u256.fromU64(144);
const MAX_MINT_PER_DAY: u256 = u256.fromU64(100_000_000); // 1 WBTC (8 decimals)

/**
 * MockWBTC — OP-20 faucet token for testing.
 *
 * Anyone can call mint(), but limited to 1 WBTC per wallet per 144 blocks (~1 day).
 * Used as a mock WBTC for ODReserve integration tests.
 */
@final
export class MockWBTC extends OP20 {
    private readonly _lastMintBlock: AddressMemoryMap;

    public constructor() {
        super();
        this._lastMintBlock = new AddressMemoryMap(POINTER_LAST_MINT_BLOCK);
    }

    public override onDeployment(_calldata: Calldata): void {
        this.instantiate(
            new OP20InitParameters(
                u256.Max, // no supply cap
                8,        // decimals (WBTC uses 8)
                'Wrapped BTC',
                'WBTC',
                '',       // no icon
            ),
            true, // skip deployer verification
        );
    }

    public override onUpdate(_calldata: Calldata): void {
        super.onUpdate(_calldata);
    }

    /**
     * Mint up to 1 WBTC to `to`. Rate-limited to once per 144 blocks per caller.
     */
    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256 },
    )
    @emit('Minted')
    public mint(calldata: Calldata): BytesWriter {
        const to: Address = calldata.readAddress();
        const amount: u256 = calldata.readU256();

        if (amount > MAX_MINT_PER_DAY) {
            throw new Revert('Max 1 WBTC per mint');
        }

        const caller: Address = Blockchain.tx.sender;
        const lastBlock: u256 = this._lastMintBlock.get(caller);
        const currentBlock: u256 = Blockchain.block.numberU256;

        if (lastBlock > u256.Zero) {
            const elapsed: u256 = SafeMath.sub(currentBlock, lastBlock);
            if (elapsed < BLOCKS_PER_DAY) {
                throw new Revert('Mint: wait 144 blocks');
            }
        }

        this._lastMintBlock.set(caller, currentBlock);
        this._mint(to, amount);

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }
}
