import { useState, useCallback } from 'react';
import type { Network } from '@btc-vision/bitcoin';
import type { CallResult, InteractionTransactionReceipt } from 'opnet';

/**
 * Transaction lifecycle status.
 *
 * - idle: no transaction in progress
 * - simulating: contract method is being called (read-only simulation)
 * - awaiting_approval: simulation succeeded, wallet popup is open for user to sign
 * - broadcasting: signed transaction is being broadcast to the network
 * - confirmed: transaction was accepted by peers
 * - error: simulation reverted or broadcast failed
 */
export type TxStatus =
  | 'idle'
  | 'simulating'
  | 'awaiting_approval'
  | 'broadcasting'
  | 'confirmed'
  | 'error';

/** Parameters the hook needs from the caller (avoids hard dependency on ProtocolContext). */
export interface UseContractCallOptions {
  /** Bitcoin network object (e.g. networks.testnet). */
  network: Network;
  /** The connected wallet's p2tr (taproot) address — used as refundTo. */
  refundTo: string;
  /** Fee rate in sat/vbyte. Defaults to 2 if omitted. */
  feeRate?: number;
  /** Priority fee in satoshis. Defaults to 1000n if omitted. */
  priorityFee?: bigint;
  /** Maximum satoshis the user is willing to spend on fees. Defaults to 100_000n. */
  maximumAllowedSatToSpend?: bigint;
  /** Called after a successful broadcast (e.g. to refresh balances). */
  onSuccess?: (receipt: InteractionTransactionReceipt) => void;
}

export interface UseContractCallReturn {
  status: TxStatus;
  error: string | null;
  /** Kick off simulate-then-send flow. */
  execute: (simulateFn: () => Promise<CallResult>) => Promise<void>;
  /** Reset state back to idle. */
  reset: () => void;
}

/**
 * Generic hook that wraps the OPNet simulate-then-send pattern:
 *
 * 1. Call a contract method (simulation).
 * 2. Check for revert.
 * 3. Call `sendTransaction` with `signer: null, mldsaSigner: null` so OPWallet signs.
 * 4. Track status through the full lifecycle.
 *
 * Usage:
 * ```ts
 * const { status, error, execute, reset } = useContractCall({
 *   network: config.network,
 *   refundTo: walletAddress,
 * });
 *
 * const handleMint = () =>
 *   execute(async () => {
 *     const contract = getContract<IOP20Contract>(addr, abi, provider, network, sender);
 *     return contract.mint(recipient, amount);
 *   });
 * ```
 */
export function useContractCall(options: UseContractCallOptions): UseContractCallReturn {
  const {
    network,
    refundTo,
    feeRate = 2,
    priorityFee = 1000n,
    maximumAllowedSatToSpend = 100_000n,
    onSuccess,
  } = options;

  const [status, setStatus] = useState<TxStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const execute = useCallback(
    async (simulateFn: () => Promise<CallResult>) => {
      try {
        // --- Step 1: Simulate ---
        setStatus('simulating');
        setError(null);

        let simulation: CallResult;
        try {
          simulation = await simulateFn();
        } catch (err: unknown) {
          // The opnet Contract class throws on revert with "Execution Reverted: <reason>"
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setStatus('error');
          return;
        }

        // --- Step 2: Check for revert (belt-and-suspenders — Contract already throws) ---
        if (simulation.revert) {
          setError(`Simulation reverted: ${simulation.revert}`);
          setStatus('error');
          return;
        }

        // --- Step 3: Send transaction (OPWallet signs) ---
        setStatus('awaiting_approval');

        const receipt = await simulation.sendTransaction({
          signer: null,
          mldsaSigner: null,
          refundTo,
          network,
          feeRate,
          priorityFee,
          maximumAllowedSatToSpend,
        });

        // --- Step 4: Broadcast succeeded ---
        setStatus('broadcasting');

        // The receipt already exists at this point — sendTransaction both signs and broadcasts.
        // We transition quickly through broadcasting to confirmed.
        setStatus('confirmed');

        if (onSuccess) {
          onSuccess(receipt);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error');
      }
    },
    [network, refundTo, feeRate, priorityFee, maximumAllowedSatToSpend, onSuccess],
  );

  return { status, error, execute, reset };
}
