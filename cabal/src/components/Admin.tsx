import { useState, useMemo, useCallback, useEffect } from 'react';
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
import { toHex } from '../lib/threshold';
import { STEPS, getStepContract, buildStepMessage } from '../lib/steps';
import type { StepDef } from '../lib/steps';
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
// Determine step status
// ---------------------------------------------------------------------------

type StepStatus = 'completed' | 'current' | 'future';

function getStepStatus(step: StepDef, phase: number): StepStatus {
  const maxRelevantPhase = Math.max(...step.phases);
  if (phase > maxRelevantPhase) return 'completed';
  if (step.phases.includes(phase)) return 'current';
  return 'future';
}

// ---------------------------------------------------------------------------
// Signature result display
// ---------------------------------------------------------------------------

interface SignatureResultProps {
  stepTitle: string;
  contract: string;
  messageHex: string;
  signatureHex: string;
  onDismiss: () => void;
}

function SignatureResult({ stepTitle, contract, messageHex, signatureHex, onDismiss }: SignatureResultProps) {
  const [copiedField, setCopiedField] = useState('');

  const copyField = useCallback((field: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1500);
    }).catch(() => { /* clipboard may fail */ });
  }, []);

  return (
    <div className="threshold-sign" style={{ borderLeftColor: 'var(--green)', borderLeftWidth: 4, borderLeftStyle: 'solid' }}>
      <div className="threshold-section-title">Threshold Signature Ready</div>
      <div className="step-status confirmed" style={{ marginBottom: 16 }}>
        {stepTitle} — signature combined successfully
      </div>

      <div className="admin-detail-grid" style={{ marginBottom: 16 }}>
        <div className="admin-detail-row">
          <span className="admin-detail-label">Contract</span>
          <span className="admin-detail-value truncate">{contract}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">
            Message Hash
            <button className="threshold-clear-btn" style={{ marginLeft: 8, fontSize: 11 }} onClick={() => copyField('msg', messageHex)}>
              {copiedField === 'msg' ? 'Copied!' : 'Copy'}
            </button>
          </span>
          <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {messageHex}
          </span>
        </div>
        <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 8 }}>
          <span className="admin-detail-label">
            ML-DSA Signature ({signatureHex.length / 2} bytes)
            <button className="threshold-clear-btn" style={{ marginLeft: 8, fontSize: 11 }} onClick={() => copyField('sig', signatureHex)}>
              {copiedField === 'sig' ? 'Copied!' : 'Copy'}
            </button>
          </span>
          <textarea
            className="threshold-blob-textarea"
            readOnly
            value={signatureHex}
            style={{ minHeight: 48, fontSize: 11 }}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        </div>
      </div>

      <button className="step-execute-btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
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

  // -- Threshold signing state --
  const [thresholdStep, setThresholdStep] = useState<StepDef | null>(null);
  const [thresholdMessage, setThresholdMessage] = useState<Uint8Array | null>(null);

  // -- Signature result display --
  const [sigResult, setSigResult] = useState<{
    stepTitle: string;
    contract: string;
    messageHex: string;
    signatureHex: string;
  } | null>(null);

  // -- Server submission state --
  const [submitting, setSubmitting] = useState(false);

  // -- Import external signature state --
  const [importedSig, setImportedSig] = useState<{
    stepId: number;
    stepTitle: string;
    params: Record<string, string>;
    signature: string;
    messageHash: string;
  } | null>(null);
  const [importError, setImportError] = useState('');

  // -- Wallet + PERMAFROST status (fetched from server) --
  const [permafrostPubKey, setPermafrostPubKey] = useState<string | null>(
    networkConfig.permafrostPublicKey ?? null,
  );
  const [walletExists, setWalletExists] = useState<boolean | null>(null);
  const [walletP2TR, setWalletP2TR] = useState<string | null>(null);
  const [walletPassphrase, setWalletPassphrase] = useState('');
  const [walletGenerating, setWalletGenerating] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const thresholdMode = !!permafrostPubKey;

  useEffect(() => {
    if (!networkConfig.cabalApiUrl) return;
    fetch(`${networkConfig.cabalApiUrl}/wallet-status`)
      .then((res) => res.json())
      .then((data: { exists: boolean; p2tr?: string; permafrostPublicKey?: string }) => {
        setWalletExists(data.exists);
        if (data.p2tr) setWalletP2TR(data.p2tr);
        if (data.permafrostPublicKey) setPermafrostPubKey(data.permafrostPublicKey);
      })
      .catch(() => setWalletExists(null));
  }, [networkConfig.cabalApiUrl]);

  const handleGenerateWallet = useCallback(async () => {
    if (!networkConfig.cabalApiUrl) return;
    setWalletGenerating(true);
    setWalletError(null);
    try {
      const res = await fetch(`${networkConfig.cabalApiUrl}/generate-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: walletPassphrase }),
      });
      const data = await res.json() as { p2tr?: string; error?: string };
      if (res.ok && data.p2tr) {
        setWalletExists(true);
        setWalletP2TR(data.p2tr);
        setWalletPassphrase('');
        addToast('Signing wallet generated!', 'success');
      } else if (res.status === 403) {
        setWalletError('Invalid passphrase');
      } else if (res.status === 409) {
        setWalletError('Wallet already exists');
        setWalletExists(true);
      } else {
        setWalletError(data.error ?? 'Unknown error');
      }
    } catch {
      setWalletError('Server unreachable');
    } finally {
      setWalletGenerating(false);
    }
  }, [networkConfig.cabalApiUrl, walletPassphrase, addToast]);

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

  // -- Sender address (Address object from wallet) --
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

  // -- Execute a bootstrap step (direct wallet mode) --
  const executeStep = useCallback(
    async (step: StepDef) => {
      if (!connectedAddress || !walletAddr) return;

      const { addresses } = networkConfig;
      contractCall.reset();

      switch (step.id) {
        case 0: {
          const reserveAddr = stepInputs['reserveAddr_0'] || addresses.reserve;
          await contractCall.execute(async () => {
            const od = getContract<IOP20WithSetReserve>(
              addresses.od, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
            );
            const resolvedAddr = await provider.getPublicKeyInfo(reserveAddr, true);
            return od.setReserve(resolvedAddr);
          });
          break;
        }
        case 1: {
          const reserveAddr = stepInputs['reserveAddr_1'] || addresses.reserve;
          await contractCall.execute(async () => {
            const orc = getContract<IOP20WithSetReserve>(
              addresses.orc, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
            );
            const resolvedAddr = await provider.getPublicKeyInfo(reserveAddr, true);
            return orc.setReserve(resolvedAddr);
          });
          break;
        }
        case 2: {
          const wbtcAmount = parseAmount(stepInputs['wbtcAmount_2'] ?? '');
          if (wbtcAmount === 0n) { addToast('Enter a WBTC amount', 'error'); return; }
          await contractCall.execute(async () => {
            const wbtc = getContract<IOP20Contract>(
              addresses.wbtc, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
            );
            const reserveAddress = await provider.getPublicKeyInfo(addresses.reserve, true);
            return wbtc.increaseAllowance(reserveAddress, wbtcAmount);
          });
          break;
        }
        case 3: {
          const wbtcAmount = parseAmount(stepInputs['wbtcAmount_3'] ?? '');
          if (wbtcAmount === 0n) { addToast('Enter a WBTC amount', 'error'); return; }
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
            );
            return reserve.mintORC(wbtcAmount);
          });
          break;
        }
        case 4: {
          const seedPriceUsd = stepInputs['seedPrice_4'] ? parseInt(stepInputs['seedPrice_4'], 10) : 1;
          const seedPrice = BigInt(seedPriceUsd) * SCALE;
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
            );
            return reserve.advancePhase(seedPrice);
          });
          break;
        }
        case 5: {
          const odAmount = parseAmount(stepInputs['odAmount_5'] ?? '');
          if (odAmount === 0n) { addToast('Enter an OD amount', 'error'); return; }
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
            );
            return reserve.premintOD(odAmount);
          });
          break;
        }
        case 6: {
          const odAmount = parseAmount(stepInputs['odAmount_6'] ?? '');
          if (odAmount === 0n) { addToast('Enter an OD amount', 'error'); return; }
          await contractCall.execute(async () => {
            const od = getContract<IOP20Contract>(
              addresses.od, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
            );
            const resolvedRouter = await provider.getPublicKeyInfo(addresses.router, true);
            return od.increaseAllowance(resolvedRouter, odAmount);
          });
          break;
        }
        case 7: {
          const wbtcAmount = parseAmount(stepInputs['wbtcAmount_7'] ?? '');
          if (wbtcAmount === 0n) { addToast('Enter a WBTC amount', 'error'); return; }
          await contractCall.execute(async () => {
            const wbtc = getContract<IOP20Contract>(
              addresses.wbtc, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
            );
            const resolvedRouter = await provider.getPublicKeyInfo(addresses.router, true);
            return wbtc.increaseAllowance(resolvedRouter, wbtcAmount);
          });
          break;
        }
        case 8: break;
        case 9: {
          const poolAddr = stepInputs['poolAddress_9'] ?? '';
          if (!poolAddr) { addToast('Enter the MotoSwap pool address', 'error'); return; }
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
            );
            const resolvedPool = await provider.getPublicKeyInfo(poolAddr, true);
            return reserve.initPool(resolvedPool);
          });
          break;
        }
        case 10: {
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
            );
            return reserve.updateTwapSnapshot();
          });
          break;
        }
        case 11: {
          await contractCall.execute(async () => {
            const reserve = getContract<IODReserveAdminContract>(
              addresses.reserve, OD_RESERVE_ABI, provider, networkConfig.network, walletAddr,
            );
            return reserve.advancePhase(0n);
          });
          break;
        }
        case 12: {
          const contractAddr = stepInputs['contractAddr_12'] ?? '';
          const toAddress = stepInputs['toAddress_12'] ?? '';
          const amount = parseAmount(stepInputs['amount_12'] ?? '');
          if (!contractAddr) { addToast('Enter the token contract address', 'error'); return; }
          if (!toAddress) { addToast('Enter the destination address', 'error'); return; }
          if (amount === 0n) { addToast('Enter an amount', 'error'); return; }
          await contractCall.execute(async () => {
            const token = getContract<IOP20Contract>(
              contractAddr, OD_ORC_ABI, provider, networkConfig.network, walletAddr,
            );
            const resolvedTo = await provider.getPublicKeyInfo(toAddress, true);
            return token.transfer(resolvedTo, amount);
          });
          break;
        }
      }
    },
    [connectedAddress, walletAddr, networkConfig, provider, contractCall, stepInputs, addToast, refresh],
  );

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
    async (step: StepDef) => {
      const contract = getStepContract(step, networkConfig.addresses, stepInputs);

      // Build step params for message construction
      const paramValues: Record<string, string> = {};
      for (const p of step.params ?? []) {
        paramValues[p.key] = stepInputs[`${p.key}_${step.id}`] || p.placeholder;
      }
      // Scale seed price from USD to 1e8 for the contract
      if (step.id === 4 && paramValues['seedPrice']) {
        paramValues['seedPrice'] = (BigInt(parseInt(paramValues['seedPrice'], 10)) * SCALE).toString();
      }

      const message = await buildStepMessage(step.id, step.method, contract, paramValues);
      setThresholdMessage(message);
      setThresholdStep(step);
    },
    [networkConfig, stepInputs],
  );

  const handleThresholdCancel = useCallback(() => {
    setThresholdStep(null);
    setThresholdMessage(null);
  }, []);

  const handleSignatureReady = useCallback(
    async (signature: Uint8Array) => {
      if (!thresholdStep || !thresholdMessage) return;

      const contract = getStepContract(thresholdStep, networkConfig.addresses, stepInputs);
      const messageHex = toHex(thresholdMessage);
      const signatureHex = toHex(signature);

      // Build step params (same as handleThresholdPropose)
      const paramValues: Record<string, string> = {};
      for (const p of thresholdStep.params ?? []) {
        paramValues[p.key] = stepInputs[`${p.key}_${thresholdStep.id}`] || p.placeholder;
      }

      setThresholdStep(null);
      setThresholdMessage(null);

      // If cabalApiUrl is configured, auto-submit to the server
      if (networkConfig.cabalApiUrl) {
        setSubmitting(true);
        try {
          const res = await fetch(`${networkConfig.cabalApiUrl}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stepId: thresholdStep.id,
              params: paramValues,
              signature: signatureHex,
              messageHash: messageHex,
            }),
          });
          const data = await res.json() as { success?: boolean; txId?: string; error?: string };
          if (res.ok && data.success) {
            addToast(`Transaction submitted: ${data.txId}`, 'success');
            refresh();
            return;
          }
          addToast(`Server error: ${data.error ?? 'unknown'}`, 'error');
        } catch (err) {
          addToast(`Server unreachable — showing signature for manual use`, 'error');
        } finally {
          setSubmitting(false);
        }
      }

      // Fallback: show signature result for manual copy
      setSigResult({
        stepTitle: thresholdStep.title,
        contract,
        messageHex,
        signatureHex,
      });
      addToast('Threshold signature combined!', 'success');
    },
    [thresholdStep, thresholdMessage, networkConfig, stepInputs, addToast, refresh],
  );

  // -- Import external signature handlers --
  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as {
          v?: number;
          type?: string;
          stepId?: number;
          stepTitle?: string;
          params?: Record<string, string>;
          signature?: string;
          messageHash?: string;
        };
        if (data.v !== 1 || data.type !== 'signature-submission') {
          setImportError('Invalid file format — expected a signature submission file');
          return;
        }
        if (typeof data.stepId !== 'number' || !data.signature || !data.messageHash) {
          setImportError('Missing required fields (stepId, signature, messageHash)');
          return;
        }
        setImportedSig({
          stepId: data.stepId,
          stepTitle: data.stepTitle ?? `Step ${data.stepId}`,
          params: data.params ?? {},
          signature: data.signature,
          messageHash: data.messageHash,
        });
      } catch {
        setImportError('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleSubmitImported = useCallback(async () => {
    if (!importedSig || !networkConfig.cabalApiUrl) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${networkConfig.cabalApiUrl}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepId: importedSig.stepId,
          params: importedSig.params,
          signature: importedSig.signature,
          messageHash: importedSig.messageHash,
        }),
      });
      const data = await res.json() as { success?: boolean; txId?: string; error?: string };
      if (res.ok && data.success) {
        addToast(`Transaction submitted: ${data.txId}`, 'success');
        setImportedSig(null);
        refresh();
        return;
      }
      addToast(`Server error: ${data.error ?? 'unknown'}`, 'error');
    } catch {
      addToast('Server unreachable', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [importedSig, networkConfig.cabalApiUrl, addToast, refresh]);

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

        <div className="step-description">{step.description}</div>

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
                disabled={!!thresholdStep || submitting || (!!networkConfig.cabalApiUrl && !walletExists)}
                onClick={() => void handleThresholdPropose(step)}
              >
                {networkConfig.cabalApiUrl && !walletExists
                  ? 'Generate wallet first'
                  : `Propose Step ${step.id}`}
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

      {/* === Signature result === */}
      {sigResult && (
        <SignatureResult
          stepTitle={sigResult.stepTitle}
          contract={sigResult.contract}
          messageHex={sigResult.messageHex}
          signatureHex={sigResult.signatureHex}
          onDismiss={() => setSigResult(null)}
        />
      )}

      {/* === Import external signature === */}
      {thresholdMode && networkConfig.cabalApiUrl && !thresholdStep && !sigResult && (
        <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
          <div className="admin-section-title">Import External Signature</div>
          <p className="threshold-hint" style={{ marginTop: 0 }}>
            Import a signature file produced by the offline PERMAFROST signer.
          </p>

          {!importedSig && (
            <div className="step-field">
              <label>Signature file (.json)</label>
              <input type="file" accept=".json" onChange={handleImportFile} />
            </div>
          )}

          {importError && (
            <div className="step-status error" style={{ cursor: 'default' }}>{importError}</div>
          )}

          {importedSig && (
            <>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Step</span>
                <span className="admin-detail-value">{importedSig.stepTitle}</span>
              </div>
              {Object.entries(importedSig.params).map(([key, val]) => (
                <div className="admin-detail-row" key={key}>
                  <span className="admin-detail-label">{key}</span>
                  <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {val}
                  </span>
                </div>
              ))}
              <div className="admin-detail-row">
                <span className="admin-detail-label">Message Hash</span>
                <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {importedSig.messageHash}
                </span>
              </div>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Signature</span>
                <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {importedSig.signature.slice(0, 32)}...
                </span>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  className="step-execute-btn"
                  disabled={submitting || !walletExists}
                  onClick={() => void handleSubmitImported()}
                >
                  {submitting ? 'Submitting...' : !walletExists ? 'Generate wallet first' : 'Submit to CABAL Server'}
                </button>
                <button
                  className="step-execute-btn"
                  style={{ background: 'var(--bg-surface)', color: 'var(--gray-light)' }}
                  onClick={() => setImportedSig(null)}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* === Submitting to CABAL server === */}
      {submitting && (
        <div className="step-status simulating" style={{ margin: '16px 0' }}>
          Submitting to CABAL server...
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

          {/* Wallet generation / status (threshold mode only) */}
          {thresholdMode && networkConfig.cabalApiUrl && walletExists === false && (
            <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
              <div className="admin-section-title">Generate Signing Wallet</div>
              <div className="step-description" style={{ marginBottom: 12 }}>
                The CABAL server needs a one-time ECDSA signing key.
                This key signs Bitcoin transactions while the threshold ML-DSA key
                provides the OPNet identity.
              </div>
              <div className="step-field">
                <label>Passphrase</label>
                <input
                  type="password"
                  placeholder="Enter server passphrase"
                  value={walletPassphrase}
                  onChange={(e) => setWalletPassphrase(e.target.value)}
                  disabled={walletGenerating}
                />
              </div>
              {walletError && (
                <div className="step-status error" style={{ marginBottom: 8 }}>{walletError}</div>
              )}
              <button
                className="step-execute-btn"
                disabled={walletGenerating || !walletPassphrase}
                onClick={() => void handleGenerateWallet()}
              >
                {walletGenerating ? 'Generating...' : 'Generate Wallet'}
              </button>
            </div>
          )}

          {thresholdMode && walletP2TR && (
            <div className="admin-detail-row" style={{ marginBottom: 16 }}>
              <span className="admin-detail-label">Signing wallet</span>
              <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {walletP2TR}
              </span>
            </div>
          )}

          <div className="admin-section-title">Bootstrap Wizard</div>

          {thresholdMode ? (
            <ShareGate>
              {(share) => (
                <>
                  {thresholdStep && thresholdMessage && (
                    <ThresholdSign
                      stepTitle={thresholdStep.title}
                      targetContract={getStepContract(thresholdStep, networkConfig.addresses, stepInputs)}
                      txParams={Object.fromEntries(
                        (thresholdStep.params ?? []).map((p) => [
                          p.label,
                          stepInputs[`${p.key}_${thresholdStep.id}`] || p.placeholder,
                        ]),
                      )}
                      message={thresholdMessage}
                      share={share}
                      onSignatureReady={handleSignatureReady}
                      onCancel={handleThresholdCancel}
                    />
                  )}

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
