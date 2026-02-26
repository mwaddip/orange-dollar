import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Calldata,
    OP20,
    OP20InitParameters,
} from '@btc-vision/btc-runtime/runtime';

/**
 * OD — Orange Dollar stablecoin token (OP-20 compliant).
 *
 * Stub: full implementation in Task 2.
 */
@final
export class OD extends OP20 {
    public constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        const maxSupply: u256 = u256.fromString('1000000000000000000000000000000');
        const decimals: u8 = 18;
        const name: string = 'Orange Dollar';
        const symbol: string = 'OD';

        this.instantiate(new OP20InitParameters(maxSupply, decimals, name, symbol));
    }

    public override onUpdate(_calldata: Calldata): void {
        super.onUpdate(_calldata);
    }
}
