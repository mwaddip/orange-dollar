# Orange Dollar (OD) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Orange Dollar (OD) Minimal Djed stablecoin on OPNet — three contracts (OD, ORC, ODReserve) with WBTC reserve and MotoSwap TWAP price feed.

**Architecture:** ODReserve holds WBTC (OP-20), reads a 6-block TWAP from a MotoSwap WBTC/OD pool, and mints/burns OD and ORC tokens according to the Minimal Djed spec. Bootstrap progresses through three phases: SEEDING (investor RC minting) → PREMINT (owner mints initial OD for pool seeding) → LIVE (full public operation).

**Tech Stack:** AssemblyScript + `@btc-vision/btc-runtime`, `@btc-vision/unit-test-framework`, TypeScript deployment scripts using `opnet` SDK.

---

## Before You Write Any Code

1. **Run the `be_bob` prompt** from the opnet-bob MCP server — it contains mandatory OPNet development rules.
2. **Read `typescript-law-2026`** — all code must comply, no exceptions.
3. **Critical incident awareness:**
   - Selectors in OPNet are SHA256 first 4 bytes, NOT Keccak256 — always use `encodeSelector()` or read from build output. Never hardcode EVM-style selectors.
   - `StoredU256` with small u256 indices collide — use distinct pointer numbers for fixed arrays.
   - ALL u256 arithmetic must use `SafeMath` — no raw `+`, `-`, `*`, `/`.

---

## Environment

All addresses and mnemonics live in `/home/mwaddip/projects/sharedenv/opnet-regtest.env`. Source it before running scripts:

```bash
source ~/projects/sharedenv/opnet-regtest.env
```

| Variable | Value |
|----------|-------|
| `OPNET_MOTOSWAP_ROUTER` | `0x80f8375d061d638a0b45a4eb4decbfd39e9abba913f464787194ce3c02d2ea5a` |
| `OPNET_MOTOSWAP_FACTORY` | `0x893f92bb75fadf5333bd588af45217f33cdd1120a1b740165184c012ea1c883d` |
| `OPNET_DEPLOYER_MNEMONIC` | (see env file) |
| `OPNET_DEPLOYER_ADDRESS` | `0x24e650213736672eb653864ca38ccd200bcaff23c97983085937beec7fea9b87` |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `asconfig.json`
- Create: `src/contracts/OD.ts` (stub)
- Create: `src/contracts/ORC.ts` (stub)
- Create: `src/contracts/ODReserve.ts` (stub)
- Create: `tests/` directory

**Step 1: Initialise project**

```bash
cd ~/projects/od
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install --save-dev \
  assemblyscript \
  @btc-vision/btc-runtime \
  @btc-vision/unit-test-framework \
  typescript \
  ts-node \
  @types/node

npm install \
  opnet \
  @btc-vision/bitcoin \
  @btc-vision/ecpair \
  @noble/curves
```

> Check the opnet-bob MCP `opnet_dev` tool (doc: `references/setup-guidelines.md`) for exact pinned versions before installing. Package versions matter on OPNet.

**Step 3: Create `tsconfig.json`**

```json
{
  "extends": "./node_modules/@btc-vision/btc-runtime/tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "strict": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["node_modules", "build"]
}
```

**Step 4: Create `asconfig.json`**

```json
{
  "options": {
    "runtime": "stub",
    "exportRuntime": true
  },
  "targets": {
    "od": {
      "entry": "src/contracts/OD.ts",
      "outFile": "build/OD.wasm",
      "sourceMap": true,
      "optimize": true
    },
    "orc": {
      "entry": "src/contracts/ORC.ts",
      "outFile": "build/ORC.wasm",
      "sourceMap": true,
      "optimize": true
    },
    "odReserve": {
      "entry": "src/contracts/ODReserve.ts",
      "outFile": "build/ODReserve.wasm",
      "sourceMap": true,
      "optimize": true
    }
  }
}
```

> Verify this structure against an existing OPNet contract project (e.g. `github.com/btc-vision/OP_20`). The asconfig format may differ slightly.

**Step 5: Add build scripts to `package.json`**

```json
{
  "scripts": {
    "build:od": "npx opnet-transform --target od",
    "build:orc": "npx opnet-transform --target orc",
    "build:reserve": "npx opnet-transform --target odReserve",
    "build": "npm run build:od && npm run build:orc && npm run build:reserve",
    "test": "npx ts-node --esm tests/run.ts"
  }
}
```

**Step 6: Create stub contracts (so build passes)**

`src/contracts/OD.ts`:
```typescript
import { DeployableOP_20, Calldata, BytesWriter } from '@btc-vision/btc-runtime/runtime';

@final
export class OD extends DeployableOP_20 {
    constructor() {
        super();
    }
}
```

**Step 7: Verify build compiles**

```bash
npm run build:od
```

Expected: `build/OD.wasm` created with no errors.

**Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: initialise OD project scaffold"
```

---

## Task 2: OD Token Contract

**Files:**
- Modify: `src/contracts/OD.ts`
- Create: `tests/OD.test.ts`

OD is a standard OP-20 where `mint` and `burn` are callable only by the ODReserve address (stored at deployment).

**Step 1: Write the failing test**

`tests/OD.test.ts`:
```typescript
import { opnet, OPNetUnit } from '@btc-vision/unit-test-framework';
import { Assert, Blockchain } from '@btc-vision/unit-test-framework';

// Import your compiled contract wrapper (generated by opnet-transform)
import { OD } from '../build/OD.js';

await opnet('OD Token', async (vm: OPNetUnit) => {
    const deployer = Blockchain.generateRandomAddress();
    const reserve  = Blockchain.generateRandomAddress();
    const user     = Blockchain.generateRandomAddress();
    let od: OD;

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        od = new OD(deployer, Blockchain.generateRandomAddress());
        Blockchain.register(od);
        await od.init();

        Blockchain.msgSender = deployer;
        Blockchain.txOrigin  = deployer;

        // Set ODReserve address at deployment
        await od.onDeployment(reserve);
    });

    vm.afterEach(() => { od.dispose(); Blockchain.dispose(); });

    await vm.it('has correct name and symbol', async () => {
        const name   = await od.name();
        const symbol = await od.symbol();
        Assert.expect(name.properties.name).toEqual('Orange Dollar');
        Assert.expect(symbol.properties.symbol).toEqual('OD');
    });

    await vm.it('reserve can mint', async () => {
        Blockchain.msgSender = reserve;
        await od.mint(user, 1_00000000n); // 1 OD
        const bal = await od.balanceOf(user);
        Assert.expect(bal.properties.balance).toEqual(1_00000000n);
    });

    await vm.it('non-reserve cannot mint', async () => {
        Blockchain.msgSender = user;
        await Assert.expectThrow(() => od.mint(user, 1_00000000n));
    });

    await vm.it('reserve can burn', async () => {
        Blockchain.msgSender = reserve;
        await od.mint(user, 1_00000000n);
        await od.burn(user, 1_00000000n);
        const bal = await od.balanceOf(user);
        Assert.expect(bal.properties.balance).toEqual(0n);
    });

    await vm.it('non-reserve cannot burn', async () => {
        Blockchain.msgSender = reserve;
        await od.mint(user, 1_00000000n);
        Blockchain.msgSender = user;
        await Assert.expectThrow(() => od.burn(user, 1_00000000n));
    });
});
```

**Step 2: Run test, confirm it fails**

```bash
npm test
```

Expected: compile error or test failures — OD.ts is still a stub.

**Step 3: Implement `src/contracts/OD.ts`**

```typescript
import {
    DeployableOP_20,
    Calldata,
    BytesWriter,
    Address,
    Blockchain,
    Revert,
    StoredAddress,
    ABIDataTypes,
} from '@btc-vision/btc-runtime/runtime';

@final
export class OD extends DeployableOP_20 {
    // Storage pointer for the authorised ODReserve address
    private readonly _reservePtr: u16 = Blockchain.nextPointer;
    private _reserve: StoredAddress = new StoredAddress(this._reservePtr);

    constructor() {
        super();
    }

    /** Runs once at first deployment to record the ODReserve address. */
    public override onDeployment(calldata: Calldata): void {
        const reserve = calldata.readAddress();
        this._reserve.value = reserve;
    }

    /** Configures token metadata (called on every instantiation). */
    public override onInstantiated(): void {
        if (!this.isDeployed) return; // skip if not yet deployed
        this.maxSupply = u256.Max;
        this.decimals  = 8;
        this.name      = 'Orange Dollar';
        this.symbol    = 'OD';
    }

    /**
     * Mints OD tokens to `to`. Only ODReserve may call this.
     * @param calldata - { to: Address, amount: u256 }
     */
    @method(
        { name: 'to',     type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256  },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public mint(calldata: Calldata): BytesWriter {
        this._onlyReserve();
        const to     = calldata.readAddress();
        const amount = calldata.readU256();
        this._mint(to, amount);
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    /**
     * Burns OD tokens from `from`. Only ODReserve may call this.
     * @param calldata - { from: Address, amount: u256 }
     */
    @method(
        { name: 'from',   type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256  },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public burn(calldata: Calldata): BytesWriter {
        this._onlyReserve();
        const from   = calldata.readAddress();
        const amount = calldata.readU256();
        this._burn(from, amount);
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    private _onlyReserve(): void {
        if (!Blockchain.msgSender.equals(this._reserve.value)) {
            throw new Revert('OD: caller is not ODReserve');
        }
    }
}
```

> Verify the exact API for `DeployableOP_20`, `StoredAddress`, `_mint`, `_burn` against `@btc-vision/btc-runtime` source before finalising. The patterns above follow OPNet conventions but exact method signatures may differ.

**Step 4: Build OD and note selectors**

```bash
npm run build:od
```

From the build output, record the SHA256-based selectors for `mint` and `burn`. These are needed in Task 4 when ODReserve makes cross-contract calls to OD. Example output:
```
mint(address,uint256)  -> selector: 0xXXXXXXXX
burn(address,uint256)  -> selector: 0xXXXXXXXX
```

Store these in `src/selectors.ts` (created in Task 4).

**Step 5: Run tests — all pass**

```bash
npm test
```

Expected: all 5 OD tests pass.

**Step 6: Commit**

```bash
git add src/contracts/OD.ts tests/OD.test.ts
git commit -m "feat: add OD OP-20 token with ODReserve-only mint/burn"
```

---

## Task 3: ORC Token Contract

**Files:**
- Modify: `src/contracts/ORC.ts`
- Create: `tests/ORC.test.ts`

ORC is structurally identical to OD — same access control pattern, different name/symbol.

**Step 1: Write failing test**

`tests/ORC.test.ts` — copy `OD.test.ts`, replace `OD` with `ORC`, `'Orange Dollar'` with `'Orange Reserve Coin'`, `'OD'` with `'ORC'`.

**Step 2: Run test, confirm fail**

```bash
npm test
```

**Step 3: Implement `src/contracts/ORC.ts`**

Copy `OD.ts`. Change:
- Class name: `ORC`
- `name`: `'Orange Reserve Coin'`
- `symbol`: `'ORC'`
- Error message: `'ORC: caller is not ODReserve'`

**Step 4: Build ORC, note selectors**

```bash
npm run build:orc
```

Record `mint` and `burn` selectors for ORC from build output.

**Step 5: Run tests — pass**

```bash
npm test
```

**Step 6: Commit**

```bash
git add src/contracts/ORC.ts tests/ORC.test.ts
git commit -m "feat: add ORC OP-20 token with ODReserve-only mint/burn"
```

---

## Task 4: ODReserve — Storage, Constants, and Phase Machine

**Files:**
- Create: `src/selectors.ts`
- Modify: `src/contracts/ODReserve.ts`
- Create: `tests/ODReserve.phase.test.ts`

This task builds the storage layout, constants, and the SEEDING → PREMINT → LIVE phase machine. No financial logic yet.

**Step 1: Create `src/selectors.ts`**

```typescript
// OPNet uses SHA256 first 4 bytes — NOT Keccak256.
// Get these values from the build output of each contract.
// NEVER hardcode EVM/Keccak256 selectors here.

// OD selectors (from build/OD.wasm build output)
export const OD_MINT_SELECTOR: u32 = 0xXXXXXXXX; // replace with actual
export const OD_BURN_SELECTOR: u32 = 0xXXXXXXXX;

// ORC selectors (from build/ORC.wasm build output)
export const ORC_MINT_SELECTOR: u32 = 0xXXXXXXXX;
export const ORC_BURN_SELECTOR: u32 = 0xXXXXXXXX;

// WBTC OP-20 selectors — these come from the official WBTC contract build output.
// Also obtain from the WBTC custodian's published ABI.
export const WBTC_TRANSFER_SELECTOR: u32      = 0xXXXXXXXX; // transfer(address,uint256)
export const WBTC_TRANSFER_FROM_SELECTOR: u32 = 0xXXXXXXXX; // transferFrom(address,address,uint256)

// MotoSwap pool selectors — obtain from MotoSwap build output or published ABI
export const POOL_TOKEN0_SELECTOR: u32              = 0xXXXXXXXX; // token0()
export const POOL_PRICE0_CUMULATIVE_SELECTOR: u32   = 0xXXXXXXXX; // price0CumulativeLast()
export const POOL_PRICE1_CUMULATIVE_SELECTOR: u32   = 0xXXXXXXXX; // price1CumulativeLast()
export const POOL_GET_RESERVES_SELECTOR: u32        = 0xXXXXXXXX; // getReserves()

// MotoSwap factory selector
export const FACTORY_GET_POOL_SELECTOR: u32 = 0xXXXXXXXX; // getPool(address,address)
```

> Query the opnet-bob MCP (`opnet_knowledge_search` with "MotoSwap selectors SHA256") for the correct MotoSwap pool selectors if not available from build output.

**Step 2: Write failing phase-machine tests**

`tests/ODReserve.phase.test.ts`:
```typescript
import { opnet, OPNetUnit, Assert, Blockchain } from '@btc-vision/unit-test-framework';
import { ODReserve } from '../build/ODReserve.js';

const PHASE_SEEDING = 0n;
const PHASE_PREMINT = 1n;
const PHASE_LIVE    = 2n;

await opnet('ODReserve Phase Machine', async (vm: OPNetUnit) => {
    const deployer = Blockchain.generateRandomAddress();
    const odAddr   = Blockchain.generateRandomAddress();
    const orcAddr  = Blockchain.generateRandomAddress();
    const wbtcAddr = Blockchain.generateRandomAddress();
    const factory  = Blockchain.generateRandomAddress();
    let reserve: ODReserve;

    vm.beforeEach(async () => {
        Blockchain.dispose();
        Blockchain.clearContracts();
        await Blockchain.init();

        reserve = new ODReserve(deployer, Blockchain.generateRandomAddress());
        Blockchain.register(reserve);
        await reserve.init();

        Blockchain.msgSender = deployer;
        await reserve.onDeployment({ odAddress: odAddr, orcAddress: orcAddr, wbtcAddress: wbtcAddr, factory });
    });

    vm.afterEach(() => { reserve.dispose(); Blockchain.dispose(); });

    await vm.it('starts in SEEDING phase', async () => {
        const phase = await reserve.getPhase();
        Assert.expect(phase.properties.phase).toEqual(PHASE_SEEDING);
    });

    await vm.it('owner can advance from SEEDING to PREMINT', async () => {
        const seedPrice = 100_000_00000000n; // $100,000 per WBTC, 8-decimal scaled
        await reserve.advancePhase(seedPrice);
        const phase = await reserve.getPhase();
        Assert.expect(phase.properties.phase).toEqual(PHASE_PREMINT);
    });

    await vm.it('non-owner cannot advance phase', async () => {
        Blockchain.msgSender = Blockchain.generateRandomAddress();
        await Assert.expectThrow(() => reserve.advancePhase(100_000_00000000n));
    });

    await vm.it('phase cannot go backwards', async () => {
        await reserve.advancePhase(100_000_00000000n); // → PREMINT
        await Assert.expectThrow(() => reserve.advancePhase(100_000_00000000n)); // already advanced
    });
});
```

**Step 3: Run test, confirm fail**

```bash
npm test
```

**Step 4: Implement storage layout and phase machine in `src/contracts/ODReserve.ts`**

```typescript
import {
    OP_NET,
    Blockchain,
    Calldata,
    BytesWriter,
    Address,
    Revert,
    StoredU256,
    StoredAddress,
    StoredBoolean,
    SafeMath,
    ABIDataTypes,
} from '@btc-vision/btc-runtime/runtime';

// Phase constants
const PHASE_SEEDING: u8 = 0;
const PHASE_PREMINT: u8 = 1;
const PHASE_LIVE: u8    = 2;

// Reserve ratio bounds (scaled by 1e8; 400% = 4_00000000)
const MIN_RATIO: u256 = u256.fromU64(4_00000000);
const MAX_RATIO: u256 = u256.fromU64(8_00000000);
const RATIO_SCALE: u256 = u256.fromU64(100000000); // 1e8

// Fee: 1.5% = 1_500_000 / 1e8
const DEFAULT_FEE: u256 = u256.fromU64(1_500_000);
const FEE_SCALE: u256   = u256.fromU64(100_000_000); // 1e8
const MAX_FEE: u256     = u256.fromU64(5_000_000);   // 5%

@final
export class ODReserve extends OP_NET {
    // --- Storage pointers (each Blockchain.nextPointer call must be in constructor) ---
    private readonly _phasePtr:             u16 = Blockchain.nextPointer;
    private readonly _seedPricePtr:         u16 = Blockchain.nextPointer;
    private readonly _odAddrPtr:            u16 = Blockchain.nextPointer;
    private readonly _orcAddrPtr:           u16 = Blockchain.nextPointer;
    private readonly _wbtcAddrPtr:          u16 = Blockchain.nextPointer;
    private readonly _factoryAddrPtr:       u16 = Blockchain.nextPointer;
    private readonly _poolAddrPtr:          u16 = Blockchain.nextPointer;
    private readonly _wbtcIsToken0Ptr:      u16 = Blockchain.nextPointer;
    private readonly _twapSnapshotPtr:      u16 = Blockchain.nextPointer;
    private readonly _twapSnapshotBlockPtr: u16 = Blockchain.nextPointer;
    private readonly _currentTwapPtr:       u16 = Blockchain.nextPointer;
    private readonly _feePtr:              u16 = Blockchain.nextPointer;
    private readonly _premintDonePtr:       u16 = Blockchain.nextPointer;
    private readonly _ownerPtr:            u16 = Blockchain.nextPointer;

    // --- Typed storage accessors ---
    private _phase:             StoredU256;
    private _seedPrice:         StoredU256;
    private _odAddr:            StoredAddress;
    private _orcAddr:           StoredAddress;
    private _wbtcAddr:          StoredAddress;
    private _factoryAddr:       StoredAddress;
    private _poolAddr:          StoredAddress;
    private _wbtcIsToken0:      StoredBoolean;
    private _twapSnapshot:      StoredU256;
    private _twapSnapshotBlock: StoredU256;
    private _currentTwap:       StoredU256;
    private _fee:               StoredU256;
    private _premintDone:       StoredBoolean;
    private _owner:             StoredAddress;

    constructor() {
        super();
        this._phase             = new StoredU256(this._phasePtr,             u256.Zero);
        this._seedPrice         = new StoredU256(this._seedPricePtr,         u256.Zero);
        this._odAddr            = new StoredAddress(this._odAddrPtr);
        this._orcAddr           = new StoredAddress(this._orcAddrPtr);
        this._wbtcAddr          = new StoredAddress(this._wbtcAddrPtr);
        this._factoryAddr       = new StoredAddress(this._factoryAddrPtr);
        this._poolAddr          = new StoredAddress(this._poolAddrPtr);
        this._wbtcIsToken0      = new StoredBoolean(this._wbtcIsToken0Ptr,   false);
        this._twapSnapshot      = new StoredU256(this._twapSnapshotPtr,      u256.Zero);
        this._twapSnapshotBlock = new StoredU256(this._twapSnapshotBlockPtr, u256.Zero);
        this._currentTwap       = new StoredU256(this._currentTwapPtr,       u256.Zero);
        this._fee               = new StoredU256(this._feePtr,               DEFAULT_FEE);
        this._premintDone       = new StoredBoolean(this._premintDonePtr,    false);
        this._owner             = new StoredAddress(this._ownerPtr);
    }

    /** Deployment: record addresses passed as constructor calldata. */
    public override onDeployment(calldata: Calldata): void {
        this._owner.value    = Blockchain.txOrigin;
        this._odAddr.value   = calldata.readAddress(); // OD contract
        this._orcAddr.value  = calldata.readAddress(); // ORC contract
        this._wbtcAddr.value = calldata.readAddress(); // WBTC contract
        this._factoryAddr.value = calldata.readAddress(); // MotoSwap Factory
        this._phase.value    = u256.fromU8(PHASE_SEEDING);
    }

    /** Returns the current phase: 0=SEEDING, 1=PREMINT, 2=LIVE */
    @method()
    @returns({ name: 'phase', type: ABIDataTypes.UINT8 })
    public getPhase(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(1);
        w.writeU8(u8(this._phase.value.toU64()));
        return w;
    }

    /**
     * SEEDING → PREMINT: owner sets seed price (WBTC/USD, 8-decimal scaled).
     * e.g. $100,000 per WBTC = 100_000_00000000
     */
    @method({ name: 'seedPrice', type: ABIDataTypes.UINT256 })
    public advancePhase(calldata: Calldata): BytesWriter {
        this._onlyOwner();
        const currentPhase = u8(this._phase.value.toU64());
        if (currentPhase !== PHASE_SEEDING) throw new Revert('ODReserve: already advanced');
        const seedPrice = calldata.readU256();
        if (seedPrice.isZero()) throw new Revert('ODReserve: seedPrice cannot be zero');
        this._seedPrice.value = seedPrice;
        this._phase.value = u256.fromU8(PHASE_PREMINT);
        return new BytesWriter(0);
    }

    private _onlyOwner(): void {
        if (!Blockchain.msgSender.equals(this._owner.value)) {
            throw new Revert('ODReserve: caller is not owner');
        }
    }
}
```

**Step 5: Build and run tests**

```bash
npm run build:reserve && npm test
```

Expected: phase machine tests pass.

**Step 6: Commit**

```bash
git add src/contracts/ODReserve.ts src/selectors.ts tests/ODReserve.phase.test.ts
git commit -m "feat: ODReserve storage layout and phase machine"
```

---

## Task 5: Mock MotoSwap Pool (Test Infrastructure)

**Files:**
- Create: `src/contracts/MockMotoSwapPool.ts`
- Create: `tests/mocks/MockWBTC.ts`

The test suite for TWAP and financial operations needs controllable mock contracts. Build them here.

**Step 1: Implement `src/contracts/MockMotoSwapPool.ts`**

This is an AssemblyScript contract (compiled to WASM) that behaves like a MotoSwap pool but lets tests control return values via storage.

```typescript
import {
    OP_NET, Calldata, BytesWriter, Address, Blockchain,
    StoredU256, StoredBoolean, ABIDataTypes,
} from '@btc-vision/btc-runtime/runtime';

@final
export class MockMotoSwapPool extends OP_NET {
    private readonly _price0Ptr: u16 = Blockchain.nextPointer;
    private readonly _price1Ptr: u16 = Blockchain.nextPointer;
    private readonly _reserve0Ptr: u16 = Blockchain.nextPointer;
    private readonly _reserve1Ptr: u16 = Blockchain.nextPointer;
    private readonly _token0Ptr: u16 = Blockchain.nextPointer;

    private _price0: StoredU256;
    private _price1: StoredU256;
    private _reserve0: StoredU256;
    private _reserve1: StoredU256;
    private _token0: StoredAddress;

    constructor() {
        super();
        this._price0   = new StoredU256(this._price0Ptr, u256.Zero);
        this._price1   = new StoredU256(this._price1Ptr, u256.Zero);
        this._reserve0 = new StoredU256(this._reserve0Ptr, u256.Zero);
        this._reserve1 = new StoredU256(this._reserve1Ptr, u256.Zero);
        this._token0   = new StoredAddress(this._token0Ptr);
    }

    // --- Setters (called by tests to control values) ---

    @method({ name: 'price', type: ABIDataTypes.UINT256 })
    public setPrice0Cumulative(calldata: Calldata): BytesWriter {
        this._price0.value = calldata.readU256();
        return new BytesWriter(0);
    }

    @method({ name: 'price', type: ABIDataTypes.UINT256 })
    public setPrice1Cumulative(calldata: Calldata): BytesWriter {
        this._price1.value = calldata.readU256();
        return new BytesWriter(0);
    }

    @method(
        { name: 'r0', type: ABIDataTypes.UINT256 },
        { name: 'r1', type: ABIDataTypes.UINT256 },
    )
    public setReserves(calldata: Calldata): BytesWriter {
        this._reserve0.value = calldata.readU256();
        this._reserve1.value = calldata.readU256();
        return new BytesWriter(0);
    }

    @method({ name: 'token', type: ABIDataTypes.ADDRESS })
    public setToken0(calldata: Calldata): BytesWriter {
        this._token0.value = calldata.readAddress();
        return new BytesWriter(0);
    }

    // --- Pool interface (called by ODReserve) ---

    @method()
    @returns({ name: 'price0', type: ABIDataTypes.UINT256 })
    public price0CumulativeLast(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(this._price0.value);
        return w;
    }

    @method()
    @returns({ name: 'price1', type: ABIDataTypes.UINT256 })
    public price1CumulativeLast(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(this._price1.value);
        return w;
    }

    @method()
    @returns(
        { name: 'reserve0', type: ABIDataTypes.UINT256 },
        { name: 'reserve1', type: ABIDataTypes.UINT256 },
        { name: 'blockTimestamp', type: ABIDataTypes.UINT64 },
    )
    public getReserves(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(72);
        w.writeU256(this._reserve0.value);
        w.writeU256(this._reserve1.value);
        w.writeU64(Blockchain.block.numberU64);
        return w;
    }

    @method()
    @returns({ name: 'token0', type: ABIDataTypes.ADDRESS })
    public token0(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeAddress(this._token0.value);
        return w;
    }
}
```

**Step 2: Create `tests/mocks/MockWBTC.ts`**

For tests, use the unit-test-framework's built-in OP-20 mock rather than writing one from scratch:

```typescript
// In test files, use the framework's OP20 helper:
// import { OP20 } from '@btc-vision/unit-test-framework';
// const wbtc = new OP20({ address: ..., deployer: ..., decimals: 8 });
// This gives you a fully functional OP-20 token for testing.
```

**Step 3: Add MockMotoSwapPool to asconfig.json**

```json
"mockPool": {
  "entry": "src/contracts/MockMotoSwapPool.ts",
  "outFile": "build/MockMotoSwapPool.wasm",
  "sourceMap": true,
  "optimize": false
}
```

**Step 4: Build mock**

```bash
npm run build
```

Expected: all WASM files build including MockMotoSwapPool. Note the selector values for `price0CumulativeLast`, `price1CumulativeLast`, `getReserves`, `token0` from the build output — add them to `src/selectors.ts`.

**Step 5: Commit**

```bash
git add src/contracts/MockMotoSwapPool.ts tests/mocks/
git commit -m "test: add MockMotoSwapPool for TWAP testing"
```

---

## Task 6: ODReserve — TWAP Oracle

**Files:**
- Modify: `src/contracts/ODReserve.ts`
- Create: `tests/ODReserve.twap.test.ts`

**Step 1: Write failing TWAP tests**

`tests/ODReserve.twap.test.ts`:
```typescript
await opnet('ODReserve TWAP', async (vm: OPNetUnit) => {
    // Setup: advance to PREMINT, set pool address, advance to just before LIVE

    await vm.it('returns zero twap before pool is set', async () => {
        const twap = await reserve.getTwap();
        Assert.expect(twap.properties.twap).toEqual(0n);
    });

    await vm.it('computes TWAP after 6 blocks of accumulation', async () => {
        // seed pool with controlled cumulative values:
        // price0 goes from 0 to 600_000_00000000 over 6 blocks
        // TWAP = delta_cumulative / delta_blocks = 600_000_00000000 / 6 = 100_000_00000000
        // meaning 1 WBTC = 100,000 OD (= $100,000)

        await pool.setPrice0Cumulative(0n);
        Blockchain.blockNumber = 1n;
        await reserve.updateTwapSnapshot();

        await pool.setPrice0Cumulative(600_000_00000000n);
        Blockchain.blockNumber = 7n;

        const twap = await reserve.getTwap();
        Assert.expect(twap.properties.twap).toEqual(100_000_00000000n);
    });

    await vm.it('transitions to LIVE phase after TWAP window fills', async () => {
        // advance 6 blocks with valid pool data
        // ...
        const phase = await reserve.getPhase();
        Assert.expect(phase.properties.phase).toEqual(2n); // LIVE
    });

    await vm.it('TWAP window is configurable (6 blocks default)', async () => {
        const window = await reserve.getTwapWindow();
        Assert.expect(window.properties.blocks).toEqual(6n);
    });
});
```

**Step 2: Run — confirm fail**

```bash
npm test
```

**Step 3: Implement TWAP logic in ODReserve**

Add to `ODReserve.ts`:

```typescript
// Additional storage pointers (add to constructor list):
private readonly _twapWindowPtr: u16 = Blockchain.nextPointer;
// ...
private _twapWindow: StoredU256; // = 6 by default

// In constructor:
// this._twapWindow = new StoredU256(this._twapWindowPtr, u256.fromU64(6));

/** Returns current TWAP: OD per WBTC (8-decimal scaled). */
@method()
@returns({ name: 'twap', type: ABIDataTypes.UINT256 })
public getTwap(calldata: Calldata): BytesWriter {
    const twap = this._computeTwap();
    const w = new BytesWriter(32);
    w.writeU256(twap);
    return w;
}

/** Returns the TWAP observation window in blocks. */
@method()
@returns({ name: 'blocks', type: ABIDataTypes.UINT256 })
public getTwapWindow(calldata: Calldata): BytesWriter {
    const w = new BytesWriter(32);
    w.writeU256(this._twapWindow.value);
    return w;
}

/**
 * Reads current cumulative price from pool, computes TWAP,
 * updates snapshot if window elapsed. Transitions to LIVE if
 * called in PREMINT phase and window is full.
 */
private _computeTwap(): u256 {
    if (this._poolAddr.value.equals(Address.dead())) return u256.Zero;

    const pool = this._poolAddr.value;
    const cumulative = this._readPoolCumulative(pool);
    const currentBlock = Blockchain.block.numberU256;

    const snapshotCumulative = this._twapSnapshot.value;
    const snapshotBlock      = this._twapSnapshotBlock.value;

    // Not enough data yet
    if (snapshotBlock.isZero()) {
        // Take first snapshot
        this._twapSnapshot.value      = cumulative;
        this._twapSnapshotBlock.value = currentBlock;
        return u256.Zero;
    }

    const deltaBlocks = SafeMath.sub(currentBlock, snapshotBlock);
    if (deltaBlocks.isZero()) return this._currentTwap.value;

    const deltaCumulative = SafeMath.sub(cumulative, snapshotCumulative);
    const twap = SafeMath.div(deltaCumulative, deltaBlocks);

    // Refresh snapshot when window elapsed
    const window = this._twapWindow.value;
    if (SafeMath.gte(deltaBlocks, window)) {
        this._twapSnapshot.value      = cumulative;
        this._twapSnapshotBlock.value = currentBlock;
        this._currentTwap.value       = twap;

        // Auto-transition PREMINT → LIVE
        if (u8(this._phase.value.toU64()) === PHASE_PREMINT) {
            this._phase.value = u256.fromU8(PHASE_LIVE);
        }
    }

    return twap;
}

/**
 * Reads the correct price accumulator from the pool.
 * Uses price0CumulativeLast if WBTC is token0, else price1CumulativeLast.
 */
private _readPoolCumulative(pool: Address): u256 {
    const selector = this._wbtcIsToken0.value
        ? POOL_PRICE0_CUMULATIVE_SELECTOR
        : POOL_PRICE1_CUMULATIVE_SELECTOR;

    const w = new BytesWriter(4);
    w.writeSelector(selector);
    const result = Blockchain.call(pool, w, true);
    return result.data.readU256();
}

/**
 * Called once after the MotoSwap WBTC/OD pool is created.
 * Resolves which token is token0 by querying the pool.
 */
@method({ name: 'poolAddress', type: ABIDataTypes.ADDRESS })
public initPool(calldata: Calldata): BytesWriter {
    this._onlyOwner();
    const poolAddr = calldata.readAddress();
    this._poolAddr.value = poolAddr;

    // Query token0 from pool
    const w = new BytesWriter(4);
    w.writeSelector(POOL_TOKEN0_SELECTOR);
    const result = Blockchain.call(poolAddr, w, true);
    const token0 = result.data.readAddress();

    this._wbtcIsToken0.value = token0.equals(this._wbtcAddr.value);
    return new BytesWriter(0);
}
```

**Step 4: Run tests — pass**

```bash
npm run build:reserve && npm test
```

**Step 5: Commit**

```bash
git add src/contracts/ODReserve.ts tests/ODReserve.twap.test.ts
git commit -m "feat: ODReserve TWAP oracle with 6-block window and auto LIVE transition"
```

---

## Task 7: ODReserve — mintORC and burnORC

**Files:**
- Modify: `src/contracts/ODReserve.ts`
- Create: `tests/ODReserve.orc.test.ts`

These operate in SEEDING phase (mintORC) or LIVE phase (both) and do not require TWAP.

**Step 1: Write failing tests**

`tests/ODReserve.orc.test.ts`:
```typescript
await vm.it('mintORC: investor deposits WBTC and receives ORC', async () => {
    // Setup: SEEDING phase, 1 WBTC deposited
    // Expected: ORC minted at seed price floor
    // RC price = equity / orc_supply; at start equity = deposit, orc_supply = 0 → use floor price
    const wbtcIn = 1_00000000n; // 1 WBTC (8 decimals)
    await wbtc.approve(reserve.address, wbtcIn);
    await reserve.mintORC(wbtcIn);
    // Check ORC balance
    const orcBal = await orc.balanceOf(investor);
    Assert.expect(orcBal.properties.balance > 0n).toBeTrue();
});

await vm.it('mintORC: blocked when reserve ratio above max (800%)', async () => {
    // Advance to LIVE, set up conditions where ratio > 800%
    // mintORC should revert
    await Assert.expectThrow(() => reserve.mintORC(1_00000000n));
});

await vm.it('burnORC: receives WBTC proportional to equity', async () => {
    // Mint some ORC, then burn it
    // Received WBTC = orcIn * equity / orc_supply * (1 - fee)
});

await vm.it('burnORC: blocked when it would drop ratio below 400%', async () => {
    // Setup: ratio just above 400%; burn that would drop below → revert
    await Assert.expectThrow(() => reserve.burnORC(largeAmount));
});
```

**Step 2: Run — confirm fail**

**Step 3: Implement mintORC and burnORC**

```typescript
@method({ name: 'wbtcAmount', type: ABIDataTypes.UINT256 })
public mintORC(calldata: Calldata): BytesWriter {
    const phase = u8(this._phase.value.toU64());
    if (phase !== PHASE_SEEDING && phase !== PHASE_LIVE) {
        throw new Revert('ODReserve: mintORC only in SEEDING or LIVE');
    }

    const wbtcIn = calldata.readU256();
    if (wbtcIn.isZero()) throw new Revert('ODReserve: zero amount');

    // Check ratio cap (skip in SEEDING — reserve ratio is undefined with no OD)
    if (phase === PHASE_LIVE) {
        const twap = this._computeTwap();
        this._requireRatioBelow(MAX_RATIO, wbtcIn, u256.Zero, twap);
    }

    // Pull WBTC from caller
    this._wbtcTransferFrom(Blockchain.msgSender, Blockchain.contractAddress, wbtcIn);

    // Compute ORC to issue
    const orcOut = this._computeOrcOut(wbtcIn);
    const orcAfterFee = SafeMath.sub(orcOut, SafeMath.div(SafeMath.mul(orcOut, this._fee.value), FEE_SCALE));

    // Mint ORC
    this._orcMint(Blockchain.msgSender, orcAfterFee);

    this._emitMintORC(Blockchain.msgSender, wbtcIn, orcAfterFee);
    return new BytesWriter(0);
}

@method({ name: 'orcAmount', type: ABIDataTypes.UINT256 })
public burnORC(calldata: Calldata): BytesWriter {
    const phase = u8(this._phase.value.toU64());
    if (phase !== PHASE_LIVE) throw new Revert('ODReserve: burnORC only in LIVE');

    const orcIn = calldata.readU256();
    if (orcIn.isZero()) throw new Revert('ODReserve: zero amount');

    const twap = this._computeTwap();
    this._requireTwap(twap);

    // Compute WBTC to return: orcIn * equity_wbtc / orc_supply
    const orcSupply     = this._readOrcSupply();
    const equityInWbtc  = this._computeEquityInWbtc(twap);
    const wbtcOut       = SafeMath.div(SafeMath.mul(orcIn, equityInWbtc), orcSupply);
    const wbtcAfterFee  = SafeMath.sub(wbtcOut, SafeMath.div(SafeMath.mul(wbtcOut, this._fee.value), FEE_SCALE));

    // Require ratio stays above min after burn
    this._requireRatioAbove(MIN_RATIO, u256.Zero, wbtcAfterFee, twap);

    // Burn ORC, send WBTC
    this._orcBurn(Blockchain.msgSender, orcIn);
    this._wbtcTransfer(Blockchain.msgSender, wbtcAfterFee);

    return new BytesWriter(0);
}

/** ORC price = equity / supply. If supply=0, use seedPrice floor. */
private _computeOrcOut(wbtcIn: u256): u256 {
    const orcSupply = this._readOrcSupply();
    if (orcSupply.isZero()) {
        // First mint: use seed price to determine ORC out
        // 1 ORC = 1 / seedPrice WBTC (seedPrice is OD per WBTC = USD per WBTC)
        // ORC out = wbtcIn * seedPrice / 1e8
        return SafeMath.div(SafeMath.mul(wbtcIn, this._seedPrice.value), RATIO_SCALE);
    }
    // ORC price in WBTC = equity_in_wbtc / orc_supply
    // ORC out = wbtcIn / orc_price_in_wbtc = wbtcIn * orc_supply / equity_in_wbtc
    const twap = this._computeTwap();
    const equityInWbtc = this._computeEquityInWbtc(twap);
    if (equityInWbtc.isZero()) {
        return SafeMath.div(SafeMath.mul(wbtcIn, this._seedPrice.value), RATIO_SCALE);
    }
    return SafeMath.div(SafeMath.mul(wbtcIn, orcSupply), equityInWbtc);
}

private _computeEquityInWbtc(twap: u256): u256 {
    const reserve  = this._wbtcBalance();
    const odSupply = this._readOdSupply();
    if (odSupply.isZero()) return reserve;
    // equity = reserve - od_supply / twap
    const liabilityInWbtc = SafeMath.div(SafeMath.mul(odSupply, RATIO_SCALE), twap);
    if (SafeMath.gt(liabilityInWbtc, reserve)) return u256.Zero;
    return SafeMath.sub(reserve, liabilityInWbtc);
}
```

**Step 4: Implement helper cross-contract calls**

```typescript
private _wbtcTransferFrom(from: Address, to: Address, amount: u256): void {
    const w = new BytesWriter(4 + 32 + 32 + 32);
    w.writeSelector(WBTC_TRANSFER_FROM_SELECTOR);
    w.writeAddress(from);
    w.writeAddress(to);
    w.writeU256(amount);
    const result = Blockchain.call(this._wbtcAddr.value, w, true);
    if (!result.data.readBoolean()) throw new Revert('ODReserve: WBTC transferFrom failed');
}

private _wbtcTransfer(to: Address, amount: u256): void {
    const w = new BytesWriter(4 + 32 + 32);
    w.writeSelector(WBTC_TRANSFER_SELECTOR);
    w.writeAddress(to);
    w.writeU256(amount);
    const result = Blockchain.call(this._wbtcAddr.value, w, true);
    if (!result.data.readBoolean()) throw new Revert('ODReserve: WBTC transfer failed');
}

private _orcMint(to: Address, amount: u256): void {
    const w = new BytesWriter(4 + 32 + 32);
    w.writeSelector(ORC_MINT_SELECTOR);
    w.writeAddress(to);
    w.writeU256(amount);
    Blockchain.call(this._orcAddr.value, w, true);
}

private _orcBurn(from: Address, amount: u256): void {
    const w = new BytesWriter(4 + 32 + 32);
    w.writeSelector(ORC_BURN_SELECTOR);
    w.writeAddress(from);
    w.writeU256(amount);
    Blockchain.call(this._orcAddr.value, w, true);
}

private _wbtcBalance(): u256 {
    // Read WBTC balance of this contract
    const BALANCE_OF_SELECTOR: u32 = 0xXXXXXXXX; // from WBTC build output
    const w = new BytesWriter(4 + 32);
    w.writeSelector(BALANCE_OF_SELECTOR);
    w.writeAddress(Blockchain.contractAddress);
    const result = Blockchain.call(this._wbtcAddr.value, w, true);
    return result.data.readU256();
}

private _readOdSupply(): u256 {
    const TOTAL_SUPPLY_SELECTOR: u32 = 0xXXXXXXXX; // from OD build output
    const w = new BytesWriter(4);
    w.writeSelector(TOTAL_SUPPLY_SELECTOR);
    const result = Blockchain.call(this._odAddr.value, w, true);
    return result.data.readU256();
}

private _readOrcSupply(): u256 {
    const TOTAL_SUPPLY_SELECTOR: u32 = 0xXXXXXXXX; // same selector as OD
    const w = new BytesWriter(4);
    w.writeSelector(TOTAL_SUPPLY_SELECTOR);
    const result = Blockchain.call(this._orcAddr.value, w, true);
    return result.data.readU256();
}
```

**Step 5: Run tests — pass**

```bash
npm run build:reserve && npm test
```

**Step 6: Commit**

```bash
git add src/contracts/ODReserve.ts tests/ODReserve.orc.test.ts
git commit -m "feat: ODReserve mintORC and burnORC with reserve ratio enforcement"
```

---

## Task 8: ODReserve — mintOD and burnOD

**Files:**
- Modify: `src/contracts/ODReserve.ts`
- Create: `tests/ODReserve.od.test.ts`

Both operations require LIVE phase with a valid TWAP.

**Step 1: Write failing tests**

`tests/ODReserve.od.test.ts`:
```typescript
await vm.it('mintOD: deposit WBTC, receive OD at TWAP rate minus fee', async () => {
    // twap = 100_000_00000000 (1 WBTC = $100,000)
    // deposit 1 WBTC → should receive 100,000 OD minus 1.5% fee = 98,500 OD
    const wbtcIn = 1_00000000n;
    await wbtc.approve(reserve.address, wbtcIn);
    await reserve.mintOD(wbtcIn);
    const odBal = await od.balanceOf(user);
    Assert.expect(odBal.properties.balance).toEqual(98_500_00000000n); // 98,500 OD
});

await vm.it('mintOD: blocked if TWAP not ready', async () => {
    // Still in PREMINT (TWAP window not filled)
    await Assert.expectThrow(() => reserve.mintOD(1_00000000n));
});

await vm.it('mintOD: blocked if reserve ratio would drop below 400%', async () => {
    // Setup: large existing OD supply close to min ratio
    // New mint would breach → revert
    await Assert.expectThrow(() => reserve.mintOD(smallAmount));
});

await vm.it('burnOD: return OD, receive WBTC at TWAP rate minus fee', async () => {
    // Mint 1 OD first, then burn it
    // 1 OD → 1/100,000 WBTC minus 1.5% fee
    const odIn = 1_00000000n; // 1 OD
    const expectedWbtc = 985n; // (1/100000 * 0.985) in satoshis
    await reserve.burnOD(odIn);
    // ...
});

await vm.it('burnOD: never blocked — always succeeds', async () => {
    // Even at low reserve ratio, burnOD works
    // (this maintains the Djed invariant)
});
```

**Step 2: Run — confirm fail**

**Step 3: Implement mintOD and burnOD**

```typescript
@method({ name: 'wbtcAmount', type: ABIDataTypes.UINT256 })
public mintOD(calldata: Calldata): BytesWriter {
    const phase = u8(this._phase.value.toU64());
    if (phase !== PHASE_LIVE) throw new Revert('ODReserve: mintOD only in LIVE phase');

    const wbtcIn = calldata.readU256();
    if (wbtcIn.isZero()) throw new Revert('ODReserve: zero amount');

    const twap = this._computeTwap();
    this._requireTwap(twap);

    // OD out = wbtcIn * twap / 1e8 * (1 - fee)
    const odGross   = SafeMath.div(SafeMath.mul(wbtcIn, twap), RATIO_SCALE);
    const feeAmount = SafeMath.div(SafeMath.mul(odGross, this._fee.value), FEE_SCALE);
    const odOut     = SafeMath.sub(odGross, feeAmount);

    // Require ratio stays above min after this mint
    // New reserve = current + wbtcIn; new supply = current + odOut
    this._requireRatioAboveAfterMintOD(wbtcIn, odOut, twap);

    // Pull WBTC, mint OD
    this._wbtcTransferFrom(Blockchain.msgSender, Blockchain.contractAddress, wbtcIn);
    this._odMint(Blockchain.msgSender, odOut);

    return new BytesWriter(0);
}

@method({ name: 'odAmount', type: ABIDataTypes.UINT256 })
public burnOD(calldata: Calldata): BytesWriter {
    const phase = u8(this._phase.value.toU64());
    // burnOD allowed in PREMINT and LIVE (users can always exit)
    if (phase === PHASE_SEEDING) throw new Revert('ODReserve: burnOD not available in SEEDING');

    const odIn = calldata.readU256();
    if (odIn.isZero()) throw new Revert('ODReserve: zero amount');

    const twap = this._computeTwap();
    this._requireTwap(twap);

    // WBTC out = odIn / twap * 1e8 * (1 - fee)
    const wbtcGross  = SafeMath.div(SafeMath.mul(odIn, RATIO_SCALE), twap);
    const feeAmount  = SafeMath.div(SafeMath.mul(wbtcGross, this._fee.value), FEE_SCALE);
    const wbtcOut    = SafeMath.sub(wbtcGross, feeAmount);

    // Burn OD, send WBTC — burnOD is never blocked
    this._odBurn(Blockchain.msgSender, odIn);
    this._wbtcTransfer(Blockchain.msgSender, wbtcOut);

    return new BytesWriter(0);
}

private _odMint(to: Address, amount: u256): void {
    const w = new BytesWriter(4 + 32 + 32);
    w.writeSelector(OD_MINT_SELECTOR);
    w.writeAddress(to);
    w.writeU256(amount);
    Blockchain.call(this._odAddr.value, w, true);
}

private _odBurn(from: Address, amount: u256): void {
    const w = new BytesWriter(4 + 32 + 32);
    w.writeSelector(OD_BURN_SELECTOR);
    w.writeAddress(from);
    w.writeU256(amount);
    Blockchain.call(this._odAddr.value, w, true);
}

/** Reverts if reserve ratio after this mintOD would drop below MIN_RATIO. */
private _requireRatioAboveAfterMintOD(wbtcIn: u256, odOut: u256, twap: u256): void {
    const newReserve = SafeMath.add(this._wbtcBalance(), wbtcIn);
    const newOdSupply = SafeMath.add(this._readOdSupply(), odOut);
    if (newOdSupply.isZero()) return;
    // ratio = newReserve * twap / newOdSupply / 1e8 (scaled by RATIO_SCALE)
    const equityOd = SafeMath.div(SafeMath.mul(newReserve, twap), RATIO_SCALE);
    const ratio = SafeMath.div(SafeMath.mul(equityOd, RATIO_SCALE), newOdSupply);
    if (SafeMath.lt(ratio, MIN_RATIO)) {
        throw new Revert('ODReserve: would breach minimum reserve ratio');
    }
}

private _requireTwap(twap: u256): void {
    if (twap.isZero()) throw new Revert('ODReserve: TWAP not ready');
}
```

**Step 4: Run tests — pass**

```bash
npm run build:reserve && npm test
```

**Step 5: Commit**

```bash
git add src/contracts/ODReserve.ts tests/ODReserve.od.test.ts
git commit -m "feat: ODReserve mintOD and burnOD with TWAP pricing and fee"
```

---

## Task 9: ODReserve — premintOD and Read Methods

**Files:**
- Modify: `src/contracts/ODReserve.ts`
- Create: `tests/ODReserve.premint.test.ts`

**Step 1: Write failing tests**

```typescript
await vm.it('premintOD: owner mints OD in PREMINT phase', async () => {
    await reserve.advancePhase(100_000_00000000n); // → PREMINT
    await reserve.premintOD(10_000_00000000n);     // 10,000 OD
    const bal = await od.balanceOf(deployer);
    Assert.expect(bal.properties.balance).toEqual(10_000_00000000n);
});

await vm.it('premintOD: can only be called once', async () => {
    await reserve.advancePhase(100_000_00000000n);
    await reserve.premintOD(10_000_00000000n);
    await Assert.expectThrow(() => reserve.premintOD(1_00000000n));
});

await vm.it('premintOD: blocked if amount would breach 400% ratio', async () => {
    // reserve has only 1 WBTC = $100,000 → max OD at 400% = 100,000/4 = 25,000 OD
    // trying to premint 26,000 OD → revert
    await Assert.expectThrow(() => reserve.premintOD(26_000_00000000n));
});

await vm.it('getReserveRatio: returns correct ratio', async () => { /* ... */ });
await vm.it('getEquity: returns reserve minus liabilities', async () => { /* ... */ });
```

**Step 2: Implement premintOD and view methods**

```typescript
@method({ name: 'odAmount', type: ABIDataTypes.UINT256 })
public premintOD(calldata: Calldata): BytesWriter {
    this._onlyOwner();
    const phase = u8(this._phase.value.toU64());
    if (phase !== PHASE_PREMINT) throw new Revert('ODReserve: premintOD only in PREMINT phase');
    if (this._premintDone.value)  throw new Revert('ODReserve: premintOD already called');

    const odAmount = calldata.readU256();
    if (odAmount.isZero()) throw new Revert('ODReserve: zero amount');

    // Validate: would not breach minimum ratio
    // Uses seedPrice since TWAP not available yet
    const seedPrice = this._seedPrice.value;
    this._requireRatioAboveAfterMintODWithSeedPrice(odAmount, seedPrice);

    this._premintDone.value = true;
    this._odMint(this._owner.value, odAmount);
    return new BytesWriter(0);
}

/** View: current reserve ratio (scaled by 1e8). */
@method()
@returns({ name: 'ratio', type: ABIDataTypes.UINT256 })
public getReserveRatio(calldata: Calldata): BytesWriter {
    const twap = this._currentTwap.value;
    if (twap.isZero()) {
        const w = new BytesWriter(32);
        w.writeU256(u256.Max); // infinite (no OD supply yet)
        return w;
    }
    const reserve   = this._wbtcBalance();
    const odSupply  = this._readOdSupply();
    const equityOd  = SafeMath.div(SafeMath.mul(reserve, twap), RATIO_SCALE);
    const ratio     = odSupply.isZero() ? u256.Max : SafeMath.div(SafeMath.mul(equityOd, RATIO_SCALE), odSupply);
    const w = new BytesWriter(32);
    w.writeU256(ratio);
    return w;
}

/** View: equity in WBTC (reserve minus OD liabilities). */
@method()
@returns({ name: 'equity', type: ABIDataTypes.UINT256 })
public getEquity(calldata: Calldata): BytesWriter {
    const twap = this._currentTwap.value;
    const eq   = twap.isZero() ? this._wbtcBalance() : this._computeEquityInWbtc(twap);
    const w = new BytesWriter(32);
    w.writeU256(eq);
    return w;
}
```

**Step 3: Run tests — pass**

```bash
npm run build:reserve && npm test
```

**Step 4: Commit**

```bash
git add src/contracts/ODReserve.ts tests/ODReserve.premint.test.ts
git commit -m "feat: ODReserve premintOD and view methods (getReserveRatio, getEquity)"
```

---

## Task 10: Integration Tests

**Files:**
- Create: `tests/ODReserve.integration.test.ts`

Full end-to-end test of the bootstrap sequence and normal operation.

**Step 1: Write integration tests**

`tests/ODReserve.integration.test.ts`:
```typescript
await opnet('ODReserve Integration', async (vm: OPNetUnit) => {

    await vm.it('full bootstrap: SEEDING → PREMINT → LIVE', async () => {
        // 1. Investor mints ORC (seeds reserve)
        Blockchain.msgSender = investor;
        await wbtc.approve(reserve.address, 10_00000000n); // 10 WBTC
        await reserve.mintORC(10_00000000n);

        // 2. Owner advances to PREMINT
        Blockchain.msgSender = deployer;
        await reserve.advancePhase(100_000_00000000n); // $100K seed price

        // 3. Owner premints OD (10 WBTC reserve → max safe OD at 400% = 2.5 WBTC = $250,000 OD)
        await reserve.premintOD(200_000_00000000n); // 200,000 OD (safe)

        // 4. Advance 6 blocks (simulate TWAP accumulation)
        Blockchain.blockNumber = 6n;
        await pool.setPrice0Cumulative(600_000_00000000_00000000n);

        // 5. Any operation triggers LIVE transition
        Blockchain.msgSender = investor;
        await wbtc.approve(reserve.address, 1_00000000n);
        await reserve.mintOD(1_00000000n); // triggers TWAP, → LIVE

        const phase = await reserve.getPhase();
        Assert.expect(phase.properties.phase).toEqual(2n); // LIVE
    });

    await vm.it('reserve ratio stays above 400% through mint/burn cycles', async () => {
        // Bootstrap...
        // Mint OD several times
        // Check ratio after each
        // Never drops below MIN_RATIO
    });

    await vm.it('fees accrue to reserve (benefit ORC holders)', async () => {
        // Mint OD → fee stays in reserve → RC equity increases
        const equityBefore = (await reserve.getEquity()).properties.equity;
        await reserve.mintOD(1_00000000n);
        const equityAfter = (await reserve.getEquity()).properties.equity;
        // equity increased because fee stayed in reserve
        Assert.expect(equityAfter > equityBefore).toBeTrue();
    });

    await vm.it('burnOD always succeeds regardless of reserve ratio', async () => {
        // Set up system near 400% ratio
        // burnOD still works (Djed invariant)
        await reserve.burnOD(1_00000000n);
        // No revert
    });

    await vm.it('ORC burn blocked when it would drop ratio below 400%', async () => {
        // Drain reserve close to 400%
        await Assert.expectThrow(() => reserve.burnORC(allORC));
    });
});
```

**Step 2: Run integration tests — all pass**

```bash
npm run build && npm test
```

**Step 3: Commit**

```bash
git add tests/ODReserve.integration.test.ts
git commit -m "test: add ODReserve integration tests for full bootstrap and mint/burn cycles"
```

---

## Task 11: Deployment Scripts

**Files:**
- Create: `scripts/deploy.ts`
- Create: `scripts/bootstrap.ts`

TypeScript scripts using the `opnet` SDK. Source env file before running.

**Step 1: Create `scripts/deploy.ts`**

```typescript
import { IWallet, Wallet } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { TransactionFactory } from '@btc-vision/transaction';
import * as fs from 'fs';

// Addresses from sharedenv (loaded from environment)
const FACTORY_ADDRESS = process.env.OPNET_MOTOSWAP_FACTORY!;
const DEPLOYER_MNEMONIC = process.env.OPNET_DEPLOYER_MNEMONIC!;
const RPC_URL = 'https://regtest.opnet.org'; // confirm correct regtest URL

// WBTC contract address (provided by official custodians — must be known before deploy)
const WBTC_ADDRESS = process.env.OPNET_WBTC_ADDRESS!;

async function main() {
    const wallet = Wallet.fromMnemonic(DEPLOYER_MNEMONIC, networks.opnetTestnet);

    // 1. Deploy OD
    // The deployer address is the first argument to onDeployment,
    // which will be set to ODReserve address AFTER reserve is deployed.
    // Strategy: deploy OD with a placeholder, then update via a post-deploy call.
    // OR: deploy in order — OD first with reserve address pre-computed.

    // Pre-compute reserve address via salt/deterministic deployment if supported.
    // Otherwise, deploy in two passes:
    //   Pass 1: deploy OD, ORC with dummy reserve address
    //   Pass 2: deploy ODReserve
    //   Pass 3: call OD.setReserve(reserveAddress), ORC.setReserve(reserveAddress)

    console.log('Deploying OD...');
    // const odAddress = await deployContract(wallet, 'build/OD.wasm', calldata);

    console.log('Deploying ORC...');
    // const orcAddress = await deployContract(wallet, 'build/ORC.wasm', calldata);

    console.log('Deploying ODReserve...');
    // const reserveAddress = await deployContract(wallet, 'build/ODReserve.wasm', calldata);

    console.log('Deploy complete.');
    console.log({ odAddress, orcAddress, reserveAddress });
}

main().catch(console.error);
```

> **Note:** Check the opnet-bob MCP (`opnet_dev`, doc: `how-to/deployment.md`) for the exact `TransactionFactory` pattern for deploying contracts. Do NOT use raw PSBT — use the opnet SDK deployment pattern exclusively.

**Step 2: Create `scripts/bootstrap.ts`**

```typescript
// After contracts are deployed:
// 1. Investors call mintORC (can be done via OP_WALLET — just document the call)
// 2. Owner calls advancePhase(seedPrice)
// 3. Owner calls premintOD(amount)
// 4. Owner calls createPool on MotoSwap factory (WBTC + OD)
// 5. Owner adds liquidity via MotoSwap router
// 6. Owner calls reserve.initPool(poolAddress)
// 7. Wait 6 blocks
// 8. Any user interaction triggers LIVE transition automatically

async function bootstrap() {
    // Load addresses from deploy output
    const { odAddress, orcAddress, reserveAddress } = JSON.parse(
        fs.readFileSync('deploy-output.json', 'utf-8')
    );

    const seedPrice = 100_000_00000000n; // $100,000 per WBTC
    console.log('Advancing to PREMINT phase...');
    // await reserve.advancePhase(seedPrice)

    console.log('Preminting OD for pool seeding...');
    // await reserve.premintOD(200_000_00000000n)

    console.log('Creating MotoSwap WBTC/OD pool...');
    // await factory.createPool(wbtcAddress, odAddress)
    // const poolAddress = await factory.getPool(wbtcAddress, odAddress)

    console.log('Adding initial liquidity...');
    // await router.addLiquidity(wbtcAddress, odAddress, wbtcAmount, odAmount, ...)

    console.log('Initialising pool in ODReserve...');
    // await reserve.initPool(poolAddress)

    console.log('Bootstrap complete. Waiting for TWAP window (6 blocks = ~1 hour)...');
}

bootstrap().catch(console.error);
```

**Step 3: Commit**

```bash
git add scripts/
git commit -m "feat: add deploy and bootstrap scripts"
```

---

## Checklist Before Submitting

- [ ] All tests pass: `npm test`
- [ ] All three contracts build without warnings: `npm run build`
- [ ] Selectors in `src/selectors.ts` are populated from actual build output (not guessed)
- [ ] No raw u256 arithmetic — all SafeMath
- [ ] No hardcoded Keccak256 selectors
- [ ] `@method` declares ALL parameters
- [ ] No `while` loops
- [ ] Reserve ratio enforcement tested at boundaries (just above/below 400% and 800%)
- [ ] burnOD tested with low reserve ratio (must succeed)
- [ ] Phase transitions are irreversible (tested)
- [ ] premintOD can only be called once (tested)
- [ ] Run opnet-bob incident query before starting: `opnet_incident_query({ action: "recent" })`
