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
    StoredBoolean,
} from '@btc-vision/btc-runtime/runtime';

/**
 * Storage pointers — declared at module level using Blockchain.nextPointer.
 */
const reserveAddressPointer: u16 = Blockchain.nextPointer;
const reserveSetPointer: u16 = Blockchain.nextPointer;

/**
 * OD — Orange Dollar stablecoin (OP-20 compliant).
 *
 * mint() and burn() are restricted to the ODReserve contract address.
 * The reserve address is set once after deployment via setReserve(),
 * which only the contract deployer (owner) may call.
 */
@final
export class OD extends OP20 {
    private readonly reserveAddress: StoredAddress;
    private readonly reserveSet: StoredBoolean;

    public constructor() {
        super();

        this.reserveAddress = new StoredAddress(reserveAddressPointer);
        this.reserveSet = new StoredBoolean(reserveSetPointer, false);
    }

    /**
     * Called once when the contract is deployed.
     * Initialises OP-20 token parameters. The reserve address is NOT set
     * here — call setReserve() after deployment to complete setup.
     */
    public override onDeployment(_calldata: Calldata): void {
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
     * Sets the ODReserve address. Can only be called once, by the deployer.
     * This breaks the circular deployment dependency: deploy OD, deploy ORC,
     * deploy ODReserve, then call setReserve on OD and ORC.
     */
    @method({ name: 'reserve', type: ABIDataTypes.ADDRESS })
    public setReserve(calldata: Calldata): BytesWriter {
        if (Blockchain.tx.sender != Blockchain.contractDeployer) {
            throw new Revert('OD: caller is not owner');
        }

        if (this.reserveSet.value) {
            throw new Revert('OD: reserve already set');
        }

        const reserve: Address = calldata.readAddress();
        this.reserveAddress.value = reserve;
        this.reserveSet.value = true;

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
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
