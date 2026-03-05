import { useState, useCallback, useRef, useEffect } from 'react';
import type { ShareFile, DecryptedShare } from '../lib/share-crypto';
import { decryptShareFile } from '../lib/share-crypto';
import {
  createSession,
  round1,
  round2,
  round3,
  combine,
  addBlob,
  destroySession,
} from '../lib/threshold';
import type { SigningSession } from '../lib/threshold';

// ---------------------------------------------------------------------------
// Share import
// ---------------------------------------------------------------------------

interface ShareImportProps {
  onShareLoaded: (share: DecryptedShare) => void;
}

function ShareImport({ onShareLoaded }: ShareImportProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<ShareFile | null>(null);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        fileRef.current = JSON.parse(reader.result as string) as ShareFile;
      } catch {
        setError('Invalid share file (not valid JSON)');
        fileRef.current = null;
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDecrypt = useCallback(async () => {
    if (!fileRef.current) {
      setError('Load a share file first');
      return;
    }
    if (!password) {
      setError('Enter your password');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const share = await decryptShareFile(fileRef.current, password);
      onShareLoaded(share);
    } catch {
      setError('Decryption failed — wrong password or corrupted file');
    } finally {
      setLoading(false);
    }
  }, [password, onShareLoaded]);

  return (
    <div className="threshold-share-import">
      <div className="threshold-section-title">Import Share File</div>
      <p className="threshold-hint">
        Load your encrypted PERMAFROST share file and enter your password to
        unlock it. The share is held in memory only.
      </p>

      <div className="step-field">
        <label>Share File (.json)</label>
        <input type="file" accept=".json" onChange={handleFile} />
        {fileName && <span className="threshold-filename">{fileName}</span>}
      </div>

      <div className="step-field">
        <label>Password</label>
        <input
          type="password"
          placeholder="Share file password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleDecrypt()}
        />
      </div>

      {error && <div className="step-status error">{error}</div>}

      <button
        className="step-execute-btn"
        disabled={loading || !fileRef.current}
        onClick={() => void handleDecrypt()}
      >
        {loading ? 'Decrypting...' : 'Unlock Share'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tx detail display (for co-signers to verify what they're signing)
// ---------------------------------------------------------------------------

interface TxDetailProps {
  stepTitle: string;
  targetContract: string;
  params: Record<string, string>;
}

function TxDetail({ stepTitle, targetContract, params }: TxDetailProps) {
  return (
    <div className="threshold-tx-detail">
      <div className="threshold-section-title">Transaction Details</div>
      <div className="admin-detail-grid" style={{ marginBottom: 0 }}>
        <div className="admin-detail-row">
          <span className="admin-detail-label">Step</span>
          <span className="admin-detail-value">{stepTitle}</span>
        </div>
        <div className="admin-detail-row">
          <span className="admin-detail-label">Contract</span>
          <span className="admin-detail-value truncate">{targetContract}</span>
        </div>
        {Object.entries(params).map(([key, val]) => (
          <div className="admin-detail-row" key={key}>
            <span className="admin-detail-label">{key}</span>
            <span className="admin-detail-value truncate">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Party tracker
// ---------------------------------------------------------------------------

interface PartyTrackerProps {
  activePartyIds: number[];
  collected: Map<number, unknown>;
  selfId: number;
}

function PartyTracker({ activePartyIds, collected, selfId }: PartyTrackerProps) {
  return (
    <div className="threshold-collected" style={{ marginBottom: 12 }}>
      {activePartyIds.map((id) => {
        const has = collected.has(id);
        const isSelf = id === selfId;
        return (
          <span
            key={id}
            className={`threshold-collected-chip${has ? '' : ' pending'}`}
            style={!has ? { background: 'rgba(107,107,107,0.15)', color: 'var(--gray-light)' } : undefined}
          >
            Party {id}{isSelf ? ' (you)' : ''}{has ? ' ✓' : ''}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blob exchange UI
// ---------------------------------------------------------------------------

interface BlobExchangeProps {
  roundNumber: number;
  myBlob: string;
  threshold: number;
  collected: Map<number, unknown>;
  activePartyIds: number[];
  selfId: number;
  onAddBlob: (blob: string) => void;
  onProceed: () => void;
  canProceed: boolean;
  error: string;
}

function BlobExchange({
  roundNumber,
  myBlob,
  threshold,
  collected,
  activePartyIds,
  selfId,
  onAddBlob,
  onProceed,
  canProceed,
  error,
}: BlobExchangeProps) {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);

  const handleAdd = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onAddBlob(trimmed);
    setInput('');
  }, [input, onAddBlob]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(myBlob).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* clipboard API may fail in some contexts */ });
  }, [myBlob]);

  const needed = threshold;

  return (
    <div className="threshold-blob-exchange">
      <div className="threshold-section-title">Round {roundNumber}</div>

      <PartyTracker activePartyIds={activePartyIds} collected={collected} selfId={selfId} />

      {/* Our blob to copy */}
      <div className="step-field">
        <label>
          Your blob (share with co-signers)
          <button
            className="threshold-clear-btn"
            style={{ marginLeft: 8, fontSize: 11 }}
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </label>
        <textarea
          className="threshold-blob-textarea"
          readOnly
          value={myBlob}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      </div>

      {/* Paste area */}
      <div className="step-field">
        <label>
          Paste co-signer blob ({collected.size}/{needed} collected)
        </label>
        <textarea
          className="threshold-blob-textarea"
          placeholder="Paste a co-signer's blob here..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>

      {error && <div className="step-status error">{error}</div>}

      <div className="threshold-btn-row">
        <button
          className="step-execute-btn threshold-btn-half"
          onClick={handleAdd}
          disabled={!input.trim()}
        >
          Add Blob
        </button>
        <button
          className="step-execute-btn threshold-btn-half"
          onClick={onProceed}
          disabled={!canProceed}
        >
          Proceed to {roundNumber < 3 ? `Round ${roundNumber + 1}` : 'Combine'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ThresholdSign component
// ---------------------------------------------------------------------------

type SigningPhase = 'idle' | 'round1' | 'round2' | 'round3' | 'complete' | 'failed';

interface ThresholdSignProps {
  stepTitle: string;
  targetContract: string;
  txParams: Record<string, string>;
  message: Uint8Array;
  share: DecryptedShare;
  onSignatureReady: (signature: Uint8Array) => void;
  onCancel: () => void;
}

export function ThresholdSign({
  stepTitle,
  targetContract,
  txParams,
  message,
  share,
  onSignatureReady,
  onCancel,
}: ThresholdSignProps) {
  const [phase, setPhase] = useState<SigningPhase>('idle');
  const [session, setSession] = useState<SigningSession | null>(null);
  const [blobError, setBlobError] = useState('');
  const [activePartyIds, setActivePartyIds] = useState<number[]>([]);
  const [partyInput, setPartyInput] = useState('');

  // Cleanup on unmount
  const sessionRef = useRef<SigningSession | null>(null);
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        destroySession(sessionRef.current);
      }
    };
  }, []);

  // Parse active party IDs from comma-separated input
  const parsePartyIds = useCallback((): number[] | null => {
    const parts = partyInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (parts.length < share.threshold) return null;
    // Ensure our own ID is included
    if (!parts.includes(share.partyId)) {
      parts.push(share.partyId);
    }
    return [...new Set(parts)].sort((a, b) => a - b);
  }, [partyInput, share.partyId, share.threshold]);

  // Start signing
  const startSigning = useCallback(() => {
    const ids = parsePartyIds();
    if (!ids || ids.length < share.threshold) return;

    setActivePartyIds(ids);
    const sess = createSession(message, share, ids);
    round1(sess);
    sessionRef.current = sess;
    setSession({ ...sess });
    setPhase('round1');
  }, [message, share, parsePartyIds]);

  // Current round number for validation
  const currentRound = phase === 'round1' ? 1 : phase === 'round2' ? 2 : phase === 'round3' ? 3 : undefined;

  // Add blob from co-signer
  const handleAddBlob = useCallback((blob: string) => {
    if (!sessionRef.current) return;
    setBlobError('');
    const result = addBlob(sessionRef.current, blob, currentRound);
    if (!result.ok) {
      setBlobError(result.error ?? 'Invalid blob');
      return;
    }
    setSession({ ...sessionRef.current });
  }, [currentRound]);

  // Advance to round 2
  const advanceToRound2 = useCallback(() => {
    if (!sessionRef.current) return;
    try {
      round2(sessionRef.current);
      setSession({ ...sessionRef.current });
      setPhase('round2');
      setBlobError('');
    } catch (err) {
      setBlobError(err instanceof Error ? err.message : 'Round 2 failed');
    }
  }, []);

  // Advance to round 3
  const advanceToRound3 = useCallback(() => {
    if (!sessionRef.current) return;
    try {
      round3(sessionRef.current);
      setSession({ ...sessionRef.current });
      setPhase('round3');
      setBlobError('');
    } catch (err) {
      setBlobError(err instanceof Error ? err.message : 'Round 3 failed');
    }
  }, []);

  // Combine
  const doCombine = useCallback(() => {
    if (!sessionRef.current) return;
    try {
      const sig = combine(sessionRef.current);
      if (sig) {
        setSession({ ...sessionRef.current });
        setPhase('complete');
        onSignatureReady(sig);
      } else {
        setPhase('failed');
      }
    } catch (err) {
      setBlobError(err instanceof Error ? err.message : 'Combine failed');
      setPhase('failed');
    }
  }, [onSignatureReady]);

  // Retry after failed combine
  const handleRetry = useCallback(() => {
    if (sessionRef.current) {
      destroySession(sessionRef.current);
    }
    sessionRef.current = null;
    setSession(null);
    setPhase('idle');
    setBlobError('');
  }, []);

  // Cancel with cleanup
  const handleCancel = useCallback(() => {
    if (sessionRef.current) {
      destroySession(sessionRef.current);
    }
    sessionRef.current = null;
    onCancel();
  }, [onCancel]);

  const needed = share.threshold;

  // Build default party IDs string
  const defaultPartyIds = Array.from({ length: share.parties }, (_, i) => i).join(', ');
  const parsedIds = parsePartyIds();
  const canStartSigning = !!parsedIds && parsedIds.length >= share.threshold;

  return (
    <div className="threshold-sign">
      <TxDetail
        stepTitle={stepTitle}
        targetContract={targetContract}
        params={txParams}
      />

      {phase === 'idle' && (
        <div className="threshold-idle">
          <p className="threshold-hint">
            This step requires {share.threshold}-of-{share.parties} threshold
            signing. You are Party {share.partyId}.
          </p>
          <div className="step-field" style={{ marginBottom: 12 }}>
            <label>Active signer party IDs (comma-separated, need at least {share.threshold})</label>
            <input
              type="text"
              placeholder={defaultPartyIds}
              value={partyInput}
              onChange={(e) => setPartyInput(e.target.value)}
            />
          </div>
          <div className="threshold-btn-row">
            <button
              className="step-execute-btn threshold-btn-half"
              onClick={startSigning}
              disabled={!canStartSigning}
            >
              Start Signing
            </button>
            <button
              className="step-execute-btn threshold-btn-half threshold-btn-cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'round1' && session?.myRound1Blob && (
        <BlobExchange
          roundNumber={1}
          myBlob={session.myRound1Blob}
          threshold={needed}
          collected={session.collectedRound1Hashes}
          activePartyIds={activePartyIds}
          selfId={share.partyId}
          onAddBlob={handleAddBlob}
          onProceed={advanceToRound2}
          canProceed={session.collectedRound1Hashes.size >= needed}
          error={blobError}
        />
      )}

      {phase === 'round2' && session?.myRound2Blob && (
        <BlobExchange
          roundNumber={2}
          myBlob={session.myRound2Blob}
          threshold={needed}
          collected={session.collectedRound2Commitments}
          activePartyIds={activePartyIds}
          selfId={share.partyId}
          onAddBlob={handleAddBlob}
          onProceed={advanceToRound3}
          canProceed={session.collectedRound2Commitments.size >= needed}
          error={blobError}
        />
      )}

      {phase === 'round3' && session?.myRound3Blob && (
        <BlobExchange
          roundNumber={3}
          myBlob={session.myRound3Blob}
          threshold={needed}
          collected={session.collectedRound3Responses}
          activePartyIds={activePartyIds}
          selfId={share.partyId}
          onAddBlob={handleAddBlob}
          onProceed={doCombine}
          canProceed={session.collectedRound3Responses.size >= needed}
          error={blobError}
        />
      )}

      {phase === 'complete' && (
        <div className="threshold-complete">
          <div className="step-status confirmed">
            Signature combined successfully! Ready to broadcast.
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="threshold-complete">
          <div className="step-status error" style={{ cursor: 'default' }}>
            Signing attempt failed — this can happen due to randomness. Click Retry to start over.
          </div>
          <div className="threshold-btn-row" style={{ marginTop: 12 }}>
            <button className="step-execute-btn threshold-btn-half" onClick={handleRetry}>
              Retry
            </button>
            <button className="step-execute-btn threshold-btn-half threshold-btn-cancel" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShareGate — wraps share import + threshold signing mode for Admin
// ---------------------------------------------------------------------------

interface ShareGateProps {
  children: (share: DecryptedShare) => React.ReactNode;
}

export function ShareGate({ children }: ShareGateProps) {
  const [share, setShare] = useState<DecryptedShare | null>(null);

  if (!share) {
    return <ShareImport onShareLoaded={setShare} />;
  }

  return (
    <div className="threshold-active">
      <div className="threshold-share-info">
        <span className="threshold-share-badge">
          Party {share.partyId} | {share.threshold}-of-{share.parties}
        </span>
        <button
          className="threshold-clear-btn"
          onClick={() => setShare(null)}
          title="Clear share and re-import"
        >
          Clear
        </button>
      </div>
      {children(share)}
    </div>
  );
}
