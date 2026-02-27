import { useState, useCallback } from 'react';
import {
  generateShares,
  encryptShare,
  downloadShareFile,
  type KeygenResult,
} from '../lib/keygen';
import { PasswordModal } from './PasswordModal';

type Step = 'setup' | 'generating' | 'download' | 'complete';

export function CeremonyWizard() {
  const [step, setStep] = useState<Step>('setup');
  const [threshold, setThreshold] = useState(3);
  const [parties, setParties] = useState(5);
  const [result, setResult] = useState<KeygenResult | null>(null);
  const [downloaded, setDownloaded] = useState<Set<number>>(new Set());
  const [downloadingParty, setDownloadingParty] = useState<number | null>(null);

  const stepIndex = step === 'setup' ? 0 : step === 'generating' ? 1 : step === 'download' ? 2 : 3;

  const handleGenerate = useCallback(() => {
    setStep('generating');
    // Use setTimeout to let the UI update before the sync computation
    setTimeout(() => {
      const keygen = generateShares(threshold, parties);
      setResult(keygen);
      setStep('download');
    }, 50);
  }, [threshold, parties]);

  const handleDownload = useCallback(async (password: string) => {
    if (!result || downloadingParty === null) return;
    const share = result.shares[downloadingParty];
    if (!share) return;

    const shareFile = await encryptShare(
      share,
      result.publicKeyHex,
      threshold,
      parties,
      44, // ML-DSA-44
      password,
    );
    downloadShareFile(shareFile);
    setDownloaded(prev => new Set(prev).add(downloadingParty));
    setDownloadingParty(null);
  }, [result, downloadingParty, threshold, parties]);

  const allDownloaded = result ? downloaded.size === result.shares.length : false;

  return (
    <div className="ceremony">
      <h1>PERMAFROST Key Ceremony</h1>
      <p className="subtitle">
        Generate a {threshold}-of-{parties} threshold ML-DSA key for Orange Dollar contract ownership.
      </p>

      {/* Step dots */}
      <div className="steps">
        {['Setup', 'Generate', 'Download', 'Complete'].map((_, i) => (
          <div
            key={i}
            className={`step-dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
          />
        ))}
      </div>

      {/* Step 1: Setup */}
      {step === 'setup' && (
        <div className="card">
          <h2>Configure Parameters</h2>
          <p>
            Choose the threshold (minimum signers) and total number of parties.
            The default 3-of-5 means any 3 of 5 keyholders can authorize a transaction.
          </p>
          <div className="form-row">
            <label>
              Threshold (T)
              <select
                value={threshold}
                onChange={e => {
                  const t = Number(e.target.value);
                  setThreshold(t);
                  if (t > parties) setParties(t);
                }}
              >
                {[2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Parties (N)
              <select
                value={parties}
                onChange={e => setParties(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6, 7].filter(n => n >= threshold).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="warning">
            Trusted dealer mode: the initiator generates all shares in this browser.
            The seed is destroyed after share extraction. Each party must download
            and securely store their encrypted share.
          </div>
          <button className="btn btn-primary btn-full" onClick={handleGenerate}>
            Generate Keys
          </button>
        </div>
      )}

      {/* Step 2: Generating */}
      {step === 'generating' && (
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>Generating Keys...</h2>
          <p>This may take a moment.</p>
          <div className="spinner" style={{ margin: '20px auto' }} />
        </div>
      )}

      {/* Step 3: Download shares */}
      {step === 'download' && result && (
        <>
          <div className="card">
            <h2>Public Key (PERMAFROST Address)</h2>
            <p>
              This is the shared public key. Use it with <code>transferOwnership()</code> on
              OD, ORC, and ODReserve contracts.
            </p>
            <div className="pubkey-display">{result.publicKeyHex}</div>
            <button
              className="btn btn-secondary btn-full"
              onClick={() => navigator.clipboard.writeText(result.publicKeyHex)}
            >
              Copy Public Key
            </button>
          </div>

          <div className="card">
            <h2>Download Share Files</h2>
            <p>
              Each party must download their share and protect it with a strong password.
              Shares are encrypted with AES-256-GCM before download.
            </p>
            <div className="warning">
              If you lose your share file and password, your share is gone forever.
              There is no recovery mechanism.
            </div>
            <div className="shares-grid">
              {result.shares.map(share => (
                <div key={share.partyId} className="share-card">
                  <div>
                    <div className="party-label">Party {share.partyId + 1}</div>
                    <div className={`party-status ${downloaded.has(share.partyId) ? 'downloaded' : ''}`}>
                      {downloaded.has(share.partyId) ? 'Downloaded' : 'Pending'}
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setDownloadingParty(share.partyId)}
                  >
                    {downloaded.has(share.partyId) ? 'Re-download' : 'Download'}
                  </button>
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary btn-full"
              disabled={!allDownloaded}
              onClick={() => setStep('complete')}
            >
              {allDownloaded ? 'Continue' : `Download all ${parties} shares to continue`}
            </button>
          </div>
        </>
      )}

      {/* Step 4: Complete */}
      {step === 'complete' && result && (
        <div className="card">
          <h2>Ceremony Complete</h2>
          <div className="success-box">
            All {parties} share files have been downloaded. The key generation seed
            has been destroyed (it only existed in memory during generation).
          </div>
          <p>
            <strong>Next steps:</strong>
          </p>
          <ol style={{ color: 'var(--white-dim)', fontSize: 14, paddingLeft: 20, marginBottom: 16 }}>
            <li style={{ marginBottom: 8 }}>
              Distribute share files to each party via a secure channel (Signal, encrypted email, etc.)
            </li>
            <li style={{ marginBottom: 8 }}>
              Each party stores their share file securely and remembers their password
            </li>
            <li style={{ marginBottom: 8 }}>
              Call <code>transferOwnership({result.publicKeyHex.slice(0, 16)}...)</code> on
              OD, ORC, and ODReserve contracts
            </li>
            <li>
              Future admin operations will require {threshold} of {parties} parties to co-sign
              via the cabal page
            </li>
          </ol>
          <div className="pubkey-display">{result.publicKeyHex}</div>
          <button
            className="btn btn-secondary btn-full"
            onClick={() => navigator.clipboard.writeText(result.publicKeyHex)}
          >
            Copy Public Key
          </button>
        </div>
      )}

      {/* Password modal */}
      {downloadingParty !== null && (
        <PasswordModal
          partyId={downloadingParty}
          onConfirm={handleDownload}
          onCancel={() => setDownloadingParty(null)}
        />
      )}
    </div>
  );
}
