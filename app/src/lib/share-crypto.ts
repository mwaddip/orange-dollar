/**
 * PERMAFROST share file decryption.
 * Mirrors ceremony/src/lib/crypto.ts decrypt().
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function buf(arr: Uint8Array): ArrayBuffer {
  return new Uint8Array(arr).buffer as ArrayBuffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function decrypt(encoded: string, password: string): Promise<Uint8Array> {
  const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const salt = combined.slice(0, SALT_BYTES);
  const iv = combined.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ciphertext = combined.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(iv) },
    key,
    buf(ciphertext),
  );
  return new Uint8Array(plaintext);
}

/** Parsed share file (JSON on disk). */
export interface ShareFile {
  version: number;
  publicKey: string;
  partyId: number;
  threshold: number;
  parties: number;
  level: number;
  encrypted: string;
}

/** Decrypted share ready for signing. */
export interface DecryptedShare {
  publicKey: string;
  partyId: number;
  threshold: number;
  parties: number;
  level: number;
  shareBytes: Uint8Array;
}

/** Parse and decrypt a share file. Throws on wrong password. */
export async function decryptShareFile(
  file: ShareFile,
  password: string,
): Promise<DecryptedShare> {
  const shareBytes = await decrypt(file.encrypted, password);
  return {
    publicKey: file.publicKey,
    partyId: file.partyId,
    threshold: file.threshold,
    parties: file.parties,
    level: file.level,
    shareBytes,
  };
}
