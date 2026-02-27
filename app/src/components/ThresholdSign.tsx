import { useState, useCallback, useRef } from 'react';
import type { ShareFile, DecryptedShare } from '../lib/share-crypto';
import { decryptShareFile } from '../lib/share-crypto';
import {
  createSession,
  round1,
  round2,
  round3,
  combine,
  decodeBlob,
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
// Blob exchange UI (copy your blob, paste others' blobs)
// ---------------------------------------------------------------------------

interface BlobExchangeProps {
  roundNumber: number;
  myBlob: string;
  threshold: number;
  collected: string[];
  onAddBlob: (blob: string) => void;
  onProceed: () => void;
  canProceed: boolean;
}

function BlobExchange({
  roundNumber,
  myBlob,
  threshold,
  collected,
  onAddBlob,
  onProceed,
  canProceed,
}: BlobExchangeProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const handleAdd = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const decoded = decodeBlob(trimmed);
    if (!decoded) {
      setError('Invalid blob format');
      return;
    }
    if (decoded.round !== roundNumber) {
      setError(`Expected round ${roundNumber} blob, got round ${decoded.round}`);
      return;
    }

    onAddBlob(trimmed);
    setInput('');
    setError('');
  }, [input, roundNumber, onAddBlob]);

  const needed = threshold - 1; // we already have our own

  return (
    <div className="threshold-blob-exchange">
      <div className="threshold-section-title">Round {roundNumber}</div>

      {/* Our blob to copy */}
      <div className="step-field">
        <label>Your blob (share with co-signers)</label>
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
          Paste co-signer blob ({collected.length}/{needed} collected)
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

      {/* Collected blobs summary */}
      {collected.length > 0 && (
        <div className="threshold-collected">
          {collected.map((blob, i) => {
            const info = decodeBlob(blob);
            return (
              <span key={i} className="threshold-collected-chip">
                Party {info?.partyId ?? '?'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ThresholdSign component
// ---------------------------------------------------------------------------

type SigningPhase = 'idle' | 'round1' | 'round2' | 'round3' | 'complete';

interface ThresholdSignProps {
  /** The step being signed (for tx detail display). */
  stepTitle: string;
  /** The target contract address. */
  targetContract: string;
  /** Human-readable parameters for the step. */
  txParams: Record<string, string>;
  /** The message (tx hash) to sign. */
  message: Uint8Array;
  /** The decrypted share. */
  share: DecryptedShare;
  /** Called when a combined signature is ready. */
  onSignatureReady: (signature: Uint8Array) => void;
  /** Called to cancel. */
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

  // Start round 1
  const startSigning = useCallback(() => {
    const sess = createSession(message, share);
    round1(sess);
    setSession(sess);
    setPhase('round1');
  }, [message, share]);

  // Collect blobs + advance rounds
  const addBlobForRound = useCallback(
    (roundNum: number, blob: string) => {
      if (!session) return;
      if (roundNum === 1) session.round1Blobs.push(blob);
      else if (roundNum === 2) session.round2Blobs.push(blob);
      else if (roundNum === 3) session.round3Blobs.push(blob);
      // Force re-render by cloning
      setSession({ ...session });
    },
    [session],
  );

  const advanceToRound2 = useCallback(() => {
    if (!session) return;
    round2(session);
    setSession({ ...session });
    setPhase('round2');
  }, [session]);

  const advanceToRound3 = useCallback(() => {
    if (!session) return;
    round3(session);
    setSession({ ...session });
    setPhase('round3');
  }, [session]);

  const doCombine = useCallback(() => {
    if (!session) return;
    const sig = combine(session);
    setSession({ ...session });
    setPhase('complete');
    onSignatureReady(sig);
  }, [session, onSignatureReady]);

  const needed = share.threshold - 1;

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
          <div className="threshold-btn-row">
            <button className="step-execute-btn threshold-btn-half" onClick={startSigning}>
              Start Signing
            </button>
            <button
              className="step-execute-btn threshold-btn-half threshold-btn-cancel"
              onClick={onCancel}
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
          threshold={share.threshold}
          collected={session.round1Blobs}
          onAddBlob={(b) => addBlobForRound(1, b)}
          onProceed={advanceToRound2}
          canProceed={session.round1Blobs.length >= needed}
        />
      )}

      {phase === 'round2' && session?.myRound2Blob && (
        <BlobExchange
          roundNumber={2}
          myBlob={session.myRound2Blob}
          threshold={share.threshold}
          collected={session.round2Blobs}
          onAddBlob={(b) => addBlobForRound(2, b)}
          onProceed={advanceToRound3}
          canProceed={session.round2Blobs.length >= needed}
        />
      )}

      {phase === 'round3' && session?.myRound3Blob && (
        <BlobExchange
          roundNumber={3}
          myBlob={session.myRound3Blob}
          threshold={share.threshold}
          collected={session.round3Blobs}
          onAddBlob={(b) => addBlobForRound(3, b)}
          onProceed={doCombine}
          canProceed={session.round3Blobs.length >= needed}
        />
      )}

      {phase === 'complete' && (
        <div className="threshold-complete">
          <div className="step-status confirmed">
            Signature combined successfully! Ready to broadcast.
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
