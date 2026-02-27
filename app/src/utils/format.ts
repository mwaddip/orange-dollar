const SCALE = 100_000_000n;

/** Format a u256 (1e8 scale) as a human-readable number. */
export function formatU256(value: bigint, decimals = 2): string {
  const whole = value / SCALE;
  const frac = value % SCALE;
  const fracStr = frac.toString().padStart(8, '0').slice(0, decimals);
  return `${whole.toLocaleString()}.${fracStr}`;
}

/** Format as a percentage (400_000_000 = 400.0%). */
export function formatPercent(value: bigint, decimals = 1): string {
  if (value > 100_000_000_000n) return '—'; // u256.MAX / div-by-zero guard
  return formatU256(value, decimals) + '%';
}

/** Format as USD price (1e8 scale). */
export function formatUsd(value: bigint, decimals = 2): string {
  return '$' + formatU256(value, decimals);
}

/** Format as BTC (1e8 scale, 8 decimals). */
export function formatBtc(value: bigint): string {
  return formatU256(value, 8) + ' BTC';
}

/** Phase number to name. */
export function phaseName(phase: number): string {
  switch (phase) {
    case 0: return 'SEEDING';
    case 1: return 'PREMINT';
    case 2: return 'LIVE';
    default: return 'UNKNOWN';
  }
}
