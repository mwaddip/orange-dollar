import { createHash } from 'node:crypto';
import { ml_dsa44 } from '@btc-vision/post-quantum/ml-dsa.js';

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const HEX_RE = /^(?:0x)?[0-9a-fA-F]*$/;

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value) && value.replace(/^0x/, '').length % 2 === 0;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Hex string must have even length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ML-DSA-44 signature verification
// ---------------------------------------------------------------------------

const ML_DSA44_SIG_SIZE = 2420;
const ML_DSA44_PK_SIZE = 1312;

export function verifyThresholdSignature(
  publicKeyHex: string,
  messageHash: Uint8Array,
  signatureHex: string,
): boolean {
  const pubKey = fromHex(publicKeyHex);
  if (pubKey.length !== ML_DSA44_PK_SIZE) return false;
  const sig = fromHex(signatureHex);
  if (sig.length !== ML_DSA44_SIG_SIZE) return false;
  return ml_dsa44.verify(sig, messageHash, pubKey);
}

// ---------------------------------------------------------------------------
// Deterministic step message builder
// ---------------------------------------------------------------------------

/**
 * Build a deterministic message for threshold signing.
 * SHA-256 of a canonical JSON payload describing the operation.
 *
 * Must produce identical output to Admin.tsx's buildStepMessage().
 */
export function buildStepMessage(
  stepId: number,
  method: string,
  contract: string,
  params: Record<string, string>,
): Uint8Array {
  const payload = JSON.stringify(
    { step: stepId, method, contract, params },
    Object.keys({ step: 0, method: '', contract: '', params: {} }),
  );
  const encoded = new TextEncoder().encode(payload);
  return new Uint8Array(createHash('sha256').update(encoded).digest());
}
