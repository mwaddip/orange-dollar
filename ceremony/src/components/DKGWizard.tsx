/**
 * DKGWizard — 6-step distributed key generation ceremony.
 *
 * Join → Commit → Reveal → Masks → Aggregate → Complete
 *
 * Each party runs this independently in their own browser.
 * No single party ever sees another's secret share.
 */

import { useState, useReducer, useCallback, useRef, useEffect } from 'react';
import { PasswordModal } from './PasswordModal';
import { encryptShareV2, downloadShareFile, toHex } from '../lib/keygen';
import {
  createDKGInstance,
  generateSessionId,
  getSessionIdPrefix,
  sessionIdFromHex,
  getKL,
  encodeSessionConfig,
  decodeSessionConfig,
  encodePhase1Broadcast,
  decodePhase1Broadcast,
  encodePhase2Broadcast,
  decodePhase2Broadcast,
  encodePhase2Private,
  decodePhase2Private,
  encodePhase3Private,
  decodePhase3Private,
  encodePhase4Broadcast,
  decodePhase4Broadcast,
  identifyBlob,
  type DKGPhase1Broadcast,
  type DKGPhase1State,
  type DKGPhase2Broadcast,
  type DKGPhase2Private,
  type DKGPhase2FinalizeResult,
  type DKGPhase3Private,
  type DKGPhase4Broadcast,
  ThresholdMLDSA,
} from '../lib/dkg';
import type { ThresholdKeyShare } from '@btc-vision/post-quantum/threshold-ml-dsa.js';

// ── Types ──

type Step = 'join' | 'commit' | 'reveal' | 'masks' | 'aggregate' | 'complete';
type Role = 'initiator' | 'joiner';

interface DKGState {
  step: Step;
  role: Role;
  threshold: number;
  parties: number;
  level: number;
  sessionId: Uint8Array | null;
  myPartyId: number;
  instance: ThresholdMLDSA | null;

  // Phase 1
  phase1State: DKGPhase1State | null;
  myPhase1Blob: string | null;
  collectedPhase1: DKGPhase1Broadcast[];

  // Phase 2
  myPhase2PubBlob: string | null;
  myPhase2PrivBlobs: Map<number, string>;
  collectedPhase2Pub: DKGPhase2Broadcast[];
  collectedPhase2Priv: DKGPhase2Private[];

  // Phase 2 finalize + Phase 3
  phase2FinalResult: DKGPhase2FinalizeResult | null;
  myPhase3PrivBlobs: Map<number, string>;
  collectedPhase3Priv: DKGPhase3Private[];

  // Phase 4
  myPhase4Blob: string | null;
  collectedPhase4: DKGPhase4Broadcast[];

  // Result
  publicKey: Uint8Array | null;
  share: ThresholdKeyShare | null;

  // Bitmask setup
  bitmasks: readonly number[];
  holdersOf: ReadonlyMap<number, readonly number[]>;

  error: string | null;
}

type Action =
  | { type: 'SET_PARAMS'; threshold: number; parties: number; level: number }
  | { type: 'SET_ROLE'; role: Role }
  | { type: 'SET_PARTY_ID'; partyId: number }
  | { type: 'INIT_SESSION'; sessionId: Uint8Array; instance: ThresholdMLDSA; bitmasks: readonly number[]; holdersOf: ReadonlyMap<number, readonly number[]> }
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_PHASE1'; state: DKGPhase1State; blob: string; ownBroadcast: DKGPhase1Broadcast }
  | { type: 'ADD_PHASE1'; broadcast: DKGPhase1Broadcast }
  | { type: 'SET_PHASE2'; pubBlob: string; privBlobs: Map<number, string>; ownPub: DKGPhase2Broadcast }
  | { type: 'ADD_PHASE2_PUB'; broadcast: DKGPhase2Broadcast }
  | { type: 'ADD_PHASE2_PRIV'; priv: DKGPhase2Private }
  | { type: 'SET_PHASE2_FINAL'; result: DKGPhase2FinalizeResult; privBlobs: Map<number, string> }
  | { type: 'ADD_PHASE3_PRIV'; priv: DKGPhase3Private }
  | { type: 'SET_PHASE4'; blob: string; ownBroadcast: DKGPhase4Broadcast }
  | { type: 'ADD_PHASE4'; broadcast: DKGPhase4Broadcast }
  | { type: 'SET_RESULT'; publicKey: Uint8Array; share: ThresholdKeyShare }
  | { type: 'SET_ERROR'; error: string | null };

const initialState: DKGState = {
  step: 'join',
  role: 'initiator',
  threshold: 3,
  parties: 5,
  level: 44,
  sessionId: null,
  myPartyId: 0,
  instance: null,
  phase1State: null,
  myPhase1Blob: null,
  collectedPhase1: [],
  myPhase2PubBlob: null,
  myPhase2PrivBlobs: new Map(),
  collectedPhase2Pub: [],
  collectedPhase2Priv: [],
  phase2FinalResult: null,
  myPhase3PrivBlobs: new Map(),
  collectedPhase3Priv: [],
  myPhase4Blob: null,
  collectedPhase4: [],
  publicKey: null,
  share: null,
  bitmasks: [],
  holdersOf: new Map(),
  error: null,
};

function reducer(state: DKGState, action: Action): DKGState {
  switch (action.type) {
    case 'SET_PARAMS':
      return { ...state, threshold: action.threshold, parties: action.parties, level: action.level };
    case 'SET_ROLE':
      return { ...state, role: action.role };
    case 'SET_PARTY_ID':
      return { ...state, myPartyId: action.partyId };
    case 'INIT_SESSION':
      return { ...state, sessionId: action.sessionId, instance: action.instance, bitmasks: action.bitmasks, holdersOf: action.holdersOf };
    case 'SET_STEP':
      return { ...state, step: action.step, error: null };
    case 'SET_PHASE1':
      return { ...state, phase1State: action.state, myPhase1Blob: action.blob, collectedPhase1: [action.ownBroadcast] };
    case 'ADD_PHASE1': {
      if (state.collectedPhase1.some(b => b.partyId === action.broadcast.partyId)) return state;
      return { ...state, collectedPhase1: [...state.collectedPhase1, action.broadcast] };
    }
    case 'SET_PHASE2':
      return { ...state, myPhase2PubBlob: action.pubBlob, myPhase2PrivBlobs: action.privBlobs, collectedPhase2Pub: [action.ownPub] };
    case 'ADD_PHASE2_PUB': {
      if (state.collectedPhase2Pub.some(b => b.partyId === action.broadcast.partyId)) return state;
      return { ...state, collectedPhase2Pub: [...state.collectedPhase2Pub, action.broadcast] };
    }
    case 'ADD_PHASE2_PRIV': {
      if (state.collectedPhase2Priv.some(b => b.fromPartyId === action.priv.fromPartyId)) return state;
      return { ...state, collectedPhase2Priv: [...state.collectedPhase2Priv, action.priv] };
    }
    case 'SET_PHASE2_FINAL':
      return { ...state, phase2FinalResult: action.result, myPhase3PrivBlobs: action.privBlobs };
    case 'ADD_PHASE3_PRIV': {
      if (state.collectedPhase3Priv.some(b => b.fromGeneratorId === action.priv.fromGeneratorId)) return state;
      return { ...state, collectedPhase3Priv: [...state.collectedPhase3Priv, action.priv] };
    }
    case 'SET_PHASE4':
      return { ...state, myPhase4Blob: action.blob, collectedPhase4: [action.ownBroadcast] };
    case 'ADD_PHASE4': {
      if (state.collectedPhase4.some(b => b.partyId === action.broadcast.partyId)) return state;
      return { ...state, collectedPhase4: [...state.collectedPhase4, action.broadcast] };
    }
    case 'SET_RESULT':
      return { ...state, publicKey: action.publicKey, share: action.share };
    case 'SET_ERROR':
      return { ...state, error: action.error };
  }
}

// ── Step labels and indices ──

const STEPS: Step[] = ['join', 'commit', 'reveal', 'masks', 'aggregate', 'complete'];
const STEP_LABELS = ['Join', 'Commit', 'Reveal', 'Masks', 'Aggregate', 'Complete'];

// ── Extracted sub-components (defined outside DKGWizard to avoid re-creation) ──

function PartyTracker({ collected, total, myPartyId, label }: {
  collected: number[];
  total: number;
  myPartyId: number;
  label: string;
}) {
  return (
    <div className="party-tracker">
      <span className="tracker-label">{label}:</span>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`tracker-dot ${collected.includes(i) ? 'collected' : ''} ${i === myPartyId ? 'self' : ''}`}>
          {i + 1}{collected.includes(i) ? ' \u2713' : ' \u25CB'}
        </span>
      ))}
    </div>
  );
}

function PasteArea({ value, onChange, onProcess }: {
  value: string;
  onChange: (v: string) => void;
  onProcess: (v: string) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <textarea
        className="blob-textarea"
        placeholder="Paste a blob from another party here..."
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
      />
      <button
        className="btn btn-secondary btn-full"
        style={{ marginTop: 8 }}
        onClick={() => onProcess(value)}
        disabled={!value.trim()}
      >
        Process Blob
      </button>
    </div>
  );
}

function BlobOutput({ blob, label, isPrivate, targetParty, onCopy, copiedLabel }: {
  blob: string;
  label: string;
  isPrivate?: boolean;
  targetParty?: number;
  onCopy: (text: string, label: string) => void;
  copiedLabel: string | null;
}) {
  return (
    <div className={`blob-output-wrapper ${isPrivate ? 'private-blob-warning' : ''}`}>
      {isPrivate && targetParty !== undefined && (
        <div className="private-label">Private — share ONLY with Party {targetParty + 1}</div>
      )}
      <div className="blob-output-header">
        <span>{label}</span>
        <button
          className="btn-copy"
          onClick={() => onCopy(blob, label)}
        >
          {copiedLabel === label ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="blob-output">{blob}</div>
    </div>
  );
}

// ── Main component ──

export function DKGWizard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [pasteValue, setPasteValue] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const stepIndex = STEPS.indexOf(state.step);

  // ── Copy helper ──
  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => { setCopied(label); setTimeout(() => setCopied(null), 2000); },
      () => dispatch({ type: 'SET_ERROR', error: 'Failed to copy to clipboard' }),
    );
  }, []);

  // ── Session ID prefix for validation ──
  const sidPrefix = state.sessionId ? getSessionIdPrefix(state.sessionId) : '';

  // ── Smart paste handler ──
  const handlePaste = useCallback((text: string) => {
    if (!text.trim()) return;
    dispatch({ type: 'SET_ERROR', error: null });
    const info = identifyBlob(text.trim());
    if (!info) {
      dispatch({ type: 'SET_ERROR', error: 'Invalid blob format' });
      return;
    }
    // Validate session ID
    if (sidPrefix && info.sid !== sidPrefix) {
      dispatch({ type: 'SET_ERROR', error: `Wrong session (expected ${sidPrefix.slice(0, 8)}..., got ${info.sid.slice(0, 8)}...)` });
      return;
    }
    // Reject self-blobs
    if (info.from === state.myPartyId && info.type !== 'session') {
      dispatch({ type: 'SET_ERROR', error: 'This is your own blob — paste blobs from other parties' });
      return;
    }
    // Reject blobs addressed to someone else
    if (info.to !== -1 && info.to !== state.myPartyId) {
      dispatch({ type: 'SET_ERROR', error: `This blob is addressed to Party ${info.to + 1}, not you` });
      return;
    }

    // Route by type
    switch (info.type) {
      case 'p1': {
        const broadcast = decodePhase1Broadcast(text.trim());
        if (!broadcast) { dispatch({ type: 'SET_ERROR', error: 'Failed to decode Phase 1 blob' }); return; }
        if (state.collectedPhase1.some(b => b.partyId === broadcast.partyId)) {
          dispatch({ type: 'SET_ERROR', error: `Already have Phase 1 from Party ${broadcast.partyId + 1}` });
          return;
        }
        dispatch({ type: 'ADD_PHASE1', broadcast });
        break;
      }
      case 'p2pub': {
        const broadcast = decodePhase2Broadcast(text.trim());
        if (!broadcast) { dispatch({ type: 'SET_ERROR', error: 'Failed to decode Phase 2 public blob' }); return; }
        if (state.collectedPhase2Pub.some(b => b.partyId === broadcast.partyId)) {
          dispatch({ type: 'SET_ERROR', error: `Already have Phase 2 public from Party ${broadcast.partyId + 1}` });
          return;
        }
        dispatch({ type: 'ADD_PHASE2_PUB', broadcast });
        break;
      }
      case 'p2priv': {
        const priv = decodePhase2Private(text.trim());
        if (!priv) { dispatch({ type: 'SET_ERROR', error: 'Failed to decode Phase 2 private blob' }); return; }
        if (state.collectedPhase2Priv.some(b => b.fromPartyId === priv.fromPartyId)) {
          dispatch({ type: 'SET_ERROR', error: `Already have Phase 2 private from Party ${priv.fromPartyId + 1}` });
          return;
        }
        dispatch({ type: 'ADD_PHASE2_PRIV', priv });
        break;
      }
      case 'p3priv': {
        const priv = decodePhase3Private(text.trim());
        if (!priv) { dispatch({ type: 'SET_ERROR', error: 'Failed to decode Phase 3 blob' }); return; }
        if (state.collectedPhase3Priv.some(b => b.fromGeneratorId === priv.fromGeneratorId)) {
          dispatch({ type: 'SET_ERROR', error: `Already have Phase 3 from generator ${priv.fromGeneratorId + 1}` });
          return;
        }
        dispatch({ type: 'ADD_PHASE3_PRIV', priv });
        break;
      }
      case 'p4': {
        const broadcast = decodePhase4Broadcast(text.trim());
        if (!broadcast) { dispatch({ type: 'SET_ERROR', error: 'Failed to decode Phase 4 blob' }); return; }
        if (state.collectedPhase4.some(b => b.partyId === broadcast.partyId)) {
          dispatch({ type: 'SET_ERROR', error: `Already have Phase 4 from Party ${broadcast.partyId + 1}` });
          return;
        }
        dispatch({ type: 'ADD_PHASE4', broadcast });
        break;
      }
      default:
        dispatch({ type: 'SET_ERROR', error: `Unexpected blob type "${info.type}" for this step` });
    }
    setPasteValue('');
  }, [sidPrefix, state.myPartyId, state.collectedPhase1, state.collectedPhase2Pub, state.collectedPhase2Priv, state.collectedPhase3Priv, state.collectedPhase4]);

  // ════════════════════════════════════════════════════════════════════
  // STEP: JOIN
  // ════════════════════════════════════════════════════════════════════

  const handleCreateSession = useCallback(() => {
    const sid = generateSessionId();
    const inst = createDKGInstance(state.level, state.threshold, state.parties);
    const setup = inst.dkgSetup(sid);
    dispatch({ type: 'INIT_SESSION', sessionId: sid, instance: inst, bitmasks: setup.bitmasks, holdersOf: setup.holdersOf });
    dispatch({ type: 'SET_PARTY_ID', partyId: 0 }); // Initiator is party 0
  }, [state.level, state.threshold, state.parties]);

  const [joinPaste, setJoinPaste] = useState('');

  const handleJoinSession = useCallback(() => {
    const config = decodeSessionConfig(joinPaste.trim());
    if (!config) {
      dispatch({ type: 'SET_ERROR', error: 'Invalid session config blob' });
      return;
    }
    const sid = sessionIdFromHex(config.sid);
    dispatch({ type: 'SET_PARAMS', threshold: config.t, parties: config.n, level: config.level });
    const inst = createDKGInstance(config.level, config.t, config.n);
    const setup = inst.dkgSetup(sid);
    dispatch({ type: 'INIT_SESSION', sessionId: sid, instance: inst, bitmasks: setup.bitmasks, holdersOf: setup.holdersOf });
    dispatch({ type: 'SET_PARTY_ID', partyId: 1 }); // Default joiner to party 1 (party 0 is initiator)
  }, [joinPaste]);

  const sessionBlob = state.sessionId
    ? encodeSessionConfig(state.threshold, state.parties, state.level, state.sessionId)
    : null;

  // ════════════════════════════════════════════════════════════════════
  // STEP: COMMIT (Phase 1)
  // ════════════════════════════════════════════════════════════════════

  const handleGenerateCommitment = useCallback(() => {
    if (!state.instance || !state.sessionId) return;
    try {
      const { broadcast, state: ph1State } = state.instance.dkgPhase1(state.myPartyId, state.sessionId);
      const blob = encodePhase1Broadcast(broadcast, state.sessionId);
      dispatch({ type: 'SET_PHASE1', state: ph1State, blob, ownBroadcast: broadcast });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: `Phase 1 failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [state.instance, state.sessionId, state.myPartyId]);

  const phase1Ready = state.collectedPhase1.length === state.parties;

  // ════════════════════════════════════════════════════════════════════
  // STEP: REVEAL (Phase 2)
  // ════════════════════════════════════════════════════════════════════

  // Refs guard one-shot computations and also prevent StrictMode double-execution.
  // Reset on error so the phase can be retried.
  const phase2Computed = useRef(false);

  useEffect(() => {
    if (state.step !== 'reveal' || phase2Computed.current) return;
    if (!state.instance || !state.sessionId || !state.phase1State) return;
    if (state.collectedPhase1.length !== state.parties) return;
    phase2Computed.current = true;
    try {
      const sorted = [...state.collectedPhase1].sort((a, b) => a.partyId - b.partyId);
      const { broadcast, privateToHolders } = state.instance.dkgPhase2(
        state.myPartyId, state.sessionId, state.phase1State, sorted,
      );
      const pubBlob = encodePhase2Broadcast(broadcast, state.sessionId);
      const privBlobs = new Map<number, string>();
      for (const [targetId, priv] of privateToHolders) {
        privBlobs.set(targetId, encodePhase2Private(priv, targetId, state.sessionId));
      }
      dispatch({ type: 'SET_PHASE2', pubBlob, privBlobs, ownPub: broadcast });
    } catch (e) {
      phase2Computed.current = false;
      dispatch({ type: 'SET_ERROR', error: `Phase 2 failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [state.step, state.instance, state.sessionId, state.phase1State, state.myPartyId, state.collectedPhase1, state.parties]);

  // Count expected private blobs for Phase 2
  const getExpectedPhase2PrivCount = useCallback((): number => {
    const senders = new Set<number>();
    for (const holders of state.holdersOf.values()) {
      if (holders.includes(state.myPartyId)) {
        for (const h of holders) {
          if (h !== state.myPartyId) senders.add(h);
        }
      }
    }
    return senders.size;
  }, [state.holdersOf, state.myPartyId]);

  const phase2PubReady = state.collectedPhase2Pub.length === state.parties;
  const phase2PrivReady = state.collectedPhase2Priv.length >= getExpectedPhase2PrivCount();
  const phase2Ready = phase2PubReady && phase2PrivReady;

  // ════════════════════════════════════════════════════════════════════
  // STEP: MASKS (Phase 2 Finalize + Phase 3)
  // ════════════════════════════════════════════════════════════════════

  const phase2FinalComputed = useRef(false);

  useEffect(() => {
    if (state.step !== 'masks' || phase2FinalComputed.current) return;
    if (!state.instance || !state.sessionId || !state.phase1State) return;
    phase2FinalComputed.current = true;
    try {
      const sortedPh1 = [...state.collectedPhase1].sort((a, b) => a.partyId - b.partyId);
      const sortedPh2Pub = [...state.collectedPhase2Pub].sort((a, b) => a.partyId - b.partyId);

      const result = state.instance.dkgPhase2Finalize(
        state.myPartyId, state.sessionId, state.phase1State,
        sortedPh1, sortedPh2Pub, state.collectedPhase2Priv,
      );

      const privBlobs = new Map<number, string>();
      for (const [targetId, priv] of result.privateToAll) {
        privBlobs.set(targetId, encodePhase3Private(priv, targetId, state.sessionId));
      }

      dispatch({ type: 'SET_PHASE2_FINAL', result, privBlobs });
    } catch (e) {
      phase2FinalComputed.current = false;
      dispatch({ type: 'SET_ERROR', error: `Phase 2 Finalize failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [state.step, state.instance, state.sessionId, state.phase1State, state.myPartyId,
      state.collectedPhase1, state.collectedPhase2Pub, state.collectedPhase2Priv]);

  // Count expected Phase 3 private mask blobs
  const getExpectedPhase3PrivCount = useCallback((): number => {
    if (!state.phase2FinalResult) return 0;
    const generators = new Set<number>();
    for (const genId of state.phase2FinalResult.generatorAssignment.values()) {
      if (genId !== state.myPartyId) generators.add(genId);
    }
    return generators.size;
  }, [state.phase2FinalResult, state.myPartyId]);

  const phase3Ready = state.phase2FinalResult !== null &&
    state.collectedPhase3Priv.length >= getExpectedPhase3PrivCount();

  // ════════════════════════════════════════════════════════════════════
  // STEP: AGGREGATE (Phase 4)
  // ════════════════════════════════════════════════════════════════════

  const phase4Computed = useRef(false);

  useEffect(() => {
    if (state.step !== 'aggregate' || phase4Computed.current) return;
    if (!state.instance || !state.phase2FinalResult) return;
    phase4Computed.current = true;
    try {
      const broadcast = state.instance.dkgPhase4(
        state.myPartyId,
        state.bitmasks,
        state.phase2FinalResult.generatorAssignment,
        state.collectedPhase3Priv,
        state.phase2FinalResult.ownMaskPieces,
      );
      const blob = encodePhase4Broadcast(broadcast, state.sessionId!);
      dispatch({ type: 'SET_PHASE4', blob, ownBroadcast: broadcast });
    } catch (e) {
      phase4Computed.current = false;
      dispatch({ type: 'SET_ERROR', error: `Phase 4 failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [state.step, state.instance, state.sessionId, state.myPartyId,
      state.bitmasks, state.phase2FinalResult, state.collectedPhase3Priv]);

  const phase4Ready = state.collectedPhase4.length === state.parties;

  // ════════════════════════════════════════════════════════════════════
  // STEP: COMPLETE (Finalize)
  // ════════════════════════════════════════════════════════════════════

  const finalizeComputed = useRef(false);

  useEffect(() => {
    if (state.step !== 'complete' || finalizeComputed.current) return;
    if (!state.instance || !state.phase2FinalResult) return;
    finalizeComputed.current = true;
    try {
      const sortedPh4 = [...state.collectedPhase4].sort((a, b) => a.partyId - b.partyId);
      const { publicKey, share } = state.instance.dkgFinalize(
        state.myPartyId,
        state.phase2FinalResult.rho,
        sortedPh4,
        state.phase2FinalResult.shares,
      );
      dispatch({ type: 'SET_RESULT', publicKey, share });
    } catch (e) {
      finalizeComputed.current = false;
      dispatch({ type: 'SET_ERROR', error: `Finalize failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [state.step, state.instance, state.myPartyId, state.phase2FinalResult, state.collectedPhase4]);

  // ── Download handler ──
  const handleDownload = useCallback(async (password: string) => {
    if (!state.share || !state.publicKey) return;
    try {
      const { K, L } = getKL(state.level);
      const shareFile = await encryptShareV2(
        state.share,
        toHex(state.publicKey),
        state.threshold,
        state.parties,
        state.level,
        K, L,
        password,
      );
      downloadShareFile(shareFile);
      setShowPasswordModal(false);
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: `Encryption failed: ${e instanceof Error ? e.message : String(e)}` });
      setShowPasswordModal(false);
    }
  }, [state.share, state.publicKey, state.level, state.threshold, state.parties]);

  // ── Render ──

  return (
    <div className="ceremony">
      <h1>PERMAFROST DKG Ceremony</h1>
      <p className="subtitle">
        Distributed {state.threshold}-of-{state.parties} threshold ML-DSA key generation
      </p>

      {/* Step dots */}
      <div className="steps">
        {STEP_LABELS.map((_, i) => (
          <div
            key={i}
            className={`step-dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
          />
        ))}
      </div>

      {/* Do not refresh warning */}
      {stepIndex > 0 && stepIndex < 5 && (
        <div className="warning">
          Do not refresh this page — all ceremony state is held in memory.
        </div>
      )}

      {/* Error display */}
      {state.error && (
        <div className="warning" style={{ marginBottom: 16 }}>{state.error}</div>
      )}

      {/* ═══════ STEP: JOIN ═══════ */}
      {state.step === 'join' && (
        <div className="card">
          <h2>Join Ceremony</h2>

          {/* Role selector */}
          <div className="form-row" style={{ marginBottom: 24 }}>
            <label>
              Role
              <select
                value={state.role}
                onChange={e => dispatch({ type: 'SET_ROLE', role: e.target.value as Role })}
              >
                <option value="initiator">Initiator (create new session)</option>
                <option value="joiner">Joiner (paste session config)</option>
              </select>
            </label>
          </div>

          {state.role === 'initiator' && (
            <>
              <div className="form-row">
                <label>
                  Threshold (T)
                  <select
                    value={state.threshold}
                    onChange={e => {
                      const t = Number(e.target.value);
                      dispatch({ type: 'SET_PARAMS', threshold: t, parties: Math.max(t, state.parties), level: state.level });
                    }}
                  >
                    {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label>
                  Parties (N)
                  <select
                    value={state.parties}
                    onChange={e => dispatch({ type: 'SET_PARAMS', threshold: state.threshold, parties: Number(e.target.value), level: state.level })}
                  >
                    {[2, 3, 4, 5, 6].filter(n => n >= state.threshold).map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p>
                Dealerless DKG: no single party generates or sees all key material.
                Each party runs this page independently.
              </p>
              {!state.sessionId && (
                <button className="btn btn-primary btn-full" onClick={handleCreateSession}>
                  Create Session
                </button>
              )}
              {state.sessionId && sessionBlob && (
                <>
                  <BlobOutput blob={sessionBlob} label="Session Config" onCopy={copyToClipboard} copiedLabel={copied} />
                  <p style={{ fontSize: 13, color: 'var(--white-dim)' }}>
                    Share this blob with all {state.parties - 1} other parties.
                    You are Party 1 (index 0).
                  </p>
                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => dispatch({ type: 'SET_STEP', step: 'commit' })}
                  >
                    Continue to Commit Phase
                  </button>
                </>
              )}
            </>
          )}

          {state.role === 'joiner' && (
            <>
              <textarea
                className="blob-textarea"
                placeholder="Paste the session config blob from the initiator..."
                value={joinPaste}
                onChange={e => setJoinPaste(e.target.value)}
                rows={3}
              />
              {!state.sessionId && (
                <button
                  className="btn btn-secondary btn-full"
                  style={{ marginTop: 8 }}
                  onClick={handleJoinSession}
                  disabled={!joinPaste.trim()}
                >
                  Load Session
                </button>
              )}
              {state.sessionId && (
                <>
                  <div className="success-box" style={{ marginTop: 12 }}>
                    Session loaded: {state.threshold}-of-{state.parties}, ML-DSA-{state.level}
                  </div>
                  <div className="form-row">
                    <label>
                      I am Party
                      <select
                        value={state.myPartyId}
                        onChange={e => dispatch({ type: 'SET_PARTY_ID', partyId: Number(e.target.value) })}
                      >
                        {Array.from({ length: state.parties }, (_, i) => i)
                          .filter(i => i !== 0)
                          .map(i => (
                            <option key={i} value={i}>Party {i + 1}</option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--white-dim)' }}>
                    Coordinate with other parties to ensure each selects a unique party number.
                  </p>
                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => dispatch({ type: 'SET_STEP', step: 'commit' })}
                  >
                    Continue to Commit Phase
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════ STEP: COMMIT (Phase 1) ═══════ */}
      {state.step === 'commit' && (
        <div className="card">
          <h2>Phase 1: Commit</h2>
          <p>Generate your cryptographic commitment and share it with all parties.</p>

          {!state.myPhase1Blob && (
            <button className="btn btn-primary btn-full" onClick={handleGenerateCommitment}>
              Generate Commitment
            </button>
          )}

          {state.myPhase1Blob && (
            <>
              <BlobOutput blob={state.myPhase1Blob} label="My Phase 1 Commitment" onCopy={copyToClipboard} copiedLabel={copied} />
              <PartyTracker
                collected={state.collectedPhase1.map(b => b.partyId)}
                total={state.parties}
                myPartyId={state.myPartyId}
                label="Commitments"
              />
              <PasteArea value={pasteValue} onChange={setPasteValue} onProcess={handlePaste} />
              <button
                className="btn btn-primary btn-full"
                style={{ marginTop: 16 }}
                onClick={() => dispatch({ type: 'SET_STEP', step: 'reveal' })}
                disabled={!phase1Ready}
              >
                {phase1Ready
                  ? 'Continue to Reveal Phase'
                  : `Waiting for ${state.parties - state.collectedPhase1.length} more commitment(s)`}
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════ STEP: REVEAL (Phase 2) ═══════ */}
      {state.step === 'reveal' && (
        <div className="card">
          <h2>Phase 2: Reveal</h2>
          <p>Share your public reveal with everyone, and private reveals with specified parties.</p>

          {!state.myPhase2PubBlob && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <p>Computing Phase 2...</p>
            </div>
          )}

          {state.myPhase2PubBlob && (
            <>
              <BlobOutput blob={state.myPhase2PubBlob} label="Public Reveal (send to everyone)" onCopy={copyToClipboard} copiedLabel={copied} />

              {[...state.myPhase2PrivBlobs.entries()].map(([targetId, blob]) => (
                <BlobOutput
                  key={targetId}
                  blob={blob}
                  label={`Private for Party ${targetId + 1}`}
                  isPrivate
                  targetParty={targetId}
                  onCopy={copyToClipboard}
                  copiedLabel={copied}
                />
              ))}

              <PartyTracker
                collected={state.collectedPhase2Pub.map(b => b.partyId)}
                total={state.parties}
                myPartyId={state.myPartyId}
                label="Public reveals"
              />
              <div className="party-tracker" style={{ marginTop: 4 }}>
                <span className="tracker-label">Private reveals: {state.collectedPhase2Priv.length}/{getExpectedPhase2PrivCount()}</span>
              </div>

              <PasteArea value={pasteValue} onChange={setPasteValue} onProcess={handlePaste} />

              <button
                className="btn btn-primary btn-full"
                style={{ marginTop: 16 }}
                onClick={() => dispatch({ type: 'SET_STEP', step: 'masks' })}
                disabled={!phase2Ready}
              >
                {phase2Ready
                  ? 'Continue to Masks Phase'
                  : 'Waiting for more reveals...'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════ STEP: MASKS (Phase 2 Finalize + Phase 3) ═══════ */}
      {state.step === 'masks' && (
        <div className="card">
          <h2>Phase 3: Masks</h2>
          <p>Mask generation and distribution. Some parties generate masks for specific bitmask groups.</p>

          {!state.phase2FinalResult && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <p>Computing masks...</p>
            </div>
          )}

          {state.phase2FinalResult && (
            <>
              {/* Generator assignments */}
              <div className="generator-info">
                <strong>Generator assignments:</strong>
                {[...state.phase2FinalResult.generatorAssignment.entries()].slice(0, 8).map(([bitmask, genId]) => (
                  <div key={bitmask} style={{ fontSize: 12, color: 'var(--white-dim)' }}>
                    Bitmask {bitmask.toString(2).padStart(state.parties, '0')}: Party {genId + 1}
                    {genId === state.myPartyId ? ' (you)' : ''}
                  </div>
                ))}
                {state.phase2FinalResult.generatorAssignment.size > 8 && (
                  <div style={{ fontSize: 12, color: 'var(--white-dim)' }}>
                    ...and {state.phase2FinalResult.generatorAssignment.size - 8} more
                  </div>
                )}
              </div>

              {/* Private mask blobs to distribute */}
              {state.myPhase3PrivBlobs.size > 0 && (
                <>
                  <p style={{ marginTop: 16 }}>
                    You are a generator for some bitmasks. Send these private blobs:
                  </p>
                  {[...state.myPhase3PrivBlobs.entries()].map(([targetId, blob]) => (
                    <BlobOutput
                      key={targetId}
                      blob={blob}
                      label={`Masks for Party ${targetId + 1}`}
                      isPrivate
                      targetParty={targetId}
                      onCopy={copyToClipboard}
                      copiedLabel={copied}
                    />
                  ))}
                </>
              )}

              {state.myPhase3PrivBlobs.size === 0 && getExpectedPhase3PrivCount() === 0 && (
                <div className="success-box">
                  No mask exchange needed for your party in this round.
                </div>
              )}

              {getExpectedPhase3PrivCount() > 0 && (
                <>
                  <div className="party-tracker" style={{ marginTop: 12 }}>
                    <span className="tracker-label">
                      Received masks: {state.collectedPhase3Priv.length}/{getExpectedPhase3PrivCount()}
                    </span>
                  </div>
                  <PasteArea value={pasteValue} onChange={setPasteValue} onProcess={handlePaste} />
                </>
              )}

              <button
                className="btn btn-primary btn-full"
                style={{ marginTop: 16 }}
                onClick={() => dispatch({ type: 'SET_STEP', step: 'aggregate' })}
                disabled={!phase3Ready}
              >
                {phase3Ready
                  ? 'Continue to Aggregate Phase'
                  : 'Waiting for mask blobs...'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════ STEP: AGGREGATE (Phase 4) ═══════ */}
      {state.step === 'aggregate' && (
        <div className="card">
          <h2>Phase 4: Aggregate</h2>
          <p>Each party broadcasts their aggregate. Collect all to derive the shared public key.</p>

          {!state.myPhase4Blob && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <p>Computing aggregate...</p>
            </div>
          )}

          {state.myPhase4Blob && (
            <>
              <BlobOutput blob={state.myPhase4Blob} label="My Aggregate (send to everyone)" onCopy={copyToClipboard} copiedLabel={copied} />

              <PartyTracker
                collected={state.collectedPhase4.map(b => b.partyId)}
                total={state.parties}
                myPartyId={state.myPartyId}
                label="Aggregates"
              />

              <PasteArea value={pasteValue} onChange={setPasteValue} onProcess={handlePaste} />

              <button
                className="btn btn-primary btn-full"
                style={{ marginTop: 16 }}
                onClick={() => dispatch({ type: 'SET_STEP', step: 'complete' })}
                disabled={!phase4Ready}
              >
                {phase4Ready
                  ? 'Finalize Ceremony'
                  : `Waiting for ${state.parties - state.collectedPhase4.length} more aggregate(s)`}
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════ STEP: COMPLETE ═══════ */}
      {state.step === 'complete' && (
        <div className="card">
          <h2>Ceremony Complete</h2>

          {!state.publicKey && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <p>Finalizing key derivation...</p>
            </div>
          )}

          {state.publicKey && state.share && (
            <>
              <div className="success-box">
                Dealerless DKG complete. No single party ever had access to the full
                secret key. Each party holds only their own threshold share.
              </div>

              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Public Key (PERMAFROST Address)</h3>
              <div className="pubkey-display">{toHex(state.publicKey)}</div>
              <button
                className="btn btn-secondary btn-full"
                style={{ marginBottom: 24 }}
                onClick={() => copyToClipboard(toHex(state.publicKey!), 'pubkey')}
              >
                {copied === 'pubkey' ? 'Copied!' : 'Copy Public Key'}
              </button>

              <button
                className="btn btn-primary btn-full"
                onClick={() => setShowPasswordModal(true)}
              >
                Download Share File (Party {state.myPartyId + 1})
              </button>

              <div style={{ marginTop: 24 }}>
                <p><strong>Next steps:</strong></p>
                <ol style={{ color: 'var(--white-dim)', fontSize: 14, paddingLeft: 20 }}>
                  <li style={{ marginBottom: 8 }}>
                    Each party downloads and securely stores their share file
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Verify all parties derived the same public key
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Call <code>transferOwnership({toHex(state.publicKey).slice(0, 16)}...)</code> on
                    OD, ORC, and ODReserve contracts
                  </li>
                  <li>
                    Future admin operations will require {state.threshold} of {state.parties} parties
                    to co-sign via the cabal page
                  </li>
                </ol>
              </div>
            </>
          )}
        </div>
      )}

      {/* Password modal */}
      {showPasswordModal && (
        <PasswordModal
          partyId={state.myPartyId}
          onConfirm={handleDownload}
          onCancel={() => setShowPasswordModal(false)}
        />
      )}
    </div>
  );
}
