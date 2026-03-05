import { Router } from 'express';
import type { ServerConfig } from '../config.js';
import { buildStepMessage, verifyThresholdSignature, toHex } from '../lib/verify.js';
import { executeStep } from '../lib/executor.js';

// ---------------------------------------------------------------------------
// Step definitions (mirrors Admin.tsx STEPS — only the fields we need)
// ---------------------------------------------------------------------------

interface StepDef {
  id: number;
  method: string;
  contractKey: 'od' | 'orc' | 'reserve';
}

const STEPS: StepDef[] = [
  { id: 0, method: 'setReserve', contractKey: 'od' },
  { id: 1, method: 'setReserve', contractKey: 'orc' },
  { id: 2, method: 'mintORC', contractKey: 'reserve' },
  { id: 3, method: 'advancePhase', contractKey: 'reserve' },
  { id: 4, method: 'premintOD', contractKey: 'reserve' },
  // 5: external (MotoSwap UI)
  { id: 6, method: 'initPool', contractKey: 'reserve' },
  { id: 7, method: 'updateTwapSnapshot', contractKey: 'reserve' },
  { id: 8, method: 'advancePhase', contractKey: 'reserve' },
];

function getStepContract(step: StepDef, addresses: ServerConfig['addresses']): string {
  switch (step.contractKey) {
    case 'od':
      return addresses.od;
    case 'orc':
      return addresses.orc;
    case 'reserve':
      return addresses.reserve;
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
      stepId: number;
      params: Record<string, string>;
    };

    const step = STEPS.find((s) => s.id === stepId);
    if (!step) {
      res.status(400).json({ error: `Unknown step ${stepId}` });
      return;
    }

    const contract = getStepContract(step, config.addresses);
    const messageHash = buildStepMessage(stepId, step.method, contract, params ?? {});

    res.json({
      messageHash: toHex(messageHash),
      method: step.method,
      contract,
    });
  });

  // POST /submit — verify signature and execute step
  router.post('/submit', async (req, res) => {
    const { stepId, params, signature, messageHash } = req.body as {
      stepId: number;
      params: Record<string, string>;
      signature: string;
      messageHash: string;
    };

    // Validate inputs
    if (stepId === undefined || !signature || !messageHash) {
      res.status(400).json({ error: 'Missing required fields: stepId, signature, messageHash' });
      return;
    }

    const step = STEPS.find((s) => s.id === stepId);
    if (!step) {
      res.status(400).json({ error: `Unknown step ${stepId}` });
      return;
    }

    // Rebuild message hash from stepId + params to prevent tampering
    const contract = getStepContract(step, config.addresses);
    const rebuilt = buildStepMessage(stepId, step.method, contract, params ?? {});
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
      const { txId } = await executeStep(config, stepId, params ?? {});
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
