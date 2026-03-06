/**
 * Bootstrap step definitions shared by Admin and OfflineSigner.
 */

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

export interface StepDef {
  id: number;
  title: string;
  description: string;
  /** The contract method name (for threshold message construction). */
  method: string;
  /** Phases during which this step is relevant (actionable). */
  phases: number[];
  /** Whether this step requires external action (not a contract call). */
  external?: boolean;
  /** Parameter fields this step needs. */
  params?: { key: string; label: string; placeholder: string }[];
  /** When set, the target contract is taken from this param key instead of the address map. */
  contractParam?: string;
}

export const STEPS: StepDef[] = [
  {
    id: 0,
    title: 'setReserve on OD',
    description: 'Link the OD token contract to the ODReserve address.',
    method: 'setReserve',
    phases: [0],
    params: [
      { key: 'reserveAddr', label: 'Reserve Address', placeholder: '0x...' },
    ],
  },
  {
    id: 1,
    title: 'setReserve on ORC',
    description: 'Link the ORC token contract to the ODReserve address.',
    method: 'setReserve',
    phases: [0],
    params: [
      { key: 'reserveAddr', label: 'Reserve Address', placeholder: '0x...' },
    ],
  },
  {
    id: 2,
    title: 'Approve WBTC for Reserve',
    description: 'Approve the ODReserve contract to spend WBTC on your behalf.',
    method: 'increaseAllowance',
    phases: [0],
    params: [
      { key: 'wbtcAmount', label: 'WBTC Amount (e.g. 1.5 = 1.5 WBTC)', placeholder: '1.5' },
    ],
  },
  {
    id: 3,
    title: 'Seed (mintORC with WBTC)',
    description: 'Deposit WBTC to mint initial ORC supply.',
    method: 'mintORC',
    phases: [0],
    params: [
      { key: 'wbtcAmount', label: 'WBTC Amount (e.g. 1.5 = 1.5 WBTC)', placeholder: '1.5' },
    ],
  },
  {
    id: 4,
    title: 'Advance Phase (set seed price)',
    description: 'Move from SEEDING to PREMINT. Provide the initial OD price in USD (e.g. 1 = $1.00).',
    method: 'advancePhase',
    phases: [0],
    params: [
      { key: 'seedPrice', label: 'Seed Price (USD)', placeholder: '1' },
    ],
  },
  {
    id: 5,
    title: 'Premint OD',
    description: 'Mint the initial OD supply for liquidity pool creation.',
    method: 'premintOD',
    phases: [1],
    params: [
      { key: 'odAmount', label: 'OD Amount (e.g. 1000 = 1000 OD)', placeholder: '1000' },
    ],
  },
  {
    id: 6,
    title: 'Approve OD for MotoSwap Router',
    description: 'Approve the MotoSwap Router to spend OD for liquidity provisioning.',
    method: 'increaseAllowance',
    phases: [1],
    params: [
      { key: 'odAmount', label: 'OD Amount (e.g. 1000 = 1000 OD)', placeholder: '1000' },
    ],
  },
  {
    id: 7,
    title: 'Approve WBTC for MotoSwap Router',
    description: 'Approve the MotoSwap Router to spend WBTC for liquidity provisioning.',
    method: 'increaseAllowance',
    phases: [1],
    params: [
      { key: 'wbtcAmount', label: 'WBTC Amount (e.g. 1.5 = 1.5 WBTC)', placeholder: '1.5' },
    ],
  },
  {
    id: 8,
    title: 'Add Liquidity to MotoSwap',
    description: 'Add the preminted OD and WBTC to MotoSwap as a liquidity pool. Use the MotoSwap UI or router contract directly.',
    method: 'addLiquidity',
    phases: [1],
    external: true,
  },
  {
    id: 9,
    title: 'Initialize Pool on ODReserve',
    description: 'Register the MotoSwap WBTC/OD pool address in the reserve contract.',
    method: 'initPool',
    phases: [1],
    params: [
      { key: 'poolAddress', label: 'MotoSwap Pool Address', placeholder: '0x...' },
    ],
  },
  {
    id: 10,
    title: 'Update TWAP Snapshot',
    description: 'Take the first TWAP snapshot from the MotoSwap pool.',
    method: 'updateTwapSnapshot',
    phases: [1],
  },
  {
    id: 11,
    title: 'Final Advance Phase',
    description: 'Move from PREMINT to LIVE. The protocol becomes fully operational.',
    method: 'advancePhase',
    phases: [1],
  },
  {
    id: 12,
    title: 'Transfer OP-20 Tokens',
    description: 'Send OP-20 tokens to a destination address (e.g. distribute ORC to investors).',
    method: 'transfer',
    phases: [0, 1, 2],
    contractParam: 'contractAddr',
    params: [
      { key: 'contractAddr', label: 'Token Contract Address', placeholder: '0x...' },
      { key: 'toAddress', label: 'Destination Address', placeholder: '0x...' },
      { key: 'amount', label: 'Amount (e.g. 500 = 500 tokens)', placeholder: '500' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AddressMap {
  od: string;
  orc: string;
  reserve: string;
  wbtc: string;
  router: string;
}

/** Get the target contract address for a step. */
export function getStepContract(
  step: StepDef,
  addresses: AddressMap,
  inputs?: Record<string, string>,
): string {
  // Dynamic contract: the target comes from a user-provided param
  if (step.contractParam && inputs) {
    return inputs[`${step.contractParam}_${step.id}`] || '';
  }
  switch (step.id) {
    case 0: return addresses.od;
    case 1: return addresses.orc;
    case 2: return addresses.wbtc;
    case 6: return addresses.od;
    case 7: return addresses.wbtc;
    default: return addresses.reserve;
  }
}

/**
 * Build a deterministic message for threshold signing.
 * SHA-256 of a canonical JSON payload describing the operation.
 */
export async function buildStepMessage(
  stepId: number,
  method: string,
  contract: string,
  params: Record<string, string>,
): Promise<Uint8Array> {
  const payload = JSON.stringify({
    step: stepId,
    method,
    contract,
    params,
  }, Object.keys({ step: 0, method: '', contract: '', params: {} }));

  const encoded = new TextEncoder().encode(payload);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hashBuf);
}
