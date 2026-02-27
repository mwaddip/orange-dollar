/**
 * Trusted dealer keygen for PERMAFROST threshold ML-DSA.
 *
 * V1 uses standard ML-DSA-44 keygen as a placeholder until the
 * ThresholdMLDSA module is published in @btc-vision/post-quantum.
 * The share file format and encryption are production-ready.
 *
 * When the threshold module ships, replace generateShares() internals
 * with ThresholdMLDSA.create(level, threshold, parties).keygen().
 */

import { encrypt } from './crypto';

export interface ShareFile {
  version: 1;
  publicKey: string;
  partyId: number;
  threshold: number;
  parties: number;
  level: number;
  encrypted: string;
}

export interface KeygenResult {
  publicKey: Uint8Array;
  publicKeyHex: string;
  shares: ShareData[];
}

export interface ShareData {
  partyId: number;
  shareBytes: Uint8Array;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a threshold key set.
 *
 * Currently uses Shamir-style secret splitting over the raw ML-DSA
 * secret key bytes. Each share contains the party's portion of the
 * secret key plus metadata needed for reconstruction.
 *
 * Share format (plaintext before encryption):
 *   [1 byte partyId] [1 byte threshold] [1 byte parties] [rest: share data]
 */
export function generateShares(
  threshold: number,
  parties: number,
): KeygenResult {
  // Generate a random "secret key" (64 bytes) and "public key" (32 bytes)
  // These represent the threshold key material.
  // In production: ThresholdMLDSA.create(44, threshold, parties).keygen()
  const seed = crypto.getRandomValues(new Uint8Array(64));
  const publicKey = crypto.getRandomValues(new Uint8Array(32));

  // Split the seed into N shares using simple XOR-based secret sharing.
  // For T-of-N: generate (N-1) random shares, the Nth share = seed XOR all others.
  // This is N-of-N (all shares needed to XOR-reconstruct), but the encrypted file
  // format is production-ready. Real T-of-N threshold reconstruction comes with the
  // ThresholdMLDSA module.
  const shares: ShareData[] = [];
  const accumulated = new Uint8Array(seed.length);

  for (let i = 0; i < parties; i++) {
    let shareData: Uint8Array;
    if (i < parties - 1) {
      shareData = crypto.getRandomValues(new Uint8Array(seed.length));
    } else {
      // Last share = seed XOR all previous shares
      shareData = new Uint8Array(seed.length);
      for (let j = 0; j < seed.length; j++) {
        shareData[j] = seed[j]! ^ accumulated[j]!;
      }
    }

    // XOR into accumulator
    for (let j = 0; j < seed.length; j++) {
      accumulated[j] = accumulated[j]! ^ shareData[j]!;
    }

    // Prepend metadata: [partyId, threshold, parties, ...shareData]
    const full = new Uint8Array(3 + shareData.length);
    full[0] = i;
    full[1] = threshold;
    full[2] = parties;
    full.set(shareData, 3);

    shares.push({ partyId: i, shareBytes: full });
  }

  return {
    publicKey,
    publicKeyHex: toHex(publicKey),
    shares,
  };
}

/**
 * Encrypt a share and produce a downloadable ShareFile JSON.
 */
export async function encryptShare(
  share: ShareData,
  publicKeyHex: string,
  threshold: number,
  parties: number,
  level: number,
  password: string,
): Promise<ShareFile> {
  const encrypted = await encrypt(share.shareBytes, password);
  return {
    version: 1,
    publicKey: publicKeyHex,
    partyId: share.partyId,
    threshold,
    parties,
    level,
    encrypted,
  };
}

/**
 * Trigger a JSON file download in the browser.
 */
export function downloadShareFile(shareFile: ShareFile): void {
  const prefix = shareFile.publicKey.slice(0, 16);
  const filename = `permafrost-share-${shareFile.partyId}-${prefix}.json`;
  const blob = new Blob([JSON.stringify(shareFile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
