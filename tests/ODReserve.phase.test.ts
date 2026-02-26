import { opnet, OPNetUnit, Assert, Blockchain, ContractRuntime } from '@btc-vision/unit-test-framework';
import { BinaryWriter, BinaryReader } from '@btc-vision/transaction';
import { BytecodeManager } from '@btc-vision/unit-test-framework';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to the compiled ODReserve.wasm bytecode.
 */
const WASM_PATH = path.resolve(__dirname, '../build/ODReserve.wasm');

/**
 * Selectors — confirmed from build output (SHA256-based, opnet-transform).
 *
 * getPhase()          = 0x8605fcee
 * advancePhase(uint256) = 0xd1ee3cb1
 */
const GET_PHASE_SELECTOR = 0x8605fcee;
const ADVANCE_PHASE_SELECTOR = 0xd1ee3cb1;

/**
 * Phase constants matching the contract.
 */
const PHASE_SEEDING = 0;
const PHASE_PREMINT = 1;

/**
 * ODReserveContract — thin ContractRuntime wrapper for ODReserve.
 *
 * Loads ODReserve.wasm and provides helpers for the two public methods
 * exercised in the phase-machine tests.
 *
 * Deployment calldata encodes four addresses:
 *   odAddr, orcAddr, wbtcAddr, factoryAddr
 */
class ODReserveContract extends ContractRuntime {
    public readonly odAddr: import('@btc-vision/transaction').Address;
    public readonly orcAddr: import('@btc-vision/transaction').Address;
    public readonly wbtcAddr: import('@btc-vision/transaction').Address;
    public readonly factoryAddr: import('@btc-vision/transaction').Address;

    constructor(
        address: import('@btc-vision/transaction').Address,
        deployer: import('@btc-vision/transaction').Address,
        odAddr: import('@btc-vision/transaction').Address,
        orcAddr: import('@btc-vision/transaction').Address,
        wbtcAddr: import('@btc-vision/transaction').Address,
        factoryAddr: import('@btc-vision/transaction').Address,
    ) {
        // Encode deployment calldata: [odAddr, orcAddr, wbtcAddr, factoryAddr]
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

        this.odAddr = odAddr;
        this.orcAddr = orcAddr;
        this.wbtcAddr = wbtcAddr;
        this.factoryAddr = factoryAddr;
    }

    /**
     * Load ODReserve.wasm for this contract address.
     */
    protected defineRequiredBytecodes(): void {
        BytecodeManager.loadBytecode(WASM_PATH, this.address);
    }

    /**
     * Calls getPhase() and returns the current phase as a number.
     */
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

    /**
     * Calls advancePhase(seedPrice) as the given sender.
     * Returns the raw CallResponse so callers can inspect error/status.
     */
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
}

/**
 * Helper: build a fresh ODReserve instance and register it.
 */
function createReserve(
    deployer: import('@btc-vision/transaction').Address,
) {
    const contractAddress = Blockchain.generateRandomAddress();
    const odAddr = Blockchain.generateRandomAddress();
    const orcAddr = Blockchain.generateRandomAddress();
    const wbtcAddr = Blockchain.generateRandomAddress();
    const factoryAddr = Blockchain.generateRandomAddress();

    const reserve = new ODReserveContract(
        contractAddress,
        deployer,
        odAddr,
        orcAddr,
        wbtcAddr,
        factoryAddr,
    );

    Blockchain.register(reserve);
    return reserve;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

await opnet('ODReserve Phase Machine', async (vm: OPNetUnit) => {
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

    // ── Test 1: starts in SEEDING phase ──────────────────────────────────────

    await vm.it('starts in SEEDING phase (phase = 0)', async () => {
        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_SEEDING, 'Expected initial phase to be SEEDING (0)');
    });

    // ── Test 2: owner can advance SEEDING → PREMINT ───────────────────────────

    await vm.it('owner can advance from SEEDING to PREMINT', async () => {
        // $100,000 WBTC price in 1e8 units = 100_000 * 1e8 = 10_000_000_000_000
        const seedPrice = 10_000_000_000_000n;

        const response = await reserve.advancePhase(deployer, seedPrice);
        Assert.equal(
            response.error,
            undefined,
            `advancePhase reverted unexpectedly: ${response.error?.message}`,
        );

        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_PREMINT, 'Expected phase to be PREMINT (1) after advance');
    });

    // ── Test 3: non-owner advancePhase reverts ────────────────────────────────

    await vm.it('non-owner calling advancePhase reverts', async () => {
        const seedPrice = 10_000_000_000_000n;

        const response = await reserve.advancePhase(attacker, seedPrice);
        Assert.notEqual(
            response.status,
            0,
            'Expected advancePhase to revert for non-owner caller',
        );

        // Phase should still be SEEDING
        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_SEEDING, 'Phase should remain SEEDING after failed advance');
    });

    // ── Test 4: advancePhase with zero seedPrice reverts ──────────────────────

    await vm.it('advancePhase with zero seedPrice reverts', async () => {
        const response = await reserve.advancePhase(deployer, 0n);
        Assert.notEqual(
            response.status,
            0,
            'Expected advancePhase to revert when seedPrice is zero',
        );

        // Phase should still be SEEDING
        const phase = await reserve.getPhase();
        Assert.equal(phase, PHASE_SEEDING, 'Phase should remain SEEDING after zero-price revert');
    });

    // ── Test 5: cannot advance again once in PREMINT ──────────────────────────

    await vm.it('advancePhase when already in PREMINT reverts', async () => {
        const seedPrice = 10_000_000_000_000n;

        // First advance succeeds
        const firstResponse = await reserve.advancePhase(deployer, seedPrice);
        Assert.equal(
            firstResponse.error,
            undefined,
            `First advancePhase reverted: ${firstResponse.error?.message}`,
        );

        // Confirm we are now in PREMINT
        const phaseAfterFirst = await reserve.getPhase();
        Assert.equal(phaseAfterFirst, PHASE_PREMINT, 'Phase should be PREMINT after first advance');

        // Second advance attempt from PREMINT should revert
        const secondResponse = await reserve.advancePhase(deployer, seedPrice);
        Assert.notEqual(
            secondResponse.status,
            0,
            'Expected second advancePhase to revert (cannot advance from PREMINT via advancePhase)',
        );

        // Phase should remain PREMINT
        const phaseAfterSecond = await reserve.getPhase();
        Assert.equal(
            phaseAfterSecond,
            PHASE_PREMINT,
            'Phase should remain PREMINT after failed second advance',
        );
    });
});
