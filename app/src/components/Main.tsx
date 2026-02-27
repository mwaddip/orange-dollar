import { useState, useMemo, useCallback } from 'react';
import { JSONRpcProvider, getContract } from 'opnet';
import type { IOP20Contract, CallResult, BaseContractProperties } from 'opnet';
import type { Address } from '@btc-vision/transaction';
import { useProtocol } from '../context/ProtocolContext';
import { useContractCall } from '../hooks/useContractCall';
import type { TxStatus } from '../hooks/useContractCall';
import { OD_RESERVE_ABI } from '../abi/odReserve';
import { OD_ORC_ABI } from '../abi/op20';
import {
  formatU256,
  formatPercent,
  formatUsd,
  formatBtc,
  phaseName,
} from '../utils/format';
import '../styles/main.css';

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const SCALE = 100_000_000n;
const FEE_BPS = 150n;
const BPS_DENOM = 10_000n;
const RATIO_MIN = 400_000_000n;
const RATIO_MAX = 800_000_000n;

type Token = 'OD' | 'ORC';
type Action = 'Mint' | 'Burn';

interface IODReserveWrite extends BaseContractProperties {
  mintOD(wbtcAmount: bigint): Promise<CallResult>;
  mintORC(wbtcAmount: bigint): Promise<CallResult>;
  burnOD(odAmount: bigint): Promise<CallResult>;
  burnORC(orcAmount: bigint): Promise<CallResult>;
}

function parseAmount(value: string): bigint {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 0n;
  return BigInt(Math.floor(num * 1e8));
}

function statusLabel(status: TxStatus): string {
  switch (status) {
    case 'simulating': return 'Simulating...';
    case 'awaiting_approval': return 'Approve in wallet...';
    case 'broadcasting': return 'Broadcasting...';
    case 'confirmed': return 'Confirmed!';
    default: return '';
  }
}

function healthPct(ratio: bigint): number {
  if (ratio <= RATIO_MIN) return 0;
  if (ratio >= RATIO_MAX) return 100;
  return Math.round(Number(ratio - RATIO_MIN) / Number(RATIO_MAX - RATIO_MIN) * 100);
}

function healthLevel(pct: number): string {
  if (pct < 33) return 'low';
  if (pct < 66) return 'mid';
  return 'high';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Main() {
  const {
    phase, reserveRatio, equity, twap, twapWindow,
    odSupply, orcSupply, wbtcReserve,
    userOd, userOrc, userWbtc,
    connectedAddress, walletAddr, networkConfig, refresh,
    loading, error,
  } = useProtocol();

  const [token, setToken] = useState<Token>('OD');
  const [action, setAction] = useState<Action>('Mint');
  const [amount, setAmount] = useState('');

  const provider = useMemo(
    () => new JSONRpcProvider({ url: networkConfig.rpcUrl, network: networkConfig.network }),
    [networkConfig],
  );

  const mintBurn = useContractCall({
    network: networkConfig.network,
    refundTo: connectedAddress ?? '',
    onSuccess: () => { refresh(); setAmount(''); },
  });

  // -- Computed --
  const parsed = parseAmount(amount);
  const fee = (parsed * FEE_BPS) / BPS_DENOM;
  const afterFee = parsed > fee ? parsed - fee : 0n;

  const estimated = useMemo(() => {
    if (afterFee === 0n || twap === 0n) return 0n;
    if (action === 'Mint' && token === 'OD') return (afterFee * twap) / SCALE;
    if (action === 'Burn' && token === 'OD') return (afterFee * SCALE) / twap;
    return afterFee;
  }, [afterFee, twap, action, token]);

  const inputLabel = action === 'Mint' ? 'WBTC to spend' : `${token} to return`;
  const outputUnit = action === 'Mint' ? token : 'WBTC';

  const maxBal = useMemo(() => {
    if (action === 'Mint') return userWbtc;
    return token === 'OD' ? userOd : userOrc;
  }, [action, token, userWbtc, userOd, userOrc]);

  const handleMax = useCallback(() => {
    if (maxBal > 0n) setAmount((Number(maxBal) / 1e8).toString());
  }, [maxBal]);

  const handleExecute = useCallback(async () => {
    if (!connectedAddress || parsed === 0n) return;
    const { addresses } = networkConfig;
    mintBurn.reset();

    if (action === 'Mint') {
      await mintBurn.execute(async () => {
        const wbtc = getContract<IOP20Contract>(
          addresses.wbtc, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
        );
        const reserveAddress = await provider.getPublicKeyInfo(addresses.reserve, true);
        return wbtc.increaseAllowance(reserveAddress, parsed);
      });
      if (mintBurn.status === 'error') return;
      await mintBurn.execute(async () => {
        const r = getContract<IODReserveWrite>(
          addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
        );
        return token === 'OD' ? r.mintOD(parsed) : r.mintORC(parsed);
      });
    } else {
      const burnAddr = token === 'OD' ? addresses.od : addresses.orc;
      await mintBurn.execute(async () => {
        const tok = getContract<IOP20Contract>(
          burnAddr, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
        );
        const reserveAddress = await provider.getPublicKeyInfo(addresses.reserve, true);
        return tok.increaseAllowance(reserveAddress, parsed);
      });
      if (mintBurn.status === 'error') return;
      await mintBurn.execute(async () => {
        const r = getContract<IODReserveWrite>(
          addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
        );
        return token === 'OD' ? r.burnOD(parsed) : r.burnORC(parsed);
      });
    }
  }, [connectedAddress, parsed, networkConfig, provider, walletAddr, action, token, mintBurn]);

  const isBusy = mintBurn.status === 'simulating' || mintBurn.status === 'awaiting_approval' || mintBurn.status === 'broadcasting';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="od-main">
      {/* ===== Stats ribbon ===== */}
      <section className="stats-ribbon">
        <div className="stat grow">
          <span className="stat-label">Phase</span>
          <span className="stat-value phase-val">{loading ? '...' : phaseName(phase)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Reserve Ratio</span>
          <span className="stat-value">{loading ? '...' : formatPercent(reserveRatio)}</span>
        </div>
        <div className="stat grow">
          <span className="stat-label">TWAP</span>
          <span className="stat-value">{loading ? '...' : formatUsd(twap)}</span>
        </div>
        <div className="stat grow">
          <span className="stat-label">Equity</span>
          <span className="stat-value">{loading ? '...' : formatBtc(equity)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">WBTC Reserve</span>
          <span className="stat-value">{loading ? '...' : formatU256(wbtcReserve, 8)}</span>
        </div>
        <div className="stat grow">
          <span className="stat-label">OD Supply</span>
          <span className="stat-value">{loading ? '...' : formatU256(odSupply, 2)}</span>
        </div>
        <div className="stat grow">
          <span className="stat-label">ORC Supply</span>
          <span className="stat-value">{loading ? '...' : formatU256(orcSupply, 2)}</span>
        </div>
      </section>

      {/* ===== Health bar ===== */}
      {!loading && !error && (
        <section className="health-section">
          <div className="health-labels">
            <span>400%</span>
            <span>Reserve Health</span>
            <span>800%</span>
          </div>
          <div className="health-track">
            <div className={`health-fill ${healthLevel(healthPct(reserveRatio))}`} style={{ width: `${healthPct(reserveRatio)}%` }} />
          </div>
        </section>
      )}

      {error && <div className="main-error">{error}</div>}

      {/* ===== Mint / Burn ===== */}
      <section className="action-section">
        <div className="action-panel">
          <div className="action-header">
            <div className="seg-group">
              <button className={`seg-btn ${token === 'OD' ? 'active' : ''}`}
                onClick={() => { setToken('OD'); setAmount(''); mintBurn.reset(); }}>OD</button>
              <button className={`seg-btn ${token === 'ORC' ? 'active' : ''}`}
                onClick={() => { setToken('ORC'); setAmount(''); mintBurn.reset(); }}>ORC</button>
            </div>
            <div className="seg-group">
              <button className={`seg-btn ${action === 'Mint' ? 'active' : ''}`}
                onClick={() => { setAction('Mint'); setAmount(''); mintBurn.reset(); }}>Mint</button>
              <button className={`seg-btn ${action === 'Burn' ? 'active' : ''}`}
                onClick={() => { setAction('Burn'); setAmount(''); mintBurn.reset(); }}>Burn</button>
            </div>
          </div>

          <div className="action-body">
            <div className="input-group">
              <label>{inputLabel}</label>
              <div className="input-wrap">
                <input
                  type="number" min="0" step="any" placeholder="0.00"
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                />
                {connectedAddress && <button className="max-btn" onClick={handleMax}>MAX</button>}
              </div>
            </div>

            <div className="info-rows">
              <div className="info-row">
                <span>{outputUnit} (est.)</span>
                <span className="info-val">{parsed > 0n ? formatU256(estimated, 4) : '--'}</span>
              </div>
              <div className="info-row">
                <span>Fee (1.5%)</span>
                <span className="info-val">{parsed > 0n ? formatU256(fee, 4) : '--'}</span>
              </div>
              <div className="info-row">
                <span>TWAP Window</span>
                <span className="info-val">{twapWindow > 0n ? `${twapWindow} blocks` : '--'}</span>
              </div>
            </div>

            {!connectedAddress && <p className="hint">Connect wallet to continue</p>}

            <button className="execute-btn" disabled={!connectedAddress || parsed === 0n || isBusy}
              onClick={handleExecute}>
              {isBusy ? statusLabel(mintBurn.status) : `${action} ${token}`}
            </button>

            {mintBurn.status === 'confirmed' && (
              <div className="status-msg confirmed">Transaction confirmed!</div>
            )}
            {mintBurn.status === 'error' && (
              <div className="status-msg error" onClick={mintBurn.reset}>
                {mintBurn.error || 'Unknown error'}
              </div>
            )}
          </div>
        </div>

        {/* Balances sidebar */}
        <div className="balances-panel">
          <h3 className="panel-title">Your Balances</h3>
          {connectedAddress ? (
            <div className="bal-list">
              <div className="bal-row"><span>WBTC</span><span>{formatU256(userWbtc, 8)}</span></div>
              <div className="bal-row"><span>OD</span><span>{formatU256(userOd, 4)}</span></div>
              <div className="bal-row"><span>ORC</span><span>{formatU256(userOrc, 4)}</span></div>
            </div>
          ) : (
            <p className="hint">Connect wallet</p>
          )}
        </div>
      </section>
    </div>
  );
}
