import { opnet, OPNetUnit, Assert, Blockchain, ContractRuntime } from '@btc-vision/unit-test-framework';
import { BinaryWriter, BinaryReader } from '@btc-vision/transaction';
import { BytecodeManager } from '@btc-vision/unit-test-framework';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WASM_PATH = path.resolve(__dirname, '../build/ODReserve.wasm');

/**
 * Selectors
 */
const TRANSFER_OWNERSHIP_SELECTOR = 0xf1dcac99;
const ADVANCE_PHASE_SELECTOR = 0xd1ee3cb1;
const GET_PHASE_SELECTOR = 0x8605fcee;

/**
 * ODReserveContract — thin wrapper for ownership tests.
 */
class ODReserveContract extends ContractRuntime {
    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
        odAddr: import('@btc-vision/transaction').Address,
        orcAddr: import('@btc-vision/transaction').Address,
        wbtcAddr: import('@btc-vision/transaction').Address,
        factoryAddr: import('@btc-vision/transaction').Address,
    ) {
        const deploymentCalldata = new BinaryWriter();
        deploymentCalldata.writeAddress(odAddr);
        deploymentCalldata.writeAddress(orcAddr);
        deploymentCalldata.writeAddress(wbtcAddr);
        deploymentCalldata.writeAddress(factoryAddr);

        super({
            address,
            deployer,
            deploymentCalldata: deploymentCalldata.getBuffer(),
        });
    }

    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode(WASM_PATH, this.address);
    }

    async transferOwnership(
        caller: import('@btc-vision/transaction').Address,
        newOwner: import('@btc-vision/transaction').Address,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(TRANSFER_OWNERSHIP_SELECTOR);
        calldata.writeAddress(newOwner);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async advancePhase(
        caller: import('@btc-vision/transaction').Address,
        seedPrice: bigint,
    ) {
        const calldata = new BinaryWriter();
        calldata.writeSelector(ADVANCE_PHASE_SELECTOR);
        calldata.writeU256(seedPrice);
        return this.execute({
            calldata: calldata.getBuffer(),
            sender: caller,
            txOrigin: caller,
        });
    }

    async getPhase(): Promise<number> {
        const calldata = new BinaryWriter();
        calldata.writeSelector(GET_PHASE_SELECTOR);
        const result = await this.executeThrowOnError({
            calldata: calldata.getBuffer(),
            saveStates: false,
        });
        const reader = new BinaryReader(result.response);
        return reader.readU8();
    }
}

function createReserve(deployer: import('@btc-vision/transaction').Address) {
    const contractAddress = Blockchain.generateRandomAddress();
    const odAddr = Blockchain.generateRandomAddress();
    const orcAddr = Blockchain.generateRandomAddress();
    const wbtcAddr = Blockchain.generateRandomAddress();
    const factoryAddr = Blockchain.generateRandomAddress();

    const reserve = new ODReserveContract(
        contractAddress, deployer, odAddr, orcAddr, wbtcAddr, factoryAddr,
    );
    Blockchain.register(reserve);
    return reserve;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

await opnet('ODReserve Ownership', async (vm: OPNetUnit) => {
    let reserve: ODReserveContract;
    let deployer: import('@btc-vision/transaction').Address;
    let attacker: import('@btc-vision/transaction').Address;

    vm.beforeEach(async () => {
        Blockchain.clearContracts();
        await Blockchain.init();

        deployer = Blockchain.generateRandomAddress();
        attacker = Blockchain.generateRandomAddress();

        reserve = createReserve(deployer);
        await reserve.init();
    });

    vm.afterEach(() => {
        reserve.dispose();
        Blockchain.clearContracts();
    });

    await vm.it('owner can transfer ownership', async () => {
        const newOwner = Blockchain.generateRandomAddress();
        const res = await reserve.transferOwnership(deployer, newOwner);
        Assert.equal(res.error, undefined, `transferOwnership failed: ${res.error?.message}`);
    });

    await vm.it('non-owner cannot transfer ownership', async () => {
        const newOwner = Blockchain.generateRandomAddress();
        const res = await reserve.transferOwnership(attacker, newOwner);
        Assert.notEqual(res.status, 0, 'Expected revert for non-owner');
    });

    await vm.it('after transfer, old owner loses access to advancePhase', async () => {
        const newOwner = Blockchain.generateRandomAddress();

        // Transfer ownership
        const res = await reserve.transferOwnership(deployer, newOwner);
        Assert.equal(res.error, undefined, `transferOwnership failed: ${res.error?.message}`);

        // Old owner tries advancePhase — should fail
        const seedPrice = 10_000_000_000_000n;
        const res2 = await reserve.advancePhase(deployer, seedPrice);
        Assert.notEqual(res2.status, 0, 'Expected revert for old owner calling advancePhase');

        // Phase should still be SEEDING
        const phase = await reserve.getPhase();
        Assert.equal(phase, 0, 'Phase should remain SEEDING');
    });

    await vm.it('new owner can call advancePhase after transfer', async () => {
        const newOwner = Blockchain.generateRandomAddress();

        // Transfer ownership
        const res = await reserve.transferOwnership(deployer, newOwner);
        Assert.equal(res.error, undefined, `transferOwnership failed: ${res.error?.message}`);

        // New owner calls advancePhase
        const seedPrice = 10_000_000_000_000n;
        const res2 = await reserve.advancePhase(newOwner, seedPrice);
        Assert.equal(res2.error, undefined, `advancePhase by new owner failed: ${res2.error?.message}`);

        const phase = await reserve.getPhase();
        Assert.equal(phase, 1, 'Phase should be PREMINT after advance by new owner');
    });

    await vm.it('transferOwnership is repeatable (A→B→C)', async () => {
        const ownerB = Blockchain.generateRandomAddress();
        const ownerC = Blockchain.generateRandomAddress();

        const res1 = await reserve.transferOwnership(deployer, ownerB);
        Assert.equal(res1.error, undefined, `Transfer A→B failed: ${res1.error?.message}`);

        const res2 = await reserve.transferOwnership(ownerB, ownerC);
        Assert.equal(res2.error, undefined, `Transfer B→C failed: ${res2.error?.message}`);

        // Verify C is now owner (can call advancePhase)
        const seedPrice = 10_000_000_000_000n;
        const res3 = await reserve.advancePhase(ownerC, seedPrice);
        Assert.equal(res3.error, undefined, `advancePhase by C failed: ${res3.error?.message}`);
    });

    await vm.it('after transfer, old owner cannot transfer again', async () => {
        const newOwner = Blockchain.generateRandomAddress();

        const res = await reserve.transferOwnership(deployer, newOwner);
        Assert.equal(res.error, undefined, `transferOwnership failed: ${res.error?.message}`);

        const res2 = await reserve.transferOwnership(deployer, attacker);
        Assert.notEqual(res2.status, 0, 'Expected revert for old owner');
    });
});
