/**
 * Threshold ML-DSA signing protocol wrapper.
 *
 * Stub implementation until @btc-vision/post-quantum ships the
 * ThresholdMLDSA module. The data structures and flow match the
 * expected API from the PERMAFROST design.
 *
 * Each round produces a blob (hex string) for copy-paste exchange.
 * When the real library ships, replace the internals of each function.
 */

import type { DecryptedShare } from './share-crypto';

/** Signing session state held in memory. */
export interface SigningSession {
  /** The message (tx hash) being signed. */
  message: Uint8Array;
  /** This party's decrypted share. */
  share: DecryptedShare;
  /** Blobs collected from other parties per round. */
  round1Blobs: string[];
  round2Blobs: string[];
  round3Blobs: string[];
  /** This party's output blobs. */
  myRound1Blob?: string;
  myRound2Blob?: string;
  myRound3Blob?: string;
  /** Final combined signature. */
  signature?: Uint8Array;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(len: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(len)));
}

/**
 * Create a new signing session.
 */
export function createSession(
  message: Uint8Array,
  share: DecryptedShare,
): SigningSession {
  return {
    message,
    share,
    round1Blobs: [],
    round2Blobs: [],
    round3Blobs: [],
  };
}

/**
 * Round 1: Generate commitment.
 * Returns a blob to share with other parties.
 *
 * STUB: returns a random commitment hash.
 * Real: ThresholdMLDSA.round1(message, share)
 */
export function round1(session: SigningSession): string {
  const blob = JSON.stringify({
    round: 1,
    partyId: session.share.partyId,
    messageHash: toHex(session.message),
    commitment: randomHex(32),
  });
  session.myRound1Blob = btoa(blob);
  return session.myRound1Blob;
}

/**
 * Round 2: Generate response after collecting T commitment blobs.
 * Returns a blob to share with other parties.
 *
 * STUB: returns a random response.
 * Real: ThresholdMLDSA.round2(message, commitments, share)
 */
export function round2(session: SigningSession): string {
  const blob = JSON.stringify({
    round: 2,
    partyId: session.share.partyId,
    response: randomHex(64),
  });
  session.myRound2Blob = btoa(blob);
  return session.myRound2Blob;
}

/**
 * Round 3: Generate partial signature after collecting T response blobs.
 * Returns a blob to share with other parties.
 *
 * STUB: returns a random partial signature.
 * Real: ThresholdMLDSA.round3(message, responses, share)
 */
export function round3(session: SigningSession): string {
  const blob = JSON.stringify({
    round: 3,
    partyId: session.share.partyId,
    partialSig: randomHex(128),
  });
  session.myRound3Blob = btoa(blob);
  return session.myRound3Blob;
}

/**
 * Combine T partial signatures into a standard ML-DSA signature.
 *
 * STUB: returns a placeholder signature.
 * Real: ThresholdMLDSA.combine(partialSigs, publicKey)
 */
export function combine(session: SigningSession): Uint8Array {
  // Placeholder: 2420 bytes (ML-DSA-44 signature size)
  const sig = crypto.getRandomValues(new Uint8Array(2420));
  session.signature = sig;
  return sig;
}

/**
 * Decode a round blob received from another party.
 * Returns the parsed round data for display.
 */
export function decodeBlob(blob: string): { round: number; partyId: number } | null {
  try {
    const json = JSON.parse(atob(blob)) as { round?: number; partyId?: number };
    if (typeof json.round === 'number' && typeof json.partyId === 'number') {
      return { round: json.round, partyId: json.partyId };
    }
    return null;
  } catch {
    return null;
  }
}
