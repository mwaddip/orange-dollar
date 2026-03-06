import { useState, useCallback, useMemo } from 'react';
import config from '@shared/config.json';
import { STEPS, getStepContract, buildStepMessage } from '../lib/steps';
import { ShareGate, ThresholdSign } from './ThresholdSign';
import { toHex, fromHex } from '../lib/threshold';
import type { DecryptedShare } from '../lib/share-crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NetworkName = keyof typeof config;

interface NetworkAddresses {
  od: string;
  orc: string;
  reserve: string;
  wbtc: string;
  factory: string;
  router: string;
}

const SCALE = 100_000_000n;

// ---------------------------------------------------------------------------
// Proposal blob (shared between initiator and co-signers)
// ---------------------------------------------------------------------------

interface Proposal {
  v: 1;
  type: 'proposal';
  stepId: number;
  stepTitle: string;
  method: string;
  contract: string;
  params: Record<string, string>;
  messageHex: string;
}

function encodeProposal(p: Proposal): string {
  return btoa(JSON.stringify(p));
}

function decodeProposal(blob: string): Proposal | null {
  try {
    const json = JSON.parse(atob(blob.trim())) as Proposal;
    if (json.v !== 1 || json.type !== 'proposal' || !json.messageHex) return null;
    return json;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Signature result display
// ---------------------------------------------------------------------------

interface SignatureResultProps {
  stepId: number;
  stepTitle: string;
  contract: string;
  params: Record<string, string>;
  messageHex: string;
  signatureHex: string;
  onDismiss: () => void;
}

function SignatureResult({ stepId, stepTitle, contract, params, messageHex, signatureHex, onDismiss }: SignatureResultProps) {
  const [copiedField, setCopiedField] = useState('');

  const copyField = useCallback((field: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1500);
    }).catch(() => { /* clipboard may fail */ });
  }, []);

  const handleExport = useCallback(() => {
    const submission = {
      v: 1,
      type: 'signature-submission',
      stepId,
      stepTitle,
      params,
      signature: signatureHex,
      messageHash: messageHex,
    };
    const blob = new Blob([JSON.stringify(submission, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `step${stepId}-signature.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stepId, stepTitle, params, signatureHex, messageHex]);

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

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button className="step-execute-btn" onClick={handleExport}>
          Export for submission
        </button>
        <button className="step-execute-btn" onClick={onDismiss} style={{ background: 'var(--bg-surface)', color: 'var(--gray-light)' }}>
          Dismiss
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--gray-light)', margin: 0 }}>
        Import the exported file on the online cabal admin page, or submit via curl.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OfflineSigner
// ---------------------------------------------------------------------------

export function OfflineSigner() {
  // -- Network selection --
  const networkNames = useMemo(() => Object.keys(config) as NetworkName[], []);
  const [network, setNetwork] = useState<NetworkName>(networkNames[0]!);
  const addresses = (config[network] as { addresses: NetworkAddresses }).addresses;

  // -- Mode: 'propose' (initiator) or 'join' (co-signer) --
  const [mode, setMode] = useState<'choose' | 'propose' | 'join'>('choose');

  // -- Step selection (propose mode) --
  const [selectedStepId, setSelectedStepId] = useState<number>(0);
  const selectedStep = STEPS.find((s) => s.id === selectedStepId)!;

  // -- Parameter inputs --
  const [stepInputs, setStepInputs] = useState<Record<string, string>>({});
  const setInput = useCallback((key: string, value: string) => {
    setStepInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  // -- Proposal state (shared by both modes once ready) --
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalBlob, setProposalBlob] = useState('');
  const [message, setMessage] = useState<Uint8Array | null>(null);
  const [building, setBuilding] = useState(false);

  // -- Join mode state --
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState('');

  // -- Signing state --
  const [signing, setSigning] = useState(false);
  const [currentShare, setCurrentShare] = useState<DecryptedShare | null>(null);

  // -- Signature result --
  const [sigResult, setSigResult] = useState<{
    stepId: number;
    stepTitle: string;
    contract: string;
    params: Record<string, string>;
    messageHex: string;
    signatureHex: string;
  } | null>(null);

  // -- Build message + proposal (initiator) --
  const handleBuildMessage = useCallback(async () => {
    const contract = getStepContract(selectedStep, addresses, stepInputs);
    const paramValues: Record<string, string> = {};
    for (const p of selectedStep.params ?? []) {
      paramValues[p.key] = stepInputs[`${p.key}_${selectedStep.id}`] || p.placeholder;
    }
    // Scale seed price from USD to 1e8
    if (selectedStep.id === 4 && paramValues['seedPrice']) {
      paramValues['seedPrice'] = (BigInt(parseInt(paramValues['seedPrice'], 10)) * SCALE).toString();
    }

    setBuilding(true);
    try {
      const msg = await buildStepMessage(selectedStep.id, selectedStep.method, contract, paramValues);
      const prop: Proposal = {
        v: 1,
        type: 'proposal',
        stepId: selectedStep.id,
        stepTitle: selectedStep.title,
        method: selectedStep.method,
        contract,
        params: paramValues,
        messageHex: toHex(msg),
      };
      setMessage(msg);
      setProposal(prop);
      setProposalBlob(encodeProposal(prop));
    } finally {
      setBuilding(false);
    }
  }, [selectedStep, addresses, stepInputs]);

  // -- Import proposal (co-signer) --
  const handleImportProposal = useCallback(() => {
    setJoinError('');
    const prop = decodeProposal(joinInput);
    if (!prop) {
      setJoinError('Invalid proposal blob');
      return;
    }
    const msg = fromHex(prop.messageHex);
    setProposal(prop);
    setMessage(msg);
    setSelectedStepId(prop.stepId);
    // Go straight to signing
    setSigning(true);
  }, [joinInput]);

  const handleSignatureReady = useCallback(
    (signature: Uint8Array) => {
      if (!message || !proposal) return;
      setSigResult({
        stepId: proposal.stepId,
        stepTitle: proposal.stepTitle,
        contract: proposal.contract,
        params: proposal.params,
        messageHex: proposal.messageHex,
        signatureHex: toHex(signature),
      });
      setSigning(false);
      setMessage(null);
      setProposal(null);
      setProposalBlob('');
    },
    [message, proposal],
  );

  const handleCancel = useCallback(() => {
    setSigning(false);
    setMessage(null);
    setProposal(null);
    setProposalBlob('');
    setMode('choose');
  }, []);

  const handleDismissResult = useCallback(() => {
    setSigResult(null);
    setMode('choose');
  }, []);

  const [proposalCopied, setProposalCopied] = useState(false);
  const copyProposal = useCallback(() => {
    navigator.clipboard.writeText(proposalBlob).then(() => {
      setProposalCopied(true);
      setTimeout(() => setProposalCopied(false), 1500);
    }).catch(() => {});
  }, [proposalBlob]);

  return (
    <div className="admin">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>PERMAFROST Signer</div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 10px',
            borderRadius: 6,
            background: 'rgba(46, 204, 113, 0.08)',
            color: 'var(--green)',
            border: '1px solid rgba(46, 204, 113, 0.2)',
          }}
        >
          OFFLINE
        </span>
      </div>

      {/* Signature result */}
      {sigResult && (
        <SignatureResult
          stepId={sigResult.stepId}
          stepTitle={sigResult.stepTitle}
          contract={sigResult.contract}
          params={sigResult.params}
          messageHex={sigResult.messageHex}
          signatureHex={sigResult.signatureHex}
          onDismiss={handleDismissResult}
        />
      )}

      {/* Network selector */}
      {!sigResult && (
        <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
          <div className="step-field">
            <label>Network</label>
            <select
              value={network}
              onChange={(e) => {
                setNetwork(e.target.value as NetworkName);
                setMessage(null);
                setProposal(null);
                setProposalBlob('');
                setSigning(false);
                setMode('choose');
              }}
              disabled={signing}
            >
              {networkNames.map((n) => (
                <option key={n} value={n}>
                  {(config[n] as { label: string }).label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Mode selector */}
      {mode === 'choose' && !signing && !sigResult && (
        <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
          <div className="admin-section-title">What would you like to do?</div>
          <div className="threshold-btn-row">
            <button
              className="step-execute-btn threshold-btn-half"
              onClick={() => setMode('propose')}
            >
              Propose a Step
            </button>
            <button
              className="step-execute-btn threshold-btn-half"
              style={{ background: 'var(--bg-surface)', color: 'var(--white)' }}
              onClick={() => setMode('join')}
            >
              Join Signing Session
            </button>
          </div>
          <p className="threshold-hint" style={{ marginTop: 12, marginBottom: 0 }}>
            <strong>Propose</strong> if you are initiating a new operation.{' '}
            <strong>Join</strong> if another co-signer sent you a proposal blob.
          </p>
        </div>
      )}

      {/* ============================================================= */}
      {/* PROPOSE MODE: step selector + params → build → proposal blob  */}
      {/* ============================================================= */}
      {mode === 'propose' && !signing && !sigResult && (
        <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
          <div className="admin-section-title">Propose Step</div>

          <div className="step-field" style={{ marginBottom: 16 }}>
            <label>Bootstrap Step</label>
            <select
              value={selectedStepId}
              onChange={(e) => {
                setSelectedStepId(parseInt(e.target.value, 10));
                setMessage(null);
                setProposal(null);
                setProposalBlob('');
              }}
            >
              {STEPS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}. {s.title}
                </option>
              ))}
            </select>
          </div>

          <div className="step-description" style={{ marginLeft: 0, marginBottom: 16 }}>
            {selectedStep.description}
          </div>

          {selectedStep.external && (
            <div className="step-status error" style={{ cursor: 'default', marginBottom: 16 }}>
              This step is performed externally and does not require threshold signing.
            </div>
          )}

          {!selectedStep.external && (
            <>
              {selectedStep.params?.map((param) => (
                <div key={param.key} className="step-field" style={{ marginBottom: 12 }}>
                  <label>{param.label}</label>
                  <input
                    type="text"
                    placeholder={param.placeholder}
                    value={stepInputs[`${param.key}_${selectedStep.id}`] ?? ''}
                    onChange={(e) => setInput(`${param.key}_${selectedStep.id}`, e.target.value)}
                  />
                </div>
              ))}

              <button
                className="step-execute-btn"
                disabled={building}
                onClick={() => void handleBuildMessage()}
              >
                {building ? 'Building...' : 'Build Message'}
              </button>

              {/* Proposal blob output */}
              {proposal && proposalBlob && (
                <div style={{ marginTop: 16 }}>
                  <div className="admin-detail-row" style={{ marginBottom: 12 }}>
                    <span className="admin-detail-label">Message Hash</span>
                    <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {proposal.messageHex}
                    </span>
                  </div>

                  <div className="step-field" style={{ marginBottom: 12 }}>
                    <label>
                      Proposal blob (share with co-signers)
                      <button
                        className="threshold-clear-btn"
                        style={{ marginLeft: 8, fontSize: 11 }}
                        onClick={copyProposal}
                      >
                        {proposalCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </label>
                    <textarea
                      className="threshold-blob-textarea"
                      readOnly
                      value={proposalBlob}
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    />
                  </div>

                  <button
                    className="step-execute-btn"
                    onClick={() => setSigning(true)}
                  >
                    Start Threshold Signing
                  </button>
                </div>
              )}
            </>
          )}

          <button
            className="step-execute-btn"
            style={{ marginTop: 12, background: 'var(--bg-surface)', color: 'var(--gray-light)' }}
            onClick={() => { setMode('choose'); setProposal(null); setProposalBlob(''); setMessage(null); }}
          >
            Back
          </button>
        </div>
      )}

      {/* ============================================================= */}
      {/* JOIN MODE: paste proposal blob → verify → start signing        */}
      {/* ============================================================= */}
      {mode === 'join' && !signing && !sigResult && (
        <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
          <div className="admin-section-title">Join Signing Session</div>
          <p className="threshold-hint">
            Paste the proposal blob you received from the initiator.
            You will see the operation details before signing.
          </p>

          <div className="step-field" style={{ marginBottom: 12 }}>
            <label>Proposal Blob</label>
            <textarea
              className="threshold-blob-textarea"
              placeholder="Paste the proposal blob here..."
              value={joinInput}
              onChange={(e) => { setJoinInput(e.target.value); setJoinError(''); }}
            />
          </div>

          {joinError && (
            <div className="step-status error" style={{ cursor: 'default', marginBottom: 12 }}>
              {joinError}
            </div>
          )}

          {/* Preview decoded proposal before committing */}
          {(() => {
            const preview = joinInput.trim() ? decodeProposal(joinInput) : null;
            if (!preview) return null;
            const step = STEPS.find((s) => s.id === preview.stepId);
            return (
              <div style={{ marginBottom: 12 }}>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Step</span>
                  <span className="admin-detail-value">{preview.stepTitle}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Method</span>
                  <span className="admin-detail-value">{preview.method}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Contract</span>
                  <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {preview.contract}
                  </span>
                </div>
                {Object.entries(preview.params).map(([key, val]) => (
                  <div className="admin-detail-row" key={key}>
                    <span className="admin-detail-label">{step?.params?.find((p) => p.key === key)?.label ?? key}</span>
                    <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {val}
                    </span>
                  </div>
                ))}
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Message Hash</span>
                  <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {preview.messageHex}
                  </span>
                </div>
              </div>
            );
          })()}

          <button
            className="step-execute-btn"
            disabled={!joinInput.trim()}
            onClick={handleImportProposal}
          >
            Verify &amp; Start Signing
          </button>

          <button
            className="step-execute-btn"
            style={{ marginTop: 12, background: 'var(--bg-surface)', color: 'var(--gray-light)' }}
            onClick={() => { setMode('choose'); setJoinInput(''); setJoinError(''); }}
          >
            Back
          </button>
        </div>
      )}

      {/* ============================================================= */}
      {/* THRESHOLD SIGNING (both modes end up here)                     */}
      {/* ============================================================= */}
      {signing && message && proposal && (
        <ShareGate>
          {(share) => {
            if (share !== currentShare) setCurrentShare(share);
            return (
              <ThresholdSign
                stepTitle={proposal.stepTitle}
                targetContract={proposal.contract}
                txParams={proposal.params}
                message={message}
                share={share}
                onSignatureReady={handleSignatureReady}
                onCancel={handleCancel}
              />
            );
          }}
        </ShareGate>
      )}

      {/* Contract addresses reference */}
      {!sigResult && (
        <>
          <div className="admin-section-title">Contract Addresses ({(config[network] as { label: string }).label})</div>
          <div className="admin-detail-grid">
            {Object.entries(addresses).map(([key, val]) => (
              <div className="admin-detail-row" key={key}>
                <span className="admin-detail-label">{key}</span>
                <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {val || '(not set)'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
