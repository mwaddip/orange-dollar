import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    BytesWriter,
    Calldata,
    OP20,
    OP20InitParameters,
} from '@btc-vision/btc-runtime/runtime';

/**
 * MockWBTC — A simple OP-20 token with unrestricted mint for testing.
 *
 * Unlike OD/ORC, anyone can call mint() on this contract.
 * Used as a mock WBTC for ODReserve integration tests.
 */
@final
export class MockWBTC extends OP20 {
    public constructor() {
        super();
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
     * Mint WBTC tokens to `to` — unrestricted, anyone can call.
     *
     * @param calldata - to: Address, amount: u256
     */
    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256 },
    )
    @emit('Minted')
    public mint(calldata: Calldata): BytesWriter {
        const to: Address = calldata.readAddress();
        const amount: u256 = calldata.readU256();

        this._mint(to, amount);

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }
}
