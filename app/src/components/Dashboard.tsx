import { useProtocol } from '../context/ProtocolContext';
import {
  formatPercent,
  formatUsd,
  formatBtc,
  formatU256,
  phaseName,
} from '../utils/format';
import '../styles/dashboard.css';

const RATIO_MIN = 400_000_000n; // 400%
const RATIO_MAX = 800_000_000n; // 800%

function healthPercent(ratio: bigint): number {
  if (ratio <= RATIO_MIN) return 0;
  if (ratio >= RATIO_MAX) return 100;
  const clamped = Number(ratio - RATIO_MIN);
  const range = Number(RATIO_MAX - RATIO_MIN);
  return Math.round((clamped / range) * 100);
}

export function Dashboard() {
  const {
    phase,
    reserveRatio,
    equity,
    twap,
    twapWindow,
    odSupply,
    orcSupply,
    wbtcReserve,
    loading,
    error,
  } = useProtocol();

  if (loading) {
    return <div className="dashboard-loading">Loading protocol data...</div>;
  }

  if (error) {
    return <div className="dashboard-error">{error}</div>;
  }

  const health = healthPercent(reserveRatio);

  return (
    <div className="dashboard">
      {/* Phase badge */}
      <span className="phase-badge">{phaseName(phase)}</span>

      {/* Stat cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-label">Reserve Ratio</div>
          <div className="stat-value">{formatPercent(reserveRatio)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TWAP Price</div>
          <div className="stat-value">{formatUsd(twap)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Equity</div>
          <div className="stat-value">{formatBtc(equity)}</div>
        </div>
      </div>

      {/* Detail grid */}
      <div className="detail-grid">
        <div className="detail-row">
          <span className="detail-label">Reserve WBTC</span>
          <span className="detail-value">{formatBtc(wbtcReserve)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">OD Supply</span>
          <span className="detail-value">{formatU256(odSupply)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">ORC Supply</span>
          <span className="detail-value">{formatU256(orcSupply)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">TWAP Window</span>
          <span className="detail-value">{twapWindow.toString()} blocks</span>
        </div>
      </div>

      {/* Health bar */}
      <div className="health-bar-container">
        <div className="health-bar-labels">
          <span>400%</span>
          <span>Reserve Health</span>
          <span>800%</span>
        </div>
        <div className="health-bar">
          <div
            className="health-bar-fill"
            style={{ width: `${health}%` }}
          />
        </div>
      </div>
    </div>
  );
}
