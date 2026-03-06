/**
 * Step executor — mirrors scripts/bootstrap.ts step logic.
 *
 * Each step: getContract -> simulate -> sendTransaction -> return txId.
 * Uses raw ECDSA key + proxy ML-DSA signer (PERMAFROST split-key wallet).
 *
 * Note: `as any` casts are required at cross-package type boundaries
 * because opnet bundles its own copy of @btc-vision/transaction, and
 * TypeScript treats the structurally-identical Address / Signer types
 * from each copy as incompatible (nominal private fields).
 */

import { Address } from '@btc-vision/transaction';
import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';
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
  {
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: ABIDataTypes.ADDRESS }],
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
  {
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: ABIDataTypes.ADDRESS }],
    outputs: [{ name: 'ok', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];

// ---------------------------------------------------------------------------
// Contract interfaces (using any for Address to avoid cross-package issues)
// ---------------------------------------------------------------------------

interface IODORCContract extends BaseContractProperties {
  setReserve(reserve: any): Promise<CallResult>;
  transferOwnership(newOwner: any): Promise<CallResult>;
}

interface IODReserveContract extends BaseContractProperties {
  mintORC(wbtcAmount: bigint): Promise<CallResult>;
  advancePhase(seedPrice: bigint): Promise<CallResult>;
  premintOD(odAmount: bigint): Promise<CallResult>;
  initPool(poolAddress: any): Promise<CallResult>;
  updateTwapSnapshot(): Promise<CallResult>;
  transferOwnership(newOwner: any): Promise<CallResult>;
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
// PERMAFROST wallet helpers
// ---------------------------------------------------------------------------

const backend = createNobleBackend();

/**
 * Build the PERMAFROST P2TR address from config (ECDSA key + ML-DSA pubkey).
 * Used by routes to return the wallet address without exposing private key.
 */
export function buildPermafrostP2TR(config: ServerConfig): string {
  if (!config.ecdsaPrivateKey) throw new Error('ECDSA key not configured');
  const network = resolveNetwork(config.opnetNetwork);
  const ecPair = ECPairSigner.fromPrivateKey(
    backend,
    Buffer.from(config.ecdsaPrivateKey, 'hex') as any,
    network,
  );
  const mldsaPubKey = Buffer.from(config.permafrostPublicKey, 'hex');
  const addr = new Address(mldsaPubKey, ecPair.publicKey);
  return addr.p2tr(network);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const DIGITS_RE = /^\d+$/;

function requireBigInt(params: Record<string, string>, key: string, required: boolean = true): bigint {
  const value = params[key];
  if (!value) {
    if (required) throw new Error(`${key} is required`);
    return 0n;
  }
  if (!DIGITS_RE.test(value)) {
    throw new Error(`${key} must be a non-negative integer (digits only)`);
  }
  return BigInt(value);
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeStep(
  config: ServerConfig,
  stepId: number,
  params: Record<string, string>,
): Promise<{ txId: string }> {
  if (!config.ecdsaPrivateKey) {
    throw new Error('Signing wallet not configured — generate via /api/cabal/generate-wallet');
  }

  const validSteps = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13];
  if (!validSteps.includes(stepId)) {
    throw new Error(`Step ${stepId} is not executable via CABAL server`);
  }

  const network = resolveNetwork(config.opnetNetwork);
  const provider = new JSONRpcProvider(config.opnetNodeUrl, network as any);

  // Build ECDSA signer from raw private key
  const ecPair = ECPairSigner.fromPrivateKey(
    backend,
    Buffer.from(config.ecdsaPrivateKey, 'hex') as any,
    network,
  );

  // Proxy ML-DSA signer — only publicKey is read (sign() never called with defaults)
  const mldsaPubKey = Buffer.from(config.permafrostPublicKey, 'hex');
  const proxyMldsaSigner = {
    publicKey: new Uint8Array(mldsaPubKey),
    sign(_hash: Uint8Array): Uint8Array {
      throw new Error('Proxy signer: sign() should not be called');
    },
    verify(_hash: Uint8Array, _sig: Uint8Array): boolean {
      throw new Error('Proxy signer: verify() should not be called');
    },
  };

  // Derive PERMAFROST address
  const permafrostAddress = new Address(mldsaPubKey, ecPair.publicKey);

  const txParams: TransactionParameters = {
    signer: ecPair as any,
    mldsaSigner: proxyMldsaSigner as any,
    refundTo: permafrostAddress.p2tr(network),
    maximumAllowedSatToSpend: 100_000n,
    feeRate: 100,
    network: network as any,
  };

  const txId = await runStep(stepId, params, config, provider, network, permafrostAddress, txParams);
  return { txId };
}

async function runStep(
  stepId: number,
  params: Record<string, string>,
  config: ServerConfig,
  provider: JSONRpcProvider,
  network: Network,
  senderAddress: any,
  txParams: TransactionParameters,
): Promise<string> {
  switch (stepId) {
    // Step 0: setReserve on OD
    case 0: {
      const od = getContract<IODORCContract & IOP20Contract>(
        config.addresses.od, OD_ORC_ABI, provider, network as any, senderAddress,
      );
      const reserveAddr = await provider.getPublicKeyInfo(
        params['reserveAddr'] ?? config.addresses.reserve, true,
      );
      const result = await (od as any).setReserve(reserveAddr);
      if (result.revert) throw new Error(`OD.setReserve reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 1: setReserve on ORC
    case 1: {
      const orc = getContract<IODORCContract & IOP20Contract>(
        config.addresses.orc, OD_ORC_ABI, provider, network as any, senderAddress,
      );
      const reserveAddr = await provider.getPublicKeyInfo(
        params['reserveAddr'] ?? config.addresses.reserve, true,
      );
      const result = await (orc as any).setReserve(reserveAddr);
      if (result.revert) throw new Error(`ORC.setReserve reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 2: Approve WBTC for Reserve
    case 2: {
      const wbtcAmount = requireBigInt(params, 'wbtcAmount');
      if (wbtcAmount === 0n) throw new Error('wbtcAmount must be greater than 0');
      const wbtc = getContract<IOP20Contract>(
        config.addresses.wbtc, OP_20_ABI, provider, network as any, senderAddress,
      );
      const reserveAddr = await provider.getPublicKeyInfo(config.addresses.reserve, true);
      const result = await (wbtc as any).increaseAllowance(reserveAddr, wbtcAmount);
      if (result.revert) throw new Error(`WBTC approve reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 3: mintORC (deposit WBTC)
    case 3: {
      const wbtcAmount = requireBigInt(params, 'wbtcAmount');
      if (wbtcAmount === 0n) throw new Error('wbtcAmount must be greater than 0');
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, senderAddress,
      );
      const result = await (reserve as any).mintORC(wbtcAmount);
      if (result.revert) throw new Error(`mintORC reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 4: advancePhase (set seed price)
    case 4: {
      const seedPrice = params['seedPrice'] ? requireBigInt(params, 'seedPrice') : 100000000n;
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, senderAddress,
      );
      const result = await (reserve as any).advancePhase(seedPrice);
      if (result.revert) throw new Error(`advancePhase reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 5: premintOD
    case 5: {
      const odAmount = requireBigInt(params, 'odAmount');
      if (odAmount === 0n) throw new Error('odAmount must be greater than 0');
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, senderAddress,
      );
      const result = await (reserve as any).premintOD(odAmount);
      if (result.revert) throw new Error(`premintOD reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 6: Approve OD for MotoSwap Router
    case 6: {
      const odAmount = requireBigInt(params, 'odAmount');
      if (odAmount === 0n) throw new Error('odAmount must be greater than 0');
      const od = getContract<IOP20Contract>(
        config.addresses.od, OD_ORC_ABI, provider, network as any, senderAddress,
      );
      const resolvedRouter = await provider.getPublicKeyInfo(config.addresses.router, true);
      const result = await (od as any).increaseAllowance(resolvedRouter, odAmount);
      if (result.revert) throw new Error(`OD approve reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 7: Approve WBTC for MotoSwap Router
    case 7: {
      const wbtcAmount = requireBigInt(params, 'wbtcAmount');
      if (wbtcAmount === 0n) throw new Error('wbtcAmount must be greater than 0');
      const wbtc = getContract<IOP20Contract>(
        config.addresses.wbtc, OP_20_ABI, provider, network as any, senderAddress,
      );
      const resolvedRouter = await provider.getPublicKeyInfo(config.addresses.router, true);
      const result = await (wbtc as any).increaseAllowance(resolvedRouter, wbtcAmount);
      if (result.revert) throw new Error(`WBTC approve reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 8: external (MotoSwap UI) — not executable via server

    // Step 9: initPool
    case 9: {
      const poolAddr = params['poolAddress'];
      if (!poolAddr) throw new Error('poolAddress is required');
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, senderAddress,
      );
      const resolvedPool = await provider.getPublicKeyInfo(poolAddr, true);
      const result = await (reserve as any).initPool(resolvedPool);
      if (result.revert) throw new Error(`initPool reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 10: updateTwapSnapshot
    case 10: {
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, senderAddress,
      );
      const result = await (reserve as any).updateTwapSnapshot();
      if (result.revert) throw new Error(`updateTwapSnapshot reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 11: final advancePhase (PREMINT → LIVE)
    case 11: {
      const reserve = getContract<IODReserveContract>(
        config.addresses.reserve, OD_RESERVE_ABI, provider, network as any, senderAddress,
      );
      const result = await (reserve as any).advancePhase(0n);
      if (result.revert) throw new Error(`advancePhase reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 12: Transfer OP-20 tokens
    case 12: {
      const contractAddr = params['contractAddr'];
      const toAddress = params['toAddress'];
      const amount = requireBigInt(params, 'amount');
      if (!contractAddr) throw new Error('contractAddr is required');
      if (!toAddress) throw new Error('toAddress is required');
      if (amount === 0n) throw new Error('amount must be greater than 0');
      const token = getContract<IOP20Contract>(
        contractAddr, OD_ORC_ABI, provider, network as any, senderAddress,
      );
      const resolvedTo = await provider.getPublicKeyInfo(toAddress, true);
      const result = await (token as any).transfer(resolvedTo, amount);
      if (result.revert) throw new Error(`transfer reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    // Step 13: Transfer Ownership
    case 13: {
      const contractAddr = params['contractAddr'];
      const newOwner = params['newOwner'];
      if (!contractAddr) throw new Error('contractAddr is required');
      if (!newOwner) throw new Error('newOwner is required');
      const contract = getContract<IODORCContract>(
        contractAddr, OD_ORC_ABI, provider, network as any, senderAddress,
      );
      const resolvedOwner = await provider.getPublicKeyInfo(newOwner, true);
      const result = await (contract as any).transferOwnership(resolvedOwner);
      if (result.revert) throw new Error(`transferOwnership reverted: ${result.revert}`);
      const tx = await result.sendTransaction(txParams);
      return tx.transactionId;
    }

    default:
      throw new Error(`Step ${stepId} is not implemented`);
  }
}
