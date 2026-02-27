import { useCallback } from 'react';
import { JSONRpcProvider, getContract } from 'opnet';
import type { BaseContractProperties, CallResult } from 'opnet';
import type { Address } from '@btc-vision/transaction';
import { useProtocol } from '../context/ProtocolContext';
import { useToast } from '../context/ToastContext';
import { useContractCall } from '../hooks/useContractCall';
import type { TxStatus } from '../hooks/useContractCall';
import { MOCK_WBTC_ABI } from '../abi/mockWbtc';
import { formatBtc } from '../utils/format';
import '../styles/faucet.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IMockWbtcContract extends BaseContractProperties {
  mint(to: Address, amount: bigint): Promise<CallResult>;
}

const ONE_WBTC = 100_000_000n; // 1e8

function statusLabel(status: TxStatus): string {
  switch (status) {
    case 'simulating': return 'Simulating...';
    case 'awaiting_approval': return 'Approve in wallet...';
    case 'broadcasting': return 'Broadcasting...';
    case 'confirmed': return 'Claimed!';
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Faucet() {
  const {
    networkConfig,
    connectedAddress,
    walletAddr,
    userWbtc,
    refresh,
  } = useProtocol();
  const { addToast } = useToast();

  const { network, rpcUrl, addresses } = networkConfig;

  const txCall = useContractCall({
    network,
    refundTo: connectedAddress ?? '',
    onSuccess: () => {
      addToast('1 WBTC claimed!', 'success');
      refresh();
    },
  });

  const handleClaim = useCallback(async () => {
    if (!connectedAddress || !walletAddr || !addresses.wbtc) return;

    const provider = new JSONRpcProvider({ url: rpcUrl, network });
    const wbtc = getContract<IMockWbtcContract>(
      addresses.wbtc,
      MOCK_WBTC_ABI,
      provider,
      network,
      walletAddr,
    );

    await txCall.execute(async () =>
      wbtc.mint(walletAddr, ONE_WBTC),
    );
  }, [connectedAddress, walletAddr, addresses.wbtc, rpcUrl, network, txCall]);

  const busy = txCall.status !== 'idle' && txCall.status !== 'confirmed' && txCall.status !== 'error';

  return (
    <div className="faucet">
      <div className="faucet-card">
        <h2 className="faucet-title">WBTC Faucet</h2>
        <p className="faucet-subtitle">
          Claim 1 test WBTC every ~24 hours (144 blocks)
        </p>

        {connectedAddress ? (
          <>
            <div className="faucet-balance">
              <span className="faucet-balance-label">Your Balance</span>
              <span className="faucet-balance-value">{formatBtc(userWbtc)}</span>
            </div>

            <button
              className="faucet-claim-btn"
              onClick={handleClaim}
              disabled={busy || !addresses.wbtc}
            >
              {busy ? statusLabel(txCall.status) : 'Claim 1 WBTC'}
            </button>

            {txCall.status === 'confirmed' && (
              <div className="faucet-status confirmed">Claimed!</div>
            )}

            {txCall.status === 'error' && txCall.error && (
              <div className="faucet-status error" onClick={txCall.reset}>
                {txCall.error}
              </div>
            )}
          </>
        ) : (
          <p className="faucet-connect-msg">Connect your wallet to claim test WBTC.</p>
        )}
      </div>
    </div>
  );
}
