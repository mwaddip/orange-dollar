import { Router } from 'express';
import { appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerConfig } from '../config.js';
import { buildStepMessage, verifyThresholdSignature, toHex, isHex } from '../lib/verify.js';
import { executeStep, buildPermafrostP2TR } from '../lib/executor.js';

// ---------------------------------------------------------------------------
// Step definitions (mirrors Admin.tsx STEPS — only the fields we need)
// ---------------------------------------------------------------------------

interface StepDef {
  id: number;
  method: string;
  contractKey: 'od' | 'orc' | 'reserve' | 'wbtc' | 'dynamic';
  /** For dynamic steps, the params key that holds the contract address. */
  contractParam?: string;
}

const STEPS: StepDef[] = [
  { id: 0, method: 'setReserve', contractKey: 'od' },
  { id: 1, method: 'setReserve', contractKey: 'orc' },
  { id: 2, method: 'increaseAllowance', contractKey: 'wbtc' },
  { id: 3, method: 'mintORC', contractKey: 'reserve' },
  { id: 4, method: 'advancePhase', contractKey: 'reserve' },
  { id: 5, method: 'premintOD', contractKey: 'reserve' },
  { id: 6, method: 'increaseAllowance', contractKey: 'od' },
  { id: 7, method: 'increaseAllowance', contractKey: 'wbtc' },
  // 8: external (MotoSwap UI)
  { id: 9, method: 'initPool', contractKey: 'reserve' },
  { id: 10, method: 'updateTwapSnapshot', contractKey: 'reserve' },
  { id: 11, method: 'advancePhase', contractKey: 'reserve' },
  { id: 12, method: 'transfer', contractKey: 'dynamic', contractParam: 'contractAddr' },
  { id: 13, method: 'transferOwnership', contractKey: 'dynamic', contractParam: 'contractAddr' },
];

function getStepContract(
  step: StepDef,
  addresses: ServerConfig['addresses'],
  params?: Record<string, string>,
): string {
  if (step.contractKey === 'dynamic' && step.contractParam && params) {
    return params[step.contractParam] ?? '';
  }
  switch (step.contractKey) {
    case 'od': return addresses.od;
    case 'orc': return addresses.orc;
    case 'wbtc': return addresses.wbtc;
    case 'reserve': return addresses.reserve;
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function cabalRouter(config: ServerConfig): Router {
  const router = Router();

  // POST /build-step — build message hash for threshold signing
  router.post('/build-step', (req, res) => {
    const { stepId, params } = req.body as {
      stepId: unknown;
      params: unknown;
    };

    if (typeof stepId !== 'number' || !Number.isInteger(stepId)) {
      res.status(400).json({ error: 'stepId must be an integer' });
      return;
    }

    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      res.status(400).json({ error: 'params must be an object' });
      return;
    }

    const step = STEPS.find((s) => s.id === stepId);
    if (!step) {
      res.status(400).json({ error: `Unknown step ${stepId}` });
      return;
    }

    const safeParams = (params ?? {}) as Record<string, string>;
    const contract = getStepContract(step, config.addresses, safeParams);
    const messageHash = buildStepMessage(stepId, step.method, contract, safeParams);

    res.json({
      messageHash: toHex(messageHash),
      method: step.method,
      contract,
    });
  });

  // GET /wallet-status — check if ECDSA signing wallet exists + expose public key
  router.get('/wallet-status', (_req, res) => {
    if (config.ecdsaPrivateKey) {
      const p2tr = buildPermafrostP2TR(config);
      res.json({ exists: true, p2tr, permafrostPublicKey: config.permafrostPublicKey });
    } else {
      res.json({ exists: false, permafrostPublicKey: config.permafrostPublicKey });
    }
  });

  // POST /generate-wallet — create ECDSA signing key (one-time)
  router.post('/generate-wallet', async (req, res) => {
    const { passphrase } = req.body as { passphrase?: string };

    if (config.ecdsaPrivateKey) {
      res.status(409).json({ error: 'Wallet already exists' });
      return;
    }

    if (!passphrase || passphrase !== config.walletPassphrase) {
      res.status(403).json({ error: 'Invalid passphrase' });
      return;
    }

    try {
      const { ECPairSigner, createNobleBackend } = await import('@btc-vision/ecpair');
      const { networks } = await import('@btc-vision/bitcoin');
      const { Address } = await import('@btc-vision/transaction');

      const network = config.opnetNetwork === 'regtest'
        ? networks.regtest
        : config.opnetNetwork === 'mainnet' || config.opnetNetwork === 'bitcoin'
          ? networks.bitcoin
          : networks.opnetTestnet;

      const backend = createNobleBackend();
      const ecPair = ECPairSigner.makeRandom(backend, network);

      const privKeyHex = Buffer.from(ecPair.privateKey!).toString('hex');

      // Build PERMAFROST address
      const mldsaPubKey = Buffer.from(config.permafrostPublicKey, 'hex');
      const permafrostAddress = new Address(mldsaPubKey, ecPair.publicKey);
      const p2tr = permafrostAddress.p2tr(network);

      // Append to .env file
      const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
      const envPath = resolve(serverDir, '.env');
      appendFileSync(envPath, `\nECDSA_PRIVATE_KEY=${privKeyHex}\n`);

      // Update config in memory
      config.ecdsaPrivateKey = privKeyHex;

      console.log(`[CABAL] Signing wallet generated — P2TR: ${p2tr}`);
      res.json({ p2tr });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[CABAL] Wallet generation failed:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /submit — verify signature and execute step
  router.post('/submit', async (req, res) => {
    const { stepId, params, signature, messageHash } = req.body as {
      stepId: unknown;
      params: unknown;
      signature: unknown;
      messageHash: unknown;
    };

    // Guard: wallet must exist
    if (!config.ecdsaPrivateKey) {
      res.status(503).json({ error: 'Signing wallet not yet generated' });
      return;
    }

    // -- Type validation --
    if (typeof stepId !== 'number' || !Number.isInteger(stepId)) {
      res.status(400).json({ error: 'stepId must be an integer' });
      return;
    }

    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      res.status(400).json({ error: 'params must be an object' });
      return;
    }

    if (!isHex(signature)) {
      res.status(400).json({ error: 'signature must be a hex string' });
      return;
    }

    // ML-DSA-44 signature = 2420 bytes = 4840 hex chars
    if (signature.replace(/^0x/, '').length !== 4840) {
      res.status(400).json({ error: 'signature must be exactly 2420 bytes (4840 hex chars)' });
      return;
    }

    if (!isHex(messageHash)) {
      res.status(400).json({ error: 'messageHash must be a hex string' });
      return;
    }

    // SHA-256 = 32 bytes = 64 hex chars
    if (messageHash.replace(/^0x/, '').length !== 64) {
      res.status(400).json({ error: 'messageHash must be exactly 32 bytes (64 hex chars)' });
      return;
    }

    const step = STEPS.find((s) => s.id === stepId);
    if (!step) {
      res.status(400).json({ error: `Unknown step ${stepId}` });
      return;
    }

    // Rebuild message hash from stepId + params to prevent tampering
    const safeParams = (params ?? {}) as Record<string, string>;
    const contract = getStepContract(step, config.addresses, safeParams);
    const rebuilt = buildStepMessage(stepId, step.method, contract, safeParams);
    const rebuiltHex = toHex(rebuilt);

    if (rebuiltHex !== messageHash) {
      res.status(400).json({ error: 'Message hash mismatch — params may have been tampered' });
      return;
    }

    // Verify ML-DSA-44 threshold signature
    const valid = verifyThresholdSignature(
      config.permafrostPublicKey,
      rebuilt,
      signature,
    );

    if (!valid) {
      res.status(403).json({ error: 'Invalid threshold signature' });
      return;
    }

    // Execute the step
    try {
      console.log(`[CABAL] Executing step ${stepId} (${step.method}) — signature verified`);
      const { txId } = await executeStep(config, stepId, safeParams);
      console.log(`[CABAL] Step ${stepId} submitted: ${txId}`);
      res.json({ success: true, txId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CABAL] Step ${stepId} failed:`, message);
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
