import { useState, useMemo, useCallback } from 'react';
import { JSONRpcProvider, getContract } from 'opnet';
import type { IOP20Contract, CallResult, BaseContractProperties } from 'opnet';
import { Address } from '@btc-vision/transaction';
import { useProtocol } from '../context/ProtocolContext';
import { useContractCall } from '../hooks/useContractCall';
import type { TxStatus } from '../hooks/useContractCall';
import { OD_RESERVE_ABI } from '../abi/odReserve';
import { OD_ORC_ABI } from '../abi/op20';
import { formatU256 } from '../utils/format';
import '../styles/trade.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCALE = 100_000_000n;
const FEE_BPS = 150n; // 1.5% = 150 basis points
const BPS_DENOM = 10_000n;

type Token = 'OD' | 'ORC';
type Action = 'Mint' | 'Burn';
type TransferToken = 'OD' | 'ORC' | 'WBTC';

// ---------------------------------------------------------------------------
// Reserve contract interface (write methods)
// ---------------------------------------------------------------------------

interface IODReserveWriteContract extends BaseContractProperties {
  mintOD(wbtcAmount: bigint): Promise<CallResult>;
  mintORC(wbtcAmount: bigint): Promise<CallResult>;
  burnOD(odAmount: bigint): Promise<CallResult>;
  burnORC(orcAmount: bigint): Promise<CallResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a human-readable amount string to 1e8-scale bigint. */
function parseAmount(value: string): bigint {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 0n;
  return BigInt(Math.floor(num * 1e8));
}

/** Status label for the transaction lifecycle. */
function statusLabel(status: TxStatus): string {
  switch (status) {
    case 'simulating':
      return 'Simulating transaction...';
    case 'awaiting_approval':
      return 'Approve in your wallet...';
    case 'broadcasting':
      return 'Broadcasting...';
    case 'confirmed':
      return 'Transaction confirmed!';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Trade Component
// ---------------------------------------------------------------------------

export function Trade() {
  const {
    connectedAddress,
    networkConfig,
    twap,
    userOd,
    userOrc,
    userWbtc,
    refresh,
  } = useProtocol();

  // -- Mint / Burn state --
  const [token, setToken] = useState<Token>('OD');
  const [action, setAction] = useState<Action>('Mint');
  const [amount, setAmount] = useState('');

  // -- Transfer state --
  const [transferToken, setTransferToken] = useState<TransferToken>('OD');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');

  // -- Approve (increaseAllowance) state --
  const [approveToken, setApproveToken] = useState<TransferToken>('WBTC');
  const [approveSpender, setApproveSpender] = useState('');
  const [approveAmount, setApproveAmount] = useState('');

  // -- Provider (memoised on network change) --
  const provider = useMemo(
    () =>
      new JSONRpcProvider({
        url: networkConfig.rpcUrl,
        network: networkConfig.network,
      }),
    [networkConfig],
  );

  // -- Sender address --
  const senderAddress = useMemo(
    () => (connectedAddress ? Address.fromString(connectedAddress) : undefined),
    [connectedAddress],
  );

  // -- Contract call hooks --
  const mintBurn = useContractCall({
    network: networkConfig.network,
    refundTo: connectedAddress ?? '',
    onSuccess: () => {
      refresh();
      setAmount('');
    },
  });

  const transferCall = useContractCall({
    network: networkConfig.network,
    refundTo: connectedAddress ?? '',
    onSuccess: () => {
      refresh();
      setTransferAmount('');
      setTransferTo('');
    },
  });

  const approveCall = useContractCall({
    network: networkConfig.network,
    refundTo: connectedAddress ?? '',
    onSuccess: () => {
      refresh();
      setApproveAmount('');
      setApproveSpender('');
    },
  });

  // -- Resolve token address --
  const tokenAddress = useCallback(
    (t: TransferToken): string => {
      switch (t) {
        case 'OD':
          return networkConfig.addresses.od;
        case 'ORC':
          return networkConfig.addresses.orc;
        case 'WBTC':
          return networkConfig.addresses.wbtc;
      }
    },
    [networkConfig],
  );

  // -- Estimated output & fee for mint/burn --
  const parsedAmount = parseAmount(amount);

  const fee = (parsedAmount * FEE_BPS) / BPS_DENOM;
  const afterFee = parsedAmount > fee ? parsedAmount - fee : 0n;

  // Rough estimated output:
  //  - Mint OD: afterFee (WBTC) * twap / SCALE  (WBTC -> OD at TWAP price)
  //  - Burn OD: afterFee (OD) * SCALE / twap     (OD -> WBTC)
  //  - Mint ORC: afterFee WBTC in, receive ORC (ratio depends on equity — show "~" approx)
  //  - Burn ORC: similar
  const estimatedOutput = useMemo(() => {
    if (afterFee === 0n || twap === 0n) return 0n;
    if (action === 'Mint' && token === 'OD') {
      // WBTC in -> OD out: amount_wbtc * twap / 1e8
      return (afterFee * twap) / SCALE;
    }
    if (action === 'Burn' && token === 'OD') {
      // OD in -> WBTC out: amount_od * 1e8 / twap
      return (afterFee * SCALE) / twap;
    }
    // ORC: difficult to estimate without on-chain equity query — show input minus fee
    return afterFee;
  }, [afterFee, twap, action, token]);

  const inputLabel = action === 'Mint' ? 'WBTC to spend' : `${token} to burn`;
  const outputLabel =
    action === 'Mint' ? `${token} (estimated)` : 'WBTC (estimated)';

  // -- Max balance for input --
  const maxBalance = useMemo(() => {
    if (action === 'Mint') return userWbtc;
    return token === 'OD' ? userOd : userOrc;
  }, [action, token, userWbtc, userOd, userOrc]);

  const handleSetMax = useCallback(() => {
    if (maxBalance > 0n) {
      const whole = Number(maxBalance) / 1e8;
      setAmount(whole.toString());
    }
  }, [maxBalance]);

  // ---------------------------------------------------------------------------
  // Mint / Burn handler
  // ---------------------------------------------------------------------------
  const handleExecute = useCallback(async () => {
    if (!connectedAddress || parsedAmount === 0n) return;

    const { addresses } = networkConfig;

    mintBurn.reset();

    if (action === 'Mint') {
      // Step 1: Approve ODReserve to spend WBTC (increaseAllowance)
      // We do this as a separate tx first, then mint.
      // For simplicity, we always do approval for the exact amount.
      await mintBurn.execute(async () => {
        const wbtcContract = getContract<IOP20Contract>(
          addresses.wbtc,
          OD_ORC_ABI,
          provider,
          networkConfig.network,
          senderAddress,
        );
        return wbtcContract.increaseAllowance(
          Address.fromString(addresses.reserve),
          parsedAmount,
        );
      });

      // If approval failed, bail out
      if (mintBurn.status === 'error') return;

      // Step 2: Mint
      await mintBurn.execute(async () => {
        const reserve = getContract<IODReserveWriteContract>(
          addresses.reserve,
          OD_RESERVE_ABI,
          provider,
          networkConfig.network,
          senderAddress,
        );
        return token === 'OD'
          ? reserve.mintOD(parsedAmount)
          : reserve.mintORC(parsedAmount);
      });
    } else {
      // Burn — no approval needed (reserve burns from caller)
      // But user must approve reserve to spend their OD/ORC
      const burnTokenAddr =
        token === 'OD' ? addresses.od : addresses.orc;

      // Step 1: Approve reserve to spend OD/ORC
      await mintBurn.execute(async () => {
        const tokenContract = getContract<IOP20Contract>(
          burnTokenAddr,
          OD_ORC_ABI,
          provider,
          networkConfig.network,
          senderAddress,
        );
        return tokenContract.increaseAllowance(
          Address.fromString(addresses.reserve),
          parsedAmount,
        );
      });

      if (mintBurn.status === 'error') return;

      // Step 2: Burn
      await mintBurn.execute(async () => {
        const reserve = getContract<IODReserveWriteContract>(
          addresses.reserve,
          OD_RESERVE_ABI,
          provider,
          networkConfig.network,
          senderAddress,
        );
        return token === 'OD'
          ? reserve.burnOD(parsedAmount)
          : reserve.burnORC(parsedAmount);
      });
    }
  }, [
    connectedAddress,
    parsedAmount,
    networkConfig,
    provider,
    senderAddress,
    action,
    token,
    mintBurn,
  ]);

  // ---------------------------------------------------------------------------
  // Transfer handler
  // ---------------------------------------------------------------------------
  const handleTransfer = useCallback(async () => {
    if (!connectedAddress) return;
    const amt = parseAmount(transferAmount);
    if (amt === 0n || !transferTo) return;

    transferCall.reset();

    await transferCall.execute(async () => {
      const addr = tokenAddress(transferToken);
      const contract = getContract<IOP20Contract>(
        addr,
        OD_ORC_ABI,
        provider,
        networkConfig.network,
        senderAddress,
      );
      return contract.transfer(Address.fromString(transferTo), amt);
    });
  }, [
    connectedAddress,
    transferAmount,
    transferTo,
    transferToken,
    transferCall,
    tokenAddress,
    provider,
    networkConfig,
    senderAddress,
  ]);

  // ---------------------------------------------------------------------------
  // Approve (increaseAllowance) handler
  // ---------------------------------------------------------------------------
  const handleApprove = useCallback(async () => {
    if (!connectedAddress) return;
    const amt = parseAmount(approveAmount);
    if (amt === 0n || !approveSpender) return;

    approveCall.reset();

    await approveCall.execute(async () => {
      const addr = tokenAddress(approveToken);
      const contract = getContract<IOP20Contract>(
        addr,
        OD_ORC_ABI,
        provider,
        networkConfig.network,
        senderAddress,
      );
      return contract.increaseAllowance(
        Address.fromString(approveSpender),
        amt,
      );
    });
  }, [
    connectedAddress,
    approveAmount,
    approveSpender,
    approveToken,
    approveCall,
    tokenAddress,
    provider,
    networkConfig,
    senderAddress,
  ]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function renderStatus(status: TxStatus, error: string | null, reset: () => void) {
    if (status === 'idle') return null;

    if (status === 'error') {
      return (
        <div className="trade-status error" onClick={reset} title="Click to dismiss">
          {error || 'Unknown error'}
        </div>
      );
    }

    return (
      <div className={`trade-status ${status}`}>
        {statusLabel(status)}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------
  return (
    <div className="trade">
      {/* ===== Section A: Mint / Burn Panel ===== */}
      <div className="trade-card">
        {/* Token toggle */}
        <div className="pill-group">
          <button
            className={`pill-btn ${token === 'OD' ? 'active' : ''}`}
            onClick={() => { setToken('OD'); setAmount(''); mintBurn.reset(); }}
          >
            OD
          </button>
          <button
            className={`pill-btn ${token === 'ORC' ? 'active' : ''}`}
            onClick={() => { setToken('ORC'); setAmount(''); mintBurn.reset(); }}
          >
            ORC
          </button>
        </div>

        {/* Action toggle */}
        <div className="pill-group">
          <button
            className={`pill-btn ${action === 'Mint' ? 'active' : ''}`}
            onClick={() => { setAction('Mint'); setAmount(''); mintBurn.reset(); }}
          >
            Mint
          </button>
          <button
            className={`pill-btn ${action === 'Burn' ? 'active' : ''}`}
            onClick={() => { setAction('Burn'); setAmount(''); mintBurn.reset(); }}
          >
            Burn
          </button>
        </div>

        {/* Amount input */}
        <div className="trade-field">
          <label>{inputLabel}</label>
          <div className="input-with-max">
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {connectedAddress && (
              <button className="max-btn" onClick={handleSetMax}>
                MAX
              </button>
            )}
          </div>
        </div>

        {/* Info rows */}
        <div className="trade-info">
          <div className="trade-info-row">
            <span className="info-label">{outputLabel}</span>
            <span className="info-value">
              {parsedAmount > 0n ? formatU256(estimatedOutput, 4) : '--'}
            </span>
          </div>
          <div className="trade-info-row">
            <span className="info-label">Fee (1.5%)</span>
            <span className="info-value">
              {parsedAmount > 0n ? formatU256(fee, 4) : '--'}
            </span>
          </div>
          <div className="trade-info-row">
            <span className="info-label">TWAP Rate</span>
            <span className="info-value">
              {twap > 0n ? formatU256(twap, 4) : '--'}
            </span>
          </div>
        </div>

        {/* Execute button */}
        {!connectedAddress && (
          <p className="trade-not-connected">Connect wallet to trade</p>
        )}
        <button
          className="trade-execute-btn"
          disabled={
            !connectedAddress ||
            parsedAmount === 0n ||
            mintBurn.status === 'simulating' ||
            mintBurn.status === 'awaiting_approval' ||
            mintBurn.status === 'broadcasting'
          }
          onClick={handleExecute}
        >
          {mintBurn.status === 'simulating' || mintBurn.status === 'awaiting_approval' || mintBurn.status === 'broadcasting'
            ? statusLabel(mintBurn.status)
            : `${action} ${token}`}
        </button>

        {renderStatus(mintBurn.status, mintBurn.error, mintBurn.reset)}
      </div>

      {/* ===== Section B: Your Balances ===== */}
      <h3 className="trade-section-title">Your Balances</h3>
      <div className="trade-card">
        {connectedAddress ? (
          <div className="balance-grid">
            <div className="balance-item">
              <div className="balance-token">WBTC</div>
              <div className="balance-amount">{formatU256(userWbtc, 4)}</div>
            </div>
            <div className="balance-item">
              <div className="balance-token">OD</div>
              <div className="balance-amount">{formatU256(userOd, 4)}</div>
            </div>
            <div className="balance-item">
              <div className="balance-token">ORC</div>
              <div className="balance-amount">{formatU256(userOrc, 4)}</div>
            </div>
          </div>
        ) : (
          <p className="trade-not-connected">Connect wallet to view balances</p>
        )}
      </div>

      {/* ===== Section C: Transfer & Approve ===== */}
      <h3 className="trade-section-title">Transfer &amp; Approve</h3>
      <div className="trade-card">
        {/* -- Transfer -- */}
        <div className="trade-subsection">
          <div className="trade-subsection-title">Transfer</div>

          <div className="trade-field">
            <label>Token</label>
            <select
              value={transferToken}
              onChange={(e) => setTransferToken(e.target.value as TransferToken)}
            >
              <option value="OD">OD</option>
              <option value="ORC">ORC</option>
              <option value="WBTC">WBTC</option>
            </select>
          </div>

          <div className="trade-field">
            <label>Recipient Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            />
          </div>

          <div className="trade-field">
            <label>Amount</label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
            />
          </div>

          <button
            className="trade-secondary-btn"
            disabled={
              !connectedAddress ||
              !transferTo ||
              parseAmount(transferAmount) === 0n ||
              transferCall.status === 'simulating' ||
              transferCall.status === 'awaiting_approval' ||
              transferCall.status === 'broadcasting'
            }
            onClick={handleTransfer}
          >
            {transferCall.status === 'simulating' || transferCall.status === 'awaiting_approval'
              ? statusLabel(transferCall.status)
              : 'Send'}
          </button>

          {renderStatus(transferCall.status, transferCall.error, transferCall.reset)}
        </div>

        {/* -- Approve (increaseAllowance) -- */}
        <div className="trade-subsection">
          <div className="trade-subsection-title">Approve (Increase Allowance)</div>

          <div className="trade-field">
            <label>Token</label>
            <select
              value={approveToken}
              onChange={(e) => setApproveToken(e.target.value as TransferToken)}
            >
              <option value="OD">OD</option>
              <option value="ORC">ORC</option>
              <option value="WBTC">WBTC</option>
            </select>
          </div>

          <div className="trade-field">
            <label>Spender Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={approveSpender}
              onChange={(e) => setApproveSpender(e.target.value)}
            />
          </div>

          <div className="trade-field">
            <label>Amount</label>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={approveAmount}
              onChange={(e) => setApproveAmount(e.target.value)}
            />
          </div>

          <button
            className="trade-secondary-btn"
            disabled={
              !connectedAddress ||
              !approveSpender ||
              parseAmount(approveAmount) === 0n ||
              approveCall.status === 'simulating' ||
              approveCall.status === 'awaiting_approval' ||
              approveCall.status === 'broadcasting'
            }
            onClick={handleApprove}
          >
            {approveCall.status === 'simulating' || approveCall.status === 'awaiting_approval'
              ? statusLabel(approveCall.status)
              : 'Approve'}
          </button>

          {renderStatus(approveCall.status, approveCall.error, approveCall.reset)}
        </div>
      </div>
    </div>
  );
}
