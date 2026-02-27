import { useState, useMemo, useCallback } from 'react';
import { JSONRpcProvider, getContract } from 'opnet';
import type { IOP20Contract, CallResult, BaseContractProperties } from 'opnet';
import type { Address } from '@btc-vision/transaction';
import { useProtocol } from '../context/ProtocolContext';
import { useContractCall } from '../hooks/useContractCall';
import type { TxStatus } from '../hooks/useContractCall';
import { useToast } from '../context/ToastContext';
import { OD_RESERVE_ABI } from '../abi/odReserve';
import { OD_ORC_ABI } from '../abi/op20';
import {
  formatPercent,
  formatUsd,
  formatBtc,
  formatU256,
  phaseName,
} from '../utils/format';
import { ShareGate, ThresholdSign } from './ThresholdSign';
import '../styles/admin.css';

// ---------------------------------------------------------------------------
// Reserve contract interface (admin/bootstrap methods)
// ---------------------------------------------------------------------------

interface IODReserveAdminContract extends BaseContractProperties {
  advancePhase(seedPrice: bigint): Promise<CallResult>;
  premintOD(odAmount: bigint): Promise<CallResult>;
  mintORC(wbtcAmount: bigint): Promise<CallResult>;
  initPool(poolAddress: Address): Promise<CallResult>;
  updateTwapSnapshot(): Promise<CallResult>;
}

// ---------------------------------------------------------------------------
// OP-20 with setReserve
// ---------------------------------------------------------------------------

interface IOP20WithSetReserve extends IOP20Contract {
  setReserve(reserve: Address): Promise<CallResult>;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const SCALE = 100_000_000n;

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
      return 'Simulating...';
    case 'awaiting_approval':
      return 'Approve in wallet...';
    case 'broadcasting':
      return 'Broadcasting...';
    case 'confirmed':
      return 'Confirmed!';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface StepDef {
  id: number;
  title: string;
  description: string;
  /** Phases during which this step is relevant (actionable). */
  phases: number[];
  /** Whether this step requires external action (not a contract call). */
  external?: boolean;
  /** Parameter fields this step needs. */
  params?: { key: string; label: string; placeholder: string }[];
}

const STEPS: StepDef[] = [
  {
    id: 0,
    title: 'setReserve on OD',
    description: 'Link the OD token contract to the ODReserve address.',
    phases: [0],
    params: [
      { key: 'reserveAddr', label: 'Reserve Address', placeholder: '0x...' },
    ],
  },
  {
    id: 1,
    title: 'setReserve on ORC',
    description: 'Link the ORC token contract to the ODReserve address.',
    phases: [0],
    params: [
      { key: 'reserveAddr', label: 'Reserve Address', placeholder: '0x...' },
    ],
  },
  {
    id: 2,
    title: 'Seed (mintORC with WBTC)',
    description: 'Deposit WBTC to mint initial ORC supply. Requires WBTC approval first.',
    phases: [0],
    params: [
      { key: 'wbtcAmount', label: 'WBTC Amount', placeholder: '0.00' },
    ],
  },
  {
    id: 3,
    title: 'Advance Phase (set seed price)',
    description: 'Move from SEEDING to PREMINT. Provide the initial OD price in 1e8 scale (e.g. 100000000 = 1.00 USD).',
    phases: [0],
    params: [
      { key: 'seedPrice', label: 'Seed Price (1e8 scale)', placeholder: '100000000' },
    ],
  },
  {
    id: 4,
    title: 'Premint OD',
    description: 'Mint the initial OD supply for liquidity pool creation.',
    phases: [1],
    params: [
      { key: 'odAmount', label: 'OD Amount', placeholder: '0.00' },
    ],
  },
  {
    id: 5,
    title: 'Add Liquidity to MotoSwap',
    description: 'Add the preminted OD and WBTC to MotoSwap as a liquidity pool. Use the MotoSwap UI or router contract directly.',
    phases: [1],
    external: true,
  },
  {
    id: 6,
    title: 'Initialize Pool on ODReserve',
    description: 'Register the MotoSwap WBTC/OD pool address in the reserve contract.',
    phases: [1],
    params: [
      { key: 'poolAddress', label: 'MotoSwap Pool Address', placeholder: '0x...' },
    ],
  },
  {
    id: 7,
    title: 'Update TWAP Snapshot',
    description: 'Take the first TWAP snapshot from the MotoSwap pool.',
    phases: [1],
  },
  {
    id: 8,
    title: 'Final Advance Phase',
    description: 'Move from PREMINT to LIVE. The protocol becomes fully operational.',
    phases: [1],
  },
];

// ---------------------------------------------------------------------------
// Determine step status
// ---------------------------------------------------------------------------

type StepStatus = 'completed' | 'current' | 'future';

function getStepStatus(step: StepDef, phase: number): StepStatus {
  // If the protocol has moved past all phases this step is relevant to,
  // consider it completed.
  const maxRelevantPhase = Math.max(...step.phases);
  if (phase > maxRelevantPhase) return 'completed';

  // If the current phase matches one of the step's phases, it's current
  // (actionable).
  if (step.phases.includes(phase)) return 'current';

  // Otherwise it's a future step.
  return 'future';
}

// ---------------------------------------------------------------------------
// Admin component
// ---------------------------------------------------------------------------

export function Admin() {
  const {
    phase,
    reserveRatio,
    equity,
    twap,
    twapWindow,
    odSupply,
    orcSupply,
    wbtcReserve,
    connectedAddress,
    networkConfig,
    loading,
    error: protocolError,
    refresh,
  } = useProtocol();

  const { addToast } = useToast();

  // -- Threshold signing mode detection --
  // If permafrostPublicKey is set in config, the contracts have (or will have)
  // their ownership transferred to a threshold key. In that case, the admin
  // page must use multi-party signing instead of the wallet directly.
  const thresholdMode = !!networkConfig.permafrostPublicKey;

  // -- Threshold signing state --
  const [thresholdStep, setThresholdStep] = useState<StepDef | null>(null);

  // -- Per-step input values --
  const [stepInputs, setStepInputs] = useState<Record<string, string>>({});

  const setInput = useCallback((key: string, value: string) => {
    setStepInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  // -- Provider (memoised on network change) --
  const provider = useMemo(
    () =>
      new JSONRpcProvider({
        url: networkConfig.rpcUrl,
        network: networkConfig.network,
      }),
    [networkConfig],
  );

  // -- Sender address (Address object from wallet, not Address.fromString) --
  const { walletAddr } = useProtocol();

  // -- Contract call hook --
  const contractCall = useContractCall({
    network: networkConfig.network,
    refundTo: connectedAddress ?? '',
    onSuccess: () => {
      addToast('Transaction confirmed!', 'success');
      refresh();
    },
  });

  // -- Execute a bootstrap step --
  const executeStep = useCallback(
    async (step: StepDef) => {
      if (!connectedAddress || !walletAddr) return;

      const { addresses } = networkConfig;
      contractCall.reset();

      switch (step.id) {
        // Step 0: setReserve on OD
        case 0: {
          const reserveAddr = stepInputs['reserveAddr_0'] || addresses.reserve;
          await contractCall.execute(async () => {
            const od = getContract<IOP20WithSetReserve>(
              addresses.od,
              OD_ORC_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            const resolvedAddr = await provider.getPublicKeyInfo(reserveAddr, true);
            return od.setReserve(resolvedAddr);
          });
          break;
        }

        // Step 1: setReserve on ORC
        case 1: {
          const reserveAddr = stepInputs['reserveAddr_1'] || addresses.reserve;
          await contractCall.execute(async () => {
            const orc = getContract<IOP20WithSetReserve>(
              addresses.orc,
              OD_ORC_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            const resolvedAddr = await provider.getPublicKeyInfo(reserveAddr, true);
            return orc.setReserve(resolvedAddr);
          });
          break;
        }

        // Step 2: Seed (approve WBTC then mintORC)
        case 2: {
          const wbtcAmount = parseAmount(stepInputs['wbtcAmount_2'] ?? '');
          if (wbtcAmount === 0n) {
            addToast('Enter a WBTC amount', 'error');
            return;
          }

          // Approve WBTC first
          await contractCall.execute(async () => {
            const wbtc = getContract<IOP20Contract>(
              addresses.wbtc,
              OD_ORC_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            const reserveAddress = await provider.getPublicKeyInfo(addresses.reserve, true);
            return wbtc.increaseAllowance(reserveAddress, wbtcAmount);
          });

          if (contractCall.status === 'error') return;

          // Then mintORC
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve,
              OD_RESERVE_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            return reserve.mintORC(wbtcAmount);
          });
          break;
        }

        // Step 3: advancePhase (SEEDING -> PREMINT)
        case 3: {
          const seedPrice = stepInputs['seedPrice_3']
            ? BigInt(stepInputs['seedPrice_3'])
            : SCALE; // default 1.00 USD
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve,
              OD_RESERVE_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            return reserve.advancePhase(seedPrice);
          });
          break;
        }

        // Step 4: premintOD
        case 4: {
          const odAmount = parseAmount(stepInputs['odAmount_4'] ?? '');
          if (odAmount === 0n) {
            addToast('Enter an OD amount', 'error');
            return;
          }
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve,
              OD_RESERVE_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            return reserve.premintOD(odAmount);
          });
          break;
        }

        // Step 5: external — no contract call
        case 5:
          break;

        // Step 6: initPool
        case 6: {
          const poolAddr = stepInputs['poolAddress_6'] ?? '';
          if (!poolAddr) {
            addToast('Enter the MotoSwap pool address', 'error');
            return;
          }
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve,
              OD_RESERVE_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            const resolvedPool = await provider.getPublicKeyInfo(poolAddr, true);
            return reserve.initPool(resolvedPool);
          });
          break;
        }

        // Step 7: updateTwapSnapshot
        case 7: {
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve,
              OD_RESERVE_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            return reserve.updateTwapSnapshot();
          });
          break;
        }

        // Step 8: final advancePhase(0)
        case 8: {
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve,
              OD_RESERVE_ABI,
              provider,
              networkConfig.network,
              walletAddr,
            );
            return reserve.advancePhase(0n);
          });
          break;
        }
      }
    },
    [connectedAddress, walletAddr, networkConfig, provider, contractCall, stepInputs, addToast, refresh],
  );

  // -- Currently executing step (to show status on the right card) --
  const [activeStepId, setActiveStepId] = useState<number | null>(null);

  const handleExecuteStep = useCallback(
    async (step: StepDef) => {
      setActiveStepId(step.id);
      await executeStep(step);
    },
    [executeStep],
  );

  // -- Threshold signing handlers --
  const handleThresholdPropose = useCallback(
    (step: StepDef) => {
      setThresholdStep(step);
    },
    [],
  );

  const handleThresholdCancel = useCallback(() => {
    setThresholdStep(null);
  }, []);

  const handleSignatureReady = useCallback(
    (_signature: Uint8Array) => {
      // When the real ThresholdMLDSA ships, this will inject the combined
      // signature into the transaction and broadcast. For now, just show
      // a success toast.
      addToast('Threshold signature combined! Broadcast not yet implemented (stub).', 'success');
      setThresholdStep(null);
    },
    [addToast],
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isBusy =
    contractCall.status === 'simulating' ||
    contractCall.status === 'awaiting_approval' ||
    contractCall.status === 'broadcasting';

  function renderStepStatus(stepId: number) {
    if (activeStepId !== stepId) return null;
    const { status, error: txError, reset } = contractCall;
    if (status === 'idle') return null;

    if (status === 'error') {
      return (
        <div className="step-status error" onClick={reset} title="Click to dismiss">
          {txError || 'Unknown error'}
        </div>
      );
    }

    return (
      <div className={`step-status ${status}`}>
        {statusLabel(status)}
      </div>
    );
  }

  function renderStepCard(step: StepDef) {
    const stepStatus = getStepStatus(step, phase);
    const isCurrent = stepStatus === 'current';
    const cardClass = `step-card ${step.external ? 'external' : stepStatus}`;

    return (
      <div key={step.id} className={cardClass}>
        {/* Header */}
        <div className="step-header">
          <span className="step-number">
            {stepStatus === 'completed' ? '\u2713' : step.id}
          </span>
          <span className="step-title">{step.title}</span>
          <span
            className={`step-status-badge ${
              stepStatus === 'completed' ? 'done' : stepStatus === 'current' ? 'active' : 'pending'
            }`}
          >
            {stepStatus === 'completed' ? 'Done' : stepStatus === 'current' ? 'Ready' : 'Pending'}
          </span>
        </div>

        {/* Description */}
        <div className="step-description">{step.description}</div>

        {/* Controls (only for current, non-external steps) */}
        {isCurrent && !step.external && (
          <div className="step-controls">
            {step.params?.map((param) => (
              <div key={param.key} className="step-field">
                <label>{param.label}</label>
                <input
                  type="text"
                  placeholder={param.placeholder}
                  value={stepInputs[`${param.key}_${step.id}`] ?? ''}
                  onChange={(e) => setInput(`${param.key}_${step.id}`, e.target.value)}
                  disabled={isBusy}
                />
              </div>
            ))}

            {thresholdMode ? (
              <button
                className="step-execute-btn"
                disabled={!connectedAddress}
                onClick={() => handleThresholdPropose(step)}
              >
                Propose Step {step.id}
              </button>
            ) : (
              <button
                className="step-execute-btn"
                disabled={!connectedAddress || isBusy}
                onClick={() => void handleExecuteStep(step)}
              >
                {isBusy && activeStepId === step.id
                  ? statusLabel(contractCall.status)
                  : `Execute Step ${step.id}`}
              </button>
            )}

            {renderStepStatus(step.id)}
          </div>
        )}

        {/* External step note */}
        {isCurrent && step.external && (
          <div className="step-description" style={{ marginTop: 0, fontStyle: 'italic' }}>
            This step must be performed externally (e.g. via MotoSwap UI).
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loading / error guards
  // ---------------------------------------------------------------------------

  if (loading) {
    return <div className="admin-loading">Loading protocol data...</div>;
  }

  if (protocolError) {
    return <div className="admin-error">{protocolError}</div>;
  }

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  const isLive = phase >= 2;

  return (
    <div className="admin">
      {/* === Live status === */}
      {isLive && (
        <div className="admin-live-card">
          <div className="admin-live-dot" />
          <span className="admin-live-text">Protocol is Live</span>
        </div>
      )}

      {/* === Bootstrap warning + wizard (only pre-LIVE) === */}
      {!isLive && (
        <>
          {thresholdMode ? (
            <div className="threshold-mode-banner">
              <span className="admin-warning-icon">!</span>
              <span>Threshold signing mode — steps require {' '}
                multi-party PERMAFROST signatures</span>
            </div>
          ) : (
            <div className="admin-warning">
              <span className="admin-warning-icon">!</span>
              <span>Admin functions require deployer wallet</span>
            </div>
          )}

          <div className="admin-section-title">Bootstrap Wizard</div>

          {thresholdMode ? (
            <ShareGate>
              {(share) => (
                <>
                  {/* Threshold signing overlay for a proposed step */}
                  {thresholdStep && (
                    <ThresholdSign
                      stepTitle={thresholdStep.title}
                      targetContract={networkConfig.addresses.reserve}
                      txParams={Object.fromEntries(
                        (thresholdStep.params ?? []).map((p) => [
                          p.label,
                          stepInputs[`${p.key}_${thresholdStep.id}`] || p.placeholder,
                        ]),
                      )}
                      message={new Uint8Array(32)} // Placeholder — real impl hashes the tx
                      share={share}
                      onSignatureReady={handleSignatureReady}
                      onCancel={handleThresholdCancel}
                    />
                  )}

                  {/* Step cards */}
                  <div className="admin-wizard">
                    {STEPS.map((step) => renderStepCard(step))}
                  </div>
                </>
              )}
            </ShareGate>
          ) : (
            <div className="admin-wizard">
              {STEPS.map((step) => renderStepCard(step))}
            </div>
          )}
        </>
      )}

      {/* === Protocol Status (always visible) === */}
      <div className="admin-section-title">Protocol Status</div>
      <div className="admin-detail-grid">
        <div className="admin-detail-row">
          <span className="admin-detail-label">Connected Address</span>
          <span className="admin-detail-value truncate">
            {connectedAddress ?? 'Not connected'}
          </span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">Phase</span>
          <span className="admin-detail-value">{phaseName(phase)}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">Reserve Ratio</span>
          <span className="admin-detail-value">{formatPercent(reserveRatio)}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">Equity</span>
          <span className="admin-detail-value">{formatBtc(equity)}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">TWAP Price</span>
          <span className="admin-detail-value">{formatUsd(twap)}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">TWAP Window</span>
          <span className="admin-detail-value">{twapWindow.toString()} blocks</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">OD Supply</span>
          <span className="admin-detail-value">{formatU256(odSupply)}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">ORC Supply</span>
          <span className="admin-detail-value">{formatU256(orcSupply)}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">WBTC Reserve</span>
          <span className="admin-detail-value">{formatBtc(wbtcReserve)}</span>
        </div>
      </div>

      {/* === Emergency Controls === */}
      <div className="admin-section-title">Emergency Controls</div>
      <div className="admin-emergency-card">
        No emergency controls implemented yet.
      </div>
    </div>
  );
}
