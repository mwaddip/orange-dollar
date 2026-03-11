import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import config from '@shared/config.json';
import { STEPS, getStepContract, buildStepMessage } from '../lib/steps';
import { ShareGate, ThresholdSign } from './ThresholdSign';
import { toHex, fromHex } from '../lib/threshold';
import type { DecryptedShare } from '../lib/share-crypto';
import { RelayClient } from '../lib/relay';
import { sessionFingerprint } from '../lib/relay-crypto';

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

  // -- Network config (relayUrl etc.) --
  const networkConfig = config[network] as { label: string; relayUrl?: string; addresses: NetworkAddresses };

  // -- Mode selector --
  const [mode, setMode] = useState<'choose' | 'propose' | 'join' | 'relay-create' | 'relay-join'>('choose');

  // -- Relay state --
  const [relayClient, setRelayClient] = useState<RelayClient | null>(null);
  const [sessionCode, setSessionCode] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [relayReady, setRelayReady] = useState(false);
  const [relayPartyId, setRelayPartyId] = useState(-1);
  const [fingerprint, setFingerprint] = useState('');
  const [relayError, setRelayError] = useState('');
  const [relayStatus, setRelayStatus] = useState('');
  const [relayPartyCount, setRelayPartyCount] = useState(0);
  const [relayPartyTotal, setRelayPartyTotal] = useState(0);
  const [thresholdInput, setThresholdInput] = useState(2);
  const relayClientRef = useRef<RelayClient | null>(null);

  // Cleanup relay client on unmount or network change
  useEffect(() => {
    return () => {
      if (relayClientRef.current) {
        relayClientRef.current.close();
        relayClientRef.current = null;
      }
    };
  }, []);

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
    // Clean up relay client if active
    if (relayClientRef.current) {
      relayClientRef.current.close();
      relayClientRef.current = null;
      setRelayClient(null);
      setRelayReady(false);
      setRelayPartyId(-1);
      setFingerprint('');
      setSessionCode('');
      setSessionUrl('');
      setRelayStatus('');
      setRelayError('');
      setRelayPartyCount(0);
      setRelayPartyTotal(0);
    }
    setMode('choose');
  }, []);

  const handleDismissResult = useCallback(() => {
    setSigResult(null);
    // Clean up relay client if active
    if (relayClientRef.current) {
      relayClientRef.current.close();
      relayClientRef.current = null;
      setRelayClient(null);
    }
    setMode('choose');
  }, []);

  // -- Relay: Create Session --
  const handleRelayCreate = useCallback(async () => {
    if (!networkConfig.relayUrl) return;
    setRelayError('');
    setRelayStatus('Connecting...');

    const contract = getStepContract(selectedStep, addresses, stepInputs);
    const paramValues: Record<string, string> = {};
    for (const p of selectedStep.params ?? []) {
      paramValues[p.key] = stepInputs[`${p.key}_${selectedStep.id}`] || p.placeholder;
    }
    // Scale seed price from USD to 1e8
    if (selectedStep.id === 4 && paramValues['seedPrice']) {
      paramValues['seedPrice'] = (BigInt(parseInt(paramValues['seedPrice'], 10)) * SCALE).toString();
    }

    // Build the message first
    let msg: Uint8Array;
    try {
      msg = await buildStepMessage(selectedStep.id, selectedStep.method, contract, paramValues);
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : 'Failed to build message');
      setRelayStatus('');
      return;
    }

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

    const client = new RelayClient(networkConfig.relayUrl);
    relayClientRef.current = client;

    // Set up event handlers before connecting
    client.on('joined', (_partyId, count, total) => {
      setRelayPartyCount(count);
      setRelayPartyTotal(total);
      setRelayStatus(`Waiting for parties... (${count}/${total})`);
    });

    client.on('ready', (pubkeys) => {
      void (async () => {
        const fp = await sessionFingerprint(pubkeys);
        setFingerprint(fp);
        setRelayReady(true);
        setRelayStatus('All parties connected');

        // Broadcast proposal data to joined parties
        const proposalBytes = new TextEncoder().encode(JSON.stringify(prop));
        await client.broadcast(proposalBytes);

        // Set state so ThresholdSign can render
        setMessage(msg);
        setProposal(prop);
        setProposalBlob(encodeProposal(prop));
        setSigning(true);
      })();
    });

    client.on('error', (errMsg) => {
      setRelayError(errMsg);
    });

    try {
      // For signing, parties = threshold (all must participate)
      const result = await client.create(thresholdInput, thresholdInput);
      setSessionCode(result.session);
      setSessionUrl(result.url);
      setRelayClient(client);
      setRelayPartyId(client.partyId);
      setRelayStatus(`Session created. Waiting for parties... (1/${thresholdInput})`);
      setRelayPartyCount(1);
      setRelayPartyTotal(thresholdInput);
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : 'Failed to create session');
      setRelayStatus('');
      client.close();
      relayClientRef.current = null;
    }
  }, [networkConfig.relayUrl, selectedStep, addresses, stepInputs, thresholdInput]);

  // -- Relay: Join Session --
  const handleRelayJoin = useCallback(async () => {
    if (!networkConfig.relayUrl || !joinCode.trim()) return;
    setRelayError('');
    setRelayStatus('Connecting...');

    const client = new RelayClient(networkConfig.relayUrl);
    relayClientRef.current = client;

    // Listen for the proposal broadcast from the creator
    client.on('message', (_from, payload) => {
      // Only handle the first message as the proposal
      if (proposal) return; // Already got it
      try {
        const text = new TextDecoder().decode(payload);
        const prop = JSON.parse(text) as Proposal;
        if (prop.v === 1 && prop.type === 'proposal' && prop.messageHex) {
          const msg = fromHex(prop.messageHex);
          setMessage(msg);
          setProposal(prop);
          setSelectedStepId(prop.stepId);
          setSigning(true);
        }
      } catch {
        // Not a proposal message — ignore (could be signing data)
      }
    });

    client.on('ready', (pubkeys) => {
      void (async () => {
        const fp = await sessionFingerprint(pubkeys);
        setFingerprint(fp);
        setRelayReady(true);
        setRelayStatus('Connected — waiting for proposal from creator...');
      })();
    });

    client.on('error', (errMsg) => {
      setRelayError(errMsg);
    });

    try {
      await client.join(joinCode.trim().toUpperCase());
      setSessionCode(client.sessionCode);
      setRelayClient(client);
      setRelayPartyId(client.partyId);
      setRelayStatus('Joined session — waiting for all parties...');
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : 'Failed to join session');
      setRelayStatus('');
      client.close();
      relayClientRef.current = null;
    }
  }, [networkConfig.relayUrl, joinCode, proposal]);

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

          {networkConfig.relayUrl && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-light)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Online (Relay)
              </div>
              <div className="threshold-btn-row" style={{ marginBottom: 16 }}>
                <button
                  className="step-execute-btn threshold-btn-half"
                  onClick={() => setMode('relay-create')}
                >
                  Create Session
                </button>
                <button
                  className="step-execute-btn threshold-btn-half"
                  style={{ background: 'var(--bg-surface)', color: 'var(--white)' }}
                  onClick={() => setMode('relay-join')}
                >
                  Join Session
                </button>
              </div>
              <p className="threshold-hint" style={{ marginTop: 0, marginBottom: 16 }}>
                <strong>Create Session</strong> to start a relay-coordinated signing ceremony.{' '}
                <strong>Join Session</strong> if you have a session code from another signer.
              </p>
            </>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-light)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Offline (Manual Blob Exchange)
          </div>
          <div className="threshold-btn-row">
            <button
              className="step-execute-btn threshold-btn-half"
              onClick={() => setMode('propose')}
            >
              Offline: Propose
            </button>
            <button
              className="step-execute-btn threshold-btn-half"
              style={{ background: 'var(--bg-surface)', color: 'var(--white)' }}
              onClick={() => setMode('join')}
            >
              Offline: Join
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
      {/* RELAY-CREATE MODE: step selector + params → create session     */}
      {/* ============================================================= */}
      {mode === 'relay-create' && !signing && !sigResult && (
        <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
          <div className="admin-section-title">Create Relay Session</div>

          {!sessionCode && (
            <>
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

                  <div className="step-field" style={{ marginBottom: 16 }}>
                    <label>Threshold (number of signers required)</label>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={thresholdInput}
                      onChange={(e) => setThresholdInput(parseInt(e.target.value, 10) || 2)}
                    />
                  </div>

                  <button
                    className="step-execute-btn"
                    onClick={() => void handleRelayCreate()}
                  >
                    Create Session
                  </button>
                </>
              )}
            </>
          )}

          {/* Session created — waiting for parties */}
          {sessionCode && !relayReady && (
            <div style={{ marginTop: 16 }}>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Session Code</span>
                <span className="admin-detail-value" style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, letterSpacing: '0.15em' }}>
                  {sessionCode}
                </span>
              </div>
              {sessionUrl && (
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Session URL</span>
                  <span className="admin-detail-value truncate" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {sessionUrl}
                  </span>
                </div>
              )}
              <div className="step-status" style={{ cursor: 'default', marginTop: 12, background: 'rgba(243, 156, 18, 0.08)', color: 'var(--orange)' }}>
                {relayStatus || `Waiting for parties... (${relayPartyCount}/${relayPartyTotal})`}
              </div>
            </div>
          )}

          {/* Ready — show fingerprint */}
          {relayReady && fingerprint && !signing && (
            <div style={{ marginTop: 16 }}>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Session Fingerprint</span>
                <span className="admin-detail-value" style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
                  {fingerprint}
                </span>
              </div>
              <div className="step-status confirmed" style={{ cursor: 'default', marginTop: 12 }}>
                {relayStatus || 'All parties connected — starting signing...'}
              </div>
            </div>
          )}

          {relayError && (
            <div className="step-status error" style={{ cursor: 'default', marginTop: 12 }}>
              {relayError}
            </div>
          )}

          <button
            className="step-execute-btn"
            style={{ marginTop: 12, background: 'var(--bg-surface)', color: 'var(--gray-light)' }}
            onClick={handleCancel}
          >
            Back
          </button>
        </div>
      )}

      {/* ============================================================= */}
      {/* RELAY-JOIN MODE: enter session code → join → sign              */}
      {/* ============================================================= */}
      {mode === 'relay-join' && !signing && !sigResult && (
        <div className="admin-detail-grid" style={{ marginBottom: 24 }}>
          <div className="admin-section-title">Join Relay Session</div>

          {!relayClient && (
            <>
              <p className="threshold-hint">
                Enter the 6-character session code shared by the session creator.
              </p>

              <div className="step-field" style={{ marginBottom: 12 }}>
                <label>Session Code</label>
                <input
                  type="text"
                  placeholder="e.g. X7K2M9"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setRelayError(''); }}
                  style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: '0.15em', textTransform: 'uppercase' }}
                />
              </div>

              <button
                className="step-execute-btn"
                disabled={joinCode.trim().length < 6}
                onClick={() => void handleRelayJoin()}
              >
                Join
              </button>
            </>
          )}

          {/* Joined — waiting for ready / proposal */}
          {relayClient && !relayReady && (
            <div style={{ marginTop: 16 }}>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Session Code</span>
                <span className="admin-detail-value" style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, letterSpacing: '0.15em' }}>
                  {sessionCode}
                </span>
              </div>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Your Party ID</span>
                <span className="admin-detail-value">{relayPartyId}</span>
              </div>
              <div className="step-status" style={{ cursor: 'default', marginTop: 12, background: 'rgba(243, 156, 18, 0.08)', color: 'var(--orange)' }}>
                {relayStatus || 'Waiting for all parties to connect...'}
              </div>
            </div>
          )}

          {/* Ready — show fingerprint, waiting for proposal */}
          {relayReady && fingerprint && !signing && (
            <div style={{ marginTop: 16 }}>
              <div className="admin-detail-row">
                <span className="admin-detail-label">Session Fingerprint</span>
                <span className="admin-detail-value" style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
                  {fingerprint}
                </span>
              </div>
              <p className="threshold-hint" style={{ marginTop: 8 }}>
                Verify this fingerprint matches what the session creator sees.
              </p>
              <div className="step-status" style={{ cursor: 'default', marginTop: 12, background: 'rgba(46, 204, 113, 0.08)', color: 'var(--green)' }}>
                {relayStatus || 'Connected — waiting for proposal from creator...'}
              </div>
            </div>
          )}

          {relayError && (
            <div className="step-status error" style={{ cursor: 'default', marginTop: 12 }}>
              {relayError}
            </div>
          )}

          <button
            className="step-execute-btn"
            style={{ marginTop: 12, background: 'var(--bg-surface)', color: 'var(--gray-light)' }}
            onClick={handleCancel}
          >
            Back
          </button>
        </div>
      )}

      {/* ============================================================= */}
      {/* THRESHOLD SIGNING (all modes end up here)                      */}
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
                relayClient={relayClient}
                relayPartyId={relayPartyId}
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
