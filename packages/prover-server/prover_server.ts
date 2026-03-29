import { createHash } from 'crypto';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import Redis from 'ioredis';

const workspaceRoot = path.join(__dirname, '../..');
const solvusEnv = process.env.SOLVUS_ENV || 'devnet';
dotenv.config({
  path: [path.join(workspaceRoot, `config/${solvusEnv}.env`), path.join(workspaceRoot, '.env')],
});

import {
  Hex,
  InstitutionPermissionProfile,
  bytesToHex,
  createDynamicDevMintFixture,
  loadConfig,
  ProofResponse,
  ProverInputs,
  RELAYER_SIG_EXPIRY,
  stableJsonHash,
  validateBytesLength,
  validateFieldElementHex,
} from '../core';
import {
  fetchPermissionedState,
  getDevnetMintContext,
  mintOnDevnet,
  prepareMintOnDevnet,
  revokeCompliancePermitOnDevnet,
  setProtocolPauseOnDevnet,
  setInstitutionStatusOnDevnet,
  setZkUsdAccountFreezeOnDevnet,
} from './devnet_mint';
import {
  generateDevnetMintProofBundle,
  generateGroth16ProofBundle,
  getDevnetMintProofMode,
  getGroth16AdapterMode,
} from './groth16_adapter';

const app = express();
const config = loadConfig();
const PORT = process.env.PROVER_PORT || 3001;
const CACHE_TTL_SECONDS = Math.floor(RELAYER_SIG_EXPIRY / 1000);
const DEFAULT_L1_REFUND_TIMELOCK_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PERMISSIONED_MINT_TTL_SECONDS = 15 * 60;
const DEFAULT_INSTITUTION_LABEL = 'StableHacks Demo Treasury';
const COMPLIANCE_API_KEY = process.env.COMPLIANCE_API_KEY || '';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

type CacheBackendName = 'redis' | 'memory';

interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  getBackendName(): CacheBackendName;
}

function buildCache(): CacheBackend {
  const memory = new Map<string, { value: string; expiresAt: number }>();
  let backendName: CacheBackendName = 'memory';

  const readMemory = async (key: string): Promise<string | null> => {
    const cached = memory.get(key);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return cached.value;
  };

  const writeMemory = async (key: string, value: string, ttlSeconds: number): Promise<void> => {
    memory.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  };

  try {
    const redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });

    redis.on('connect', () => {
      backendName = 'redis';
      console.log('Connected to Redis for idempotency cache');
    });
    redis.on('error', (err) => {
      if (backendName !== 'memory') {
        console.warn('[cache] Redis unavailable; falling back to in-memory cache');
      }
      backendName = 'memory';
      console.warn('Redis connection error:', err.message);
    });

    void redis.connect().catch((err) => {
      backendName = 'memory';
      console.warn('[cache] Redis init failed; using in-memory cache');
      console.warn('Redis connection error:', err.message);
    });

    return {
      async get(key: string) {
        if (backendName !== 'redis') {
          return readMemory(key);
        }
        try {
          return await redis.get(key);
        } catch (error) {
          backendName = 'memory';
          return readMemory(key);
        }
      },
      async set(key: string, value: string, ttlSeconds: number) {
        if (backendName !== 'redis') {
          return writeMemory(key, value, ttlSeconds);
        }
        try {
          await redis.set(key, value, 'EX', ttlSeconds);
        } catch (error) {
          backendName = 'memory';
          await writeMemory(key, value, ttlSeconds);
        }
      },
      getBackendName() {
        return backendName;
      },
    };
  } catch (error) {
    console.warn('[cache] Redis init failed; using in-memory cache');
    return {
      get: readMemory,
      set: writeMemory,
      getBackendName: () => 'memory',
    };
  }
}

const cache = buildCache();

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!COMPLIANCE_API_KEY) {
    res.status(503).json({
      error: 'Compliance API key not configured',
      message: 'Set COMPLIANCE_API_KEY before using protected compliance endpoints',
    });
    return;
  }

  const provided = req.header('x-api-key');
  if (provided !== COMPLIANCE_API_KEY) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid x-api-key header required for compliance and devnet mint endpoints',
    });
    return;
  }

  next();
}

function resolveL1RefundTimelock(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > Math.floor(Date.now() / 1000)) {
    return value;
  }
  return Math.floor(Date.now() / 1000) + DEFAULT_L1_REFUND_TIMELOCK_SECONDS;
}

function hashReference(value: string): Hex {
  return `0x${createHash('sha256').update(value).digest('hex')}` as Hex;
}

function buildStructuredAuditHash(label: string, fields: Record<string, string | number | boolean>): Hex {
  return hashReference(
    JSON.stringify({
      label,
      ...fields,
    }),
  );
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`${fieldName} must be a positive integer when provided`);
}

function resolvePermissionProfile(
  body: Record<string, unknown> | undefined,
  ownerScope: string,
  zkusdAmount: number,
): InstitutionPermissionProfile {
  const now = Math.floor(Date.now() / 1000);
  const institutionLabel =
    typeof body?.institution_name === 'string' && body.institution_name.trim().length > 0
      ? body.institution_name.trim()
      : DEFAULT_INSTITUTION_LABEL;
  const dailyMintCap = readPositiveInteger(body?.daily_mint_cap, Math.max(zkusdAmount * 10, 10_000_000));
  const lifetimeMintCap = Math.max(
    readPositiveInteger(body?.lifetime_mint_cap, dailyMintCap * 10),
    dailyMintCap,
  );
  const permitTtlSeconds = readPositiveInteger(
    body?.permit_ttl_seconds,
    DEFAULT_PERMISSIONED_MINT_TTL_SECONDS,
  );
  const travelRuleRequired = body?.travel_rule_required !== false;
  const kybReference =
    typeof body?.kyb_reference === 'string' && body.kyb_reference.trim().length > 0
      ? body.kyb_reference.trim()
      : `KYB:${institutionLabel}:${ownerScope}`;
  const travelRuleReference =
    typeof body?.travel_rule_reference === 'string' && body.travel_rule_reference.trim().length > 0
      ? body.travel_rule_reference.trim()
      : `TRAVEL:${institutionLabel}:${ownerScope}:${now}`;
  const kybProviderLabel =
    typeof body?.kyb_provider === 'string' && body.kyb_provider.trim().length > 0
      ? body.kyb_provider.trim()
      : 'solvus-devnet-kyb-gateway';
  const travelRuleProviderLabel =
    typeof body?.travel_rule_provider === 'string' && body.travel_rule_provider.trim().length > 0
      ? body.travel_rule_provider.trim()
      : 'solvus-devnet-travel-rule-gateway';
  const originatorVaspLabel =
    typeof body?.originator_vasp === 'string' && body.originator_vasp.trim().length > 0
      ? body.originator_vasp.trim()
      : `${institutionLabel} Treasury`;
  const beneficiaryVaspLabel =
    typeof body?.beneficiary_vasp === 'string' && body.beneficiary_vasp.trim().length > 0
      ? body.beneficiary_vasp.trim()
      : 'Solvus Issuance Desk';
  const kybProviderRefHash = buildStructuredAuditHash('kyb_provider', {
    provider: kybProviderLabel,
  });
  const travelRuleProviderRefHash = buildStructuredAuditHash('travel_rule_provider', {
    provider: travelRuleProviderLabel,
  });
  const originatorVaspRefHash = buildStructuredAuditHash('originator_vasp', {
    vasp: originatorVaspLabel,
  });
  const beneficiaryVaspRefHash = buildStructuredAuditHash('beneficiary_vasp', {
    vasp: beneficiaryVaspLabel,
  });
  const kybRefHash = buildStructuredAuditHash('kyb_decision', {
    provider: kybProviderLabel,
    reference: kybReference,
    owner_scope: ownerScope,
    institution: institutionLabel,
  });
  const travelRuleDecisionRefHash = buildStructuredAuditHash('travel_rule_decision', {
    provider: travelRuleProviderLabel,
    reference: travelRuleReference,
    originator_vasp: originatorVaspLabel,
    beneficiary_vasp: beneficiaryVaspLabel,
    owner_scope: ownerScope,
  });

  return {
    institution_id_hash: buildStructuredAuditHash('institution', {
      institution: institutionLabel,
      owner_scope: ownerScope,
    }),
    institution_label: institutionLabel,
    kyb_ref_hash: kybRefHash,
    travel_rule_ref_hash: travelRuleDecisionRefHash,
    kyb_provider_ref_hash: kybProviderRefHash,
    travel_rule_provider_ref_hash: travelRuleProviderRefHash,
    travel_rule_decision_ref_hash: travelRuleDecisionRefHash,
    originator_vasp_ref_hash: originatorVaspRefHash,
    beneficiary_vasp_ref_hash: beneficiaryVaspRefHash,
    kyb_provider_label: kybProviderLabel,
    travel_rule_provider_label: travelRuleProviderLabel,
    originator_vasp_label: originatorVaspLabel,
    beneficiary_vasp_label: beneficiaryVaspLabel,
    permit_expires_at: now + permitTtlSeconds,
    kyt_score: readPositiveInteger(body?.kyt_score, 24),
    daily_mint_cap: dailyMintCap,
    lifetime_mint_cap: lifetimeMintCap,
    travel_rule_required: travelRuleRequired,
  };
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Math.floor(Date.now() / 1000),
    prover_backend: config.proverBackend,
    prover_adapter_mode: getGroth16AdapterMode(),
    devnet_mint_proof_mode: getDevnetMintProofMode(),
    cache_backend: cache.getBackendName(),
    solvus_program_id: config.solvusProgramId || null,
    groth16_verifier_program_id: config.groth16VerifierProgramId || null,
    oracle_price_feed_id: config.oraclePriceFeedId || null,
    devnet_mint: getDevnetMintContext(config),
    compliance_api_key_configured: COMPLIANCE_API_KEY.length > 0,
  });
});

app.get('/compliance/state', async (req, res) => {
  try {
    const institutionIdHash = req.query.institution_id_hash;
    const nullifierHash = req.query.nullifier_hash;
    if (typeof institutionIdHash !== 'string' || typeof nullifierHash !== 'string') {
      return res.status(400).json({ error: 'institution_id_hash and nullifier_hash are required' });
    }

    const snapshot = await fetchPermissionedState(
      config,
      institutionIdHash as Hex,
      nullifierHash as Hex,
    );
    return res.json(snapshot);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown compliance state failure';
    return res.status(500).json({
      code: 'ERROR_COMPLIANCE_STATE_FAILED',
      error: 'Failed to load compliance state',
      message,
    });
  }
});

app.post('/compliance/institution-status', requireApiKey, async (req, res) => {
  try {
    const institutionIdHash = req.body?.institution_id_hash;
    const status = req.body?.status;
    if (typeof institutionIdHash !== 'string') {
      return res.status(400).json({ error: 'institution_id_hash is required' });
    }
    if (status !== 'active' && status !== 'suspended' && status !== 'terminated') {
      return res.status(400).json({ error: 'status must be active, suspended, or terminated' });
    }

    const signature = await setInstitutionStatusOnDevnet(config, institutionIdHash as Hex, status);
    return res.json({
      success: true,
      institution_id_hash: institutionIdHash,
      status,
      signature,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown institution status failure';
    return res.status(500).json({
      code: 'ERROR_INSTITUTION_STATUS_FAILED',
      error: 'Failed to update institution status',
      message,
    });
  }
});

app.post('/compliance/revoke-permit', requireApiKey, async (req, res) => {
  try {
    const institutionIdHash = req.body?.institution_id_hash;
    const nullifierHash = req.body?.nullifier_hash;
    if (typeof institutionIdHash !== 'string' || typeof nullifierHash !== 'string') {
      return res.status(400).json({ error: 'institution_id_hash and nullifier_hash are required' });
    }

    const signature = await revokeCompliancePermitOnDevnet(
      config,
      institutionIdHash as Hex,
      nullifierHash as Hex,
    );
    return res.json({
      success: true,
      institution_id_hash: institutionIdHash,
      nullifier_hash: nullifierHash,
      signature,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown permit revoke failure';
    return res.status(500).json({
      code: 'ERROR_PERMIT_REVOKE_FAILED',
      error: 'Failed to revoke compliance permit',
      message,
    });
  }
});

app.post('/compliance/freeze-holder', requireApiKey, async (req, res) => {
  try {
    const ownerPubkey = req.body?.owner_pubkey;
    if (typeof ownerPubkey !== 'string' || ownerPubkey.length === 0) {
      return res.status(400).json({ error: 'owner_pubkey is required' });
    }

    const signature = await setZkUsdAccountFreezeOnDevnet(config, ownerPubkey, true);
    return res.json({
      success: true,
      owner_pubkey: ownerPubkey,
      frozen: true,
      signature,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown holder freeze failure';
    return res.status(500).json({
      code: 'ERROR_HOLDER_FREEZE_FAILED',
      error: 'Failed to freeze holder account',
      message,
    });
  }
});

app.post('/compliance/thaw-holder', requireApiKey, async (req, res) => {
  try {
    const ownerPubkey = req.body?.owner_pubkey;
    if (typeof ownerPubkey !== 'string' || ownerPubkey.length === 0) {
      return res.status(400).json({ error: 'owner_pubkey is required' });
    }

    const signature = await setZkUsdAccountFreezeOnDevnet(config, ownerPubkey, false);
    return res.json({
      success: true,
      owner_pubkey: ownerPubkey,
      frozen: false,
      signature,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown holder thaw failure';
    return res.status(500).json({
      code: 'ERROR_HOLDER_THAW_FAILED',
      error: 'Failed to thaw holder account',
      message,
    });
  }
});

app.post('/protocol/pause', requireApiKey, async (req, res) => {
  try {
    const paused = Boolean(req.body?.paused);
    const signature = await setProtocolPauseOnDevnet(config, paused);
    res.json({
      ok: true,
      paused,
      signature,
    });
  } catch (error: any) {
    console.error('[protocol/pause]', error);
    res.status(500).json({
      error: error?.message || 'Failed to update protocol pause state',
    });
  }
});

app.post('/prove', async (req, res) => {
  req.setTimeout(45000);  // ADR-004: 45s < Solana tx timeout (~40s)

  try {
    const proverInputs = req.body?.prover_inputs as ProverInputs | undefined;
    if (!proverInputs) {
      return res.status(400).json({ error: 'Missing prover_inputs' });
    }

    assertValidProverInputs(proverInputs);

    const idempotencyKey =
      (req.header('X-Idempotency-Key') || stableJsonHash(proverInputs)).toLowerCase();
    
    // Check Redis cache for idempotency
    const cached = await cache.get(`idempotency:${idempotencyKey}`);
    if (cached) {
      const parsed = JSON.parse(cached) as { expiresAt: number; response: ProofResponse };
      const now = Math.floor(Date.now() / 1000);
      if (parsed.expiresAt > now) {
        return res.json({
          ...parsed.response,
          cached: true,
          retry_count: 1,
        });
      }
    }

    const startedAt = Date.now();
    const bundle = await generateGroth16ProofBundle(proverInputs);
    const response: ProofResponse = {
      proof: bundle.proof,
      public_inputs: bundle.public_inputs,
      proving_time: Date.now() - startedAt,
      cached: false,
      retry_count: 0,
    };

    // Store in Redis with TTL
    const expiresAt = Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS;
    await cache.set(
      `idempotency:${idempotencyKey}`,
      JSON.stringify({ expiresAt, response }),
      CACHE_TTL_SECONDS,
    );

    return res.json(response);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown proving failure';
    return res.status(500).json({
      code: 'ERROR_PROOF_SERVER_TIMEOUT',
      error: 'Proof generation failed',
      message,
    });
  }
});

app.post('/mint-devnet', requireApiKey, async (req, res) => {
  req.setTimeout(45000);  // ADR-004: 45s < Solana tx timeout

  try {
    const proverInputs = req.body?.prover_inputs as ProverInputs | undefined;
    const zkusdAmount = Number(req.body?.zkusd_amount ?? 1_000_000);
    const l1RefundTimelock = resolveL1RefundTimelock(req.body?.l1_refund_timelock);
    const minBtcPriceE8 = readOptionalPositiveInteger(req.body?.min_btc_price_e8, 'min_btc_price_e8');
    if (!proverInputs) {
      return res.status(400).json({ error: 'Missing prover_inputs' });
    }
    if (!Number.isInteger(zkusdAmount) || zkusdAmount <= 0) {
      return res.status(400).json({ error: 'zkusd_amount must be a positive integer' });
    }

    assertValidProverInputs(proverInputs);
    const bundle = await generateDevnetMintProofBundle(proverInputs);
    const permissionProfile = resolvePermissionProfile(
      req.body as Record<string, unknown> | undefined,
      'server-admin',
      zkusdAmount,
    );
    const mintResult = await mintOnDevnet(config, {
      nullifier_hash: proverInputs.nullifier_hash,
      zkusd_amount: zkusdAmount,
      proof: bundle.proof,
      public_inputs: bundle.public_inputs,
      l1_refund_timelock: l1RefundTimelock,
      min_btc_price_e8: minBtcPriceE8,
    }, permissionProfile);

    return res.json({
      success: true,
      zkusd_amount: zkusdAmount,
      ...mintResult,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown devnet mint failure';
    return res.status(500).json({
      code: 'ERROR_DEVNET_MINT_FAILED',
      error: 'Devnet mint failed',
      message,
    });
  }
});

app.post('/prepare-devnet-mint', requireApiKey, async (req, res) => {
  req.setTimeout(45000);  // ADR-004: 45s < Solana tx timeout

  try {
    const ownerPubkey = req.body?.owner_pubkey;
    const zkusdAmount = Number(req.body?.zkusd_amount ?? 1_000_000);
    const l1RefundTimelock = resolveL1RefundTimelock(req.body?.l1_refund_timelock);
    const minBtcPriceE8 = readOptionalPositiveInteger(req.body?.min_btc_price_e8, 'min_btc_price_e8');
    if (typeof ownerPubkey !== 'string' || ownerPubkey.length === 0) {
      return res.status(400).json({ error: 'Missing owner_pubkey' });
    }
    if (!Number.isInteger(zkusdAmount) || zkusdAmount <= 0) {
      return res.status(400).json({ error: 'zkusd_amount must be a positive integer' });
    }

    const owner = new PublicKey(ownerPubkey);
    const permissionProfile = resolvePermissionProfile(
      req.body as Record<string, unknown> | undefined,
      owner.toBase58(),
      zkusdAmount,
    );
    const fixture = await createDynamicDevMintFixture({
      solana_address: bytesToHex(owner.toBytes()),
    });
    assertValidProverInputs(fixture.prover_inputs);

    const bundle = await generateDevnetMintProofBundle(fixture.prover_inputs);
    const mintResult = await prepareMintOnDevnet(config, owner.toBase58(), {
      nullifier_hash: fixture.prover_inputs.nullifier_hash,
      zkusd_amount: zkusdAmount,
      proof: bundle.proof,
      public_inputs: bundle.public_inputs,
      l1_refund_timelock: l1RefundTimelock,
      min_btc_price_e8: minBtcPriceE8,
    }, permissionProfile);

    return res.json({
      success: true,
      zkusd_amount: zkusdAmount,
      prover_inputs: fixture.prover_inputs,
      ...mintResult,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown prepare devnet mint failure';
    return res.status(500).json({
      code: 'ERROR_PREPARE_DEVNET_MINT_FAILED',
      error: 'Prepare devnet mint failed',
      message,
    });
  }
});

function assertValidProverInputs(inputs: ProverInputs): void {
  validateBytesLength(inputs.dlc_contract_id, 32, 'dlc_contract_id');
  validateBytesLength(inputs.pubkey_x, 32, 'pubkey_x');
  validateBytesLength(inputs.pubkey_y, 32, 'pubkey_y');
  validateBytesLength(inputs.user_sig, 64, 'user_sig');
  validateBytesLength(inputs.relayer_sig, 64, 'relayer_sig');
  validateBytesLength(inputs.solana_address, 32, 'solana_address');
  validateBytesLength(inputs.relayer_pubkey_x, 32, 'relayer_pubkey_x');
  validateBytesLength(inputs.relayer_pubkey_y, 32, 'relayer_pubkey_y');
  validateBytesLength(inputs.nullifier_hash, 32, 'nullifier_hash');
  validateFieldElementHex(inputs.dlc_contract_id, 'dlc_contract_id');
  validateFieldElementHex(inputs.nullifier_secret, 'nullifier_secret');

  if (inputs.btc_data <= 0) {
    throw new Error('btc_data must be greater than zero');
  }
}

app.listen(PORT, () => {
  console.log(`Solvus Prover Server running on port ${PORT} with backend=${config.proverBackend}`);
});
