/**
 * Step executor — mirrors scripts/bootstrap.ts step logic.
 *
 * Each step: getContract -> simulate -> sendTransaction -> return txId.
 * Uses the deployer wallet loaded from mnemonic.
 *
 * Note: `as any` casts are required at cross-package type boundaries
 * because opnet bundles its own copy of @btc-vision/transaction, and
 * TypeScript treats the structurally-identical Address / Signer types
 * from each copy as incompatible (nominal private fields).
 */

import { Mnemonic, MLDSASecurityLevel } from '@btc-vision/transaction';
import {
  getContract,
  JSONRpcProvider,
  OP_20_ABI,
  ABIDataTypes,
  BitcoinAbiTypes,
} from 'opnet';
import type {
  TransactionParameters,
  BitcoinInterfaceAbi,
  BaseContractProperties,
  CallResult,
  IOP20Contract,
} from 'opnet';
import { networks, type Network } from '@btc-vision/bitcoin';
import type { ServerConfig } from '../config.js';

// ---------------------------------------------------------------------------
// ABI definitions (mirrors scripts/abi.ts)
// ---------------------------------------------------------------------------

const OD_ORC_ABI: BitcoinInterfaceAbi = [
  ...OP_20_ABI,
  {
    name: 'setReserve',
    inputs: [{ name: 'reserve', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];

const OD_RESERVE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'mintORC',
    inputs: [{ name: 'wbtcAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'orcMinted', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'advancePhase',
    inputs: [{ name: 'seedPrice', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'premintOD',
    inputs: [{ name: 'odAmount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'initPool',
    inputs: [{ name: 'poolAddress', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'updateTwapSnapshot',
    inputs: [],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];

// ---------------------------------------------------------------------------
// Contract interfaces (using any for Address to avoid cross-package issues)
// ---------------------------------------------------------------------------

interface IODORCContract extends BaseContractProperties {
  setReserve(reserve: any): Promise<CallResult>;
}

interface IODReserveContract extends BaseContractProperties {
  mintORC(wbtcAmount: bigint): Promise<CallResult>;
  advancePhase(seedPrice: bigint): Promise<CallResult>;
  premintOD(odAmount: bigint): Promise<CallResult>;
  initPool(poolAddress: any): Promise<CallResult>;
  updateTwapSnapshot(): Promise<CallResult>;
}

// ---------------------------------------------------------------------------
// Network resolver
// ---------------------------------------------------------------------------

function resolveNetwork(name: string): Network {
  switch (name) {
    case 'bitcoin':
    case 'mainnet':
      return networks.bitcoin;
    case 'testnet':
      return networks.opnetTestnet;
    case 'regtest':
      return networks.regtest;
    default:
      throw new Error(`Unknown network: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeStep(
  config: ServerConfig,
  stepId: number,
  params: Record<string, string>,
): Promise<{ txId: string }> {
  const validSteps = [0, 1, 2, 3, 4, 6, 7, 8];
  if (!validSteps.includes(stepId)) {
    throw new Error(`Step ${stepId} is not executable via CABAL server`);
  }

  const network = resolveNetwork(config.opnetNetwork);
  const provider = new JSONRpcProvider(config.opnetNodeUrl, network as any);
  const mnemonic = new Mnemonic(
    config.deployerMnemonic,
    '',
    network,
    MLDSASecurityLevel.LEVEL2,
  );
  const wallet = mnemonic.deriveOPWallet(undefined, 0, 0, false);

  const txParams: TransactionParameters = {
    signer: wallet.keypair as any,
    mldsaSigner: wallet.mldsaKeypair as any,
    refundTo: wallet.p2tr,
    maximumAllowedSatToSpend: 100_000n,
    feeRate: 100,
    network: network as any,
  };

  try {
    const txId = await runStep(stepId, params, config, provider, network, wallet, txParams);
    return { txId };
  } finally {
    mnemonic.zeroize();
    wallet.zeroize();
  }
}

async function runStep(
  stepId: number,
  params: Record<string, string>,
  config: ServerConfig,
  provider: JSONRpcProvider,
  network: Network,
  wallet: any,
  txParams: TransactionParameters,
): Promise<string> {
  switch (stepId) {
    case 0: {
      const od = getContract<IODORCContract & IOP20Contract>(
        config.addresses.od, OD_ORC_ABI, provider, network as any, wallet.address,
      );
      const reserveAddr = await provider.getPublicKeyInfo(
        params['reserveAddr'] ?? config.addresses.reserve, true,
      );
      const result = await (od as any).setReserve(reserveAddr);
      if (result.revert) throw new Error(`OD.setReserve reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    case 1: {
      const orc = getContract<IODORCContract & IOP20Contract>(
        config.addresses.orc, OD_ORC_ABI, provider, network as any, wallet.address,
      );
      const reserveAddr = await provider.getPublicKeyInfo(
        params['reserveAddr'] ?? config.addresses.reserve, true,
      );
      const result = await (orc as any).setReserve(reserveAddr);
      if (result.revert) throw new Error(`ORC.setReserve reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    case 2: {
      const wbtcAmount = BigInt(params['wbtcAmount'] ?? '0');
      if (wbtcAmount === 0n) throw new Error('wbtcAmount is required');

      const wbtc = getContract<IOP20Contract>(
        config.addresses.wbtc, OP_20_ABI, provider, network as any, wallet.address,
      );
      const reserveAddr = await provider.getPublicKeyInfo(config.addresses.reserve, true);

      const approveResult = await (wbtc as any).increaseAllowance(reserveAddr, wbtcAmount);
      if (approveResult.revert)
        throw new Error(`WBTC approve reverted: ${approveResult.revert}`);
      await approveResult.sendTransaction(txParams);

      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, wallet.address,
      );
      const mintResult = await (reserve as any).mintORC(wbtcAmount);
      if (mintResult.revert) throw new Error(`mintORC reverted: ${mintResult.revert}`);
      const tx = await mintResult.sendTransaction(txParams);
      return tx.transactionId;
    }

    case 3: {
      const seedPrice = BigInt(params['seedPrice'] ?? '100000000');
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, wallet.address,
      );
      const result = await (reserve as any).advancePhase(seedPrice);
      if (result.revert) throw new Error(`advancePhase reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    case 4: {
      const odAmount = BigInt(params['odAmount'] ?? '0');
      if (odAmount === 0n) throw new Error('odAmount is required');

      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, wallet.address,
      );
      const result = await (reserve as any).premintOD(odAmount);
      if (result.revert) throw new Error(`premintOD reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    case 6: {
      const poolAddr = params['poolAddress'];
      if (!poolAddr) throw new Error('poolAddress is required');

      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, wallet.address,
      );
      const resolvedPool = await provider.getPublicKeyInfo(poolAddr, true);
      const result = await (reserve as any).initPool(resolvedPool);
      if (result.revert) throw new Error(`initPool reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    case 7: {
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, wallet.address,
      );
      const result = await (reserve as any).updateTwapSnapshot();
      if (result.revert) throw new Error(`updateTwapSnapshot reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    case 8: {
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, wallet.address,
      );
      const result = await (reserve as any).advancePhase(0n);
      if (result.revert) throw new Error(`advancePhase reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    default:
      throw new Error(`Step ${stepId} is not implemented`);
  }
}
