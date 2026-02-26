import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    OP20,
    OP20InitParameters,
    Revert,
    StoredAddress,
} from '@btc-vision/btc-runtime/runtime';

/**
 * Storage pointer for the ODReserve address.
 * Must be declared at module level using Blockchain.nextPointer.
 */
const reserveAddressPointer: u16 = Blockchain.nextPointer;

/**
 * OD — Orange Dollar stablecoin (OP-20 compliant).
 *
 * mint() and burn() are restricted to the ODReserve contract address
 * that is stored immutably at deployment time.
 */
@final
export class OD extends OP20 {
    /**
     * The ODReserve contract address — only this address may call mint/burn.
     * Stored immutably in contract storage at deployment.
     */
    private readonly reserveAddress: StoredAddress;

    public constructor() {
        super();

        this.reserveAddress = new StoredAddress(reserveAddressPointer);
    }

    /**
     * Called once when the contract is deployed.
     * Reads the ODReserve address from calldata and stores it permanently.
     * Then initialises OP-20 token parameters.
     *
     * @param calldata - First param: Address of the ODReserve contract.
     */
    public override onDeployment(calldata: Calldata): void {
        const reserve: Address = calldata.readAddress();
        this.reserveAddress.value = reserve;

        this.instantiate(
            new OP20InitParameters(
                u256.Max, // no supply cap
                8,        // decimals
                'Orange Dollar',
                'OD',
                '',       // no icon
            ),
            true, // skip deployer verification — reserve is the privileged role
        );
    }

    public override onUpdate(_calldata: Calldata): void {
        super.onUpdate(_calldata);
    }

    /**
     * Mint OD tokens to `to`.
     * Restricted to the ODReserve address.
     *
     * @param calldata - to: Address, amount: u256
     */
    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256 },
    )
    @emit('Minted')
    public mint(calldata: Calldata): BytesWriter {
        this._onlyReserve();

        const to: Address = calldata.readAddress();
        const amount: u256 = calldata.readU256();

        this._mint(to, amount);

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Burn OD tokens from `from`.
     * Restricted to the ODReserve address.
     *
     * @param calldata - from: Address, amount: u256
     */
    @method(
        { name: 'from', type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256 },
    )
    @emit('Burned')
    public override burn(calldata: Calldata): BytesWriter {
        this._onlyReserve();

        const from: Address = calldata.readAddress();
        const amount: u256 = calldata.readU256();

        this._burn(from, amount);

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Reverts if the caller (Blockchain.tx.sender) is not the stored ODReserve address.
     */
    private _onlyReserve(): void {
        if (Blockchain.tx.sender != this.reserveAddress.value) {
            throw new Revert('OD: caller is not ODReserve');
        }
    }
}
