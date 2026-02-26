import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Calldata,
    OP20,
    OP20InitParameters,
} from '@btc-vision/btc-runtime/runtime';

/**
 * ORC — Orange Reserve Coin collateral token (OP-20 compliant).
 *
 * Stub: full implementation in Task 3.
 */
@final
export class ORC extends OP20 {
    public constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        const maxSupply: u256 = u256.fromString('1000000000000000000000000000000');
        const decimals: u8 = 18;
        const name: string = 'Orange Reserve Coin';
        const symbol: string = 'ORC';

        this.instantiate(new OP20InitParameters(maxSupply, decimals, name, symbol));
    }

    public override onUpdate(_calldata: Calldata): void {
        super.onUpdate(_calldata);
    }
}
