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
const ownerPointer: u16 = Blockchain.nextPointer;

/**
 * ORC — Orange Reserve Coin collateral token (OP-20 compliant).
 *
 * mint() and burn() are restricted to the ODReserve contract address.
 * The reserve address is set once after deployment via setReserve(),
 * which only the contract deployer (owner) may call.
 */
@final
export class ORC extends OP20 {
    private readonly reserveAddress: StoredAddress;
    private readonly reserveSet: StoredBoolean;
    private readonly _owner: StoredAddress;

    public constructor() {
        super();

        this.reserveAddress = new StoredAddress(reserveAddressPointer);
        this.reserveSet = new StoredBoolean(reserveSetPointer, false);
        this._owner = new StoredAddress(ownerPointer);
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
                'Orange Reserve Coin',
                'ORC',
                '',       // no icon
            ),
            true, // skip deployer verification — reserve is the privileged role
        );

        // Store deployer as owner
        this._owner.value = Blockchain.tx.sender;
    }

    public override onUpdate(_calldata: Calldata): void {
        super.onUpdate(_calldata);
    }

    /**
     * Sets the ODReserve address. Can only be called once, by the deployer.
     */
    @method({ name: 'reserve', type: ABIDataTypes.ADDRESS })
    public setReserve(calldata: Calldata): BytesWriter {
        if (Blockchain.tx.sender != this._owner.value) {
            throw new Revert('ORC: caller is not owner');
        }

        if (this.reserveSet.value) {
            throw new Revert('ORC: reserve already set');
        }

        const reserve: Address = calldata.readAddress();
        this.reserveAddress.value = reserve;
        this.reserveSet.value = true;

        const response = new BytesWriter(1);
        response.writeBoolean(true);
        return response;
    }

    /**
     * Transfers ownership to a new address (e.g. PERMAFROST threshold key).
     * Can only be called by the current owner. Repeatable.
     */
    @method({ name: 'newOwner', type: ABIDataTypes.ADDRESS })
    @emit('OwnershipTransferred')
    public transferOwnership(calldata: Calldata): BytesWriter {
        if (Blockchain.tx.sender != this._owner.value) {
            throw new Revert('ORC: caller is not owner');
        }

        const previousOwner: Address = this._owner.value;
        const newOwner: Address = calldata.readAddress();
        this._owner.value = newOwner;

        const response = new BytesWriter(64);
        response.writeAddress(previousOwner);
        response.writeAddress(newOwner);
        return response;
    }

    /**
     * Mint ORC tokens to `to`.
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
     * Burn ORC tokens from `from`.
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
            throw new Revert('ORC: caller is not ODReserve');
        }
    }
}
