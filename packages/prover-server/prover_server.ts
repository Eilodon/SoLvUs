import { createHash } from 'crypto';
import { promises as fs } from 'fs';
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
  TravelRuleRecord,
  buildTravelRuleLegalPerson,
  bytesToHex,
  createDynamicDevMintFixture,
  DEV_SOLANA_ADDRESS,
  deriveTravelRuleDecisionRefHash,
  deriveTravelRuleRefHash,
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
  warmOracleOnDevnet,
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
const AUDIT_JOURNAL_PATH = path.join(workspaceRoot, 'config/compliance-audit-journal.jsonl');

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

type AuditEventType =
  | 'INSTITUTION_UPSERTED'
  | 'COMPLIANCE_PERMIT_ISSUED'
  | 'MINT_PREPARED'
  | 'MINT_SUBMITTED'
  | 'INSTITUTION_STATUS_CHANGED'
  | 'COMPLIANCE_PERMIT_REVOKED'
  | 'HOLDER_FREEZE_CHANGED'
  | 'PROTOCOL_PAUSE_CHANGED'
  | 'ORACLE_WARMED'
  | 'PROOF_WARMED';

interface ComplianceAuditRecord {
  record_id: string;
  recorded_at: string;
  recorded_unix: number;
  event_type: AuditEventType;
  institution_id_hash?: Hex;
  nullifier_hash?: Hex;
  operator?: string;
  amount?: number;
  kyt_score?: number;
  kyb_ref_hash?: Hex;
  travel_rule_ref_hash?: Hex;
  tx_signature?: string;
  slot?: number;
  status?: string;
  owner_pubkey?: string;
  metadata?: Record<string, unknown>;
}

// Phase 2 production path:
// the CompliancePermit becomes the policy trigger, and Fireblocks signs the
// operator leg only after policy approval. This interface is intentionally a
// typed stub, not a claim that the devnet demo already runs through Fireblocks.
interface FireblocksWebhookPayload {
  type: 'TRANSACTION_STATUS_UPDATED';
  data: {
    id: string;
    status: 'COMPLETED' | 'REJECTED' | 'FAILED';
    policyRule: {
      name: string;
      action: 'ALLOW' | 'BLOCK' | 'REQUIRE_APPROVAL';
    };
    amlScreeningResult?: {
      provider: string;
      payload: {
        action: 'PASS' | 'ALERT' | 'REJECT';
      };
    };
    signedMessages?: Array<{
      content: string;
      signature: {
        fullSig: string;
      };
    }>;
  };
}

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

function formatZkusdAmount(amount: number): string {
  return (amount / 1_000_000).toFixed(6);
}

function buildTravelRuleRecord(
  body: Record<string, unknown> | undefined,
  institutionLabel: string,
  ownerScope: string,
  zkusdAmount: number,
  now: number,
  travelRuleProviderLabel: string,
  originatorVaspLabel: string,
  beneficiaryVaspLabel: string,
  travelRuleReference: string,
): TravelRuleRecord {
  const originatorLei =
    typeof body?.originator_vasp_lei === 'string' && body.originator_vasp_lei.trim().length > 0
      ? body.originator_vasp_lei.trim()
      : '5493001KJTIIGC8Y1R12';
  const beneficiaryLei =
    typeof body?.beneficiary_vasp_lei === 'string' && body.beneficiary_vasp_lei.trim().length > 0
      ? body.beneficiary_vasp_lei.trim()
      : '254900OPPU84GM83MG36';

  return {
    schemaVersion: 'IVMS101-SOLVUS-1',
    originatorVasp: {
      vaspName: originatorVaspLabel,
      legalEntityIdentifier: originatorLei,
      jurisdiction: 'CH',
    },
    beneficiaryVasp: {
      vaspName: beneficiaryVaspLabel,
      legalEntityIdentifier: beneficiaryLei,
      jurisdiction: 'CH',
    },
    originator: {
      originatingVaspAccount: ownerScope,
      person: buildTravelRuleLegalPerson(institutionLabel, originatorLei),
    },
    beneficiary: {
      beneficiaryVaspAccount: 'solvus-issuance-desk',
      person: buildTravelRuleLegalPerson('Solvus Issuance Desk', beneficiaryLei),
    },
    transferData: {
      transferId: travelRuleReference,
      amount: formatZkusdAmount(zkusdAmount),
      assetType: 'BTC',
      settlementAsset: 'zkUSD',
      settlementChain: 'SOLANA',
      timestamp: new Date(now * 1000).toISOString(),
    },
    complianceDecision: {
      provider: travelRuleProviderLabel,
      decisionRef: travelRuleReference,
      action: 'PASS',
      timestamp: new Date(now * 1000).toISOString(),
    },
  };
}

async function appendAuditRecord(
  record: Omit<ComplianceAuditRecord, 'record_id' | 'recorded_at' | 'recorded_unix'>,
): Promise<ComplianceAuditRecord> {
  const recordedUnix = Math.floor(Date.now() / 1000);
  const persisted: ComplianceAuditRecord = {
    ...record,
    record_id: stableJsonHash({
      ...record,
      recorded_unix: recordedUnix,
      seed: Math.random().toString(16).slice(2),
    }),
    recorded_at: new Date(recordedUnix * 1000).toISOString(),
    recorded_unix: recordedUnix,
  };

  await fs.mkdir(path.dirname(AUDIT_JOURNAL_PATH), { recursive: true });
  await fs.appendFile(AUDIT_JOURNAL_PATH, `${JSON.stringify(persisted)}\n`, 'utf8');
  return persisted;
}

async function readAuditRecords(): Promise<ComplianceAuditRecord[]> {
  try {
    const raw = await fs.readFile(AUDIT_JOURNAL_PATH, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ComplianceAuditRecord);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function escapeCsvCell(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  const stringValue = String(value).replace(/"/g, '""');
  return `"${stringValue}"`;
}

function toAuditCsv(records: ComplianceAuditRecord[]): string {
  const headers = [
    'recorded_at',
    'event_type',
    'institution_id_hash',
    'nullifier_hash',
    'operator',
    'amount',
    'kyt_score',
    'kyb_ref_hash',
    'travel_rule_ref_hash',
    'status',
    'owner_pubkey',
    'tx_signature',
    'slot',
  ];
  const lines = [
    headers.join(','),
    ...records.map((record) =>
      headers
        .map((header) => escapeCsvCell(record[header as keyof ComplianceAuditRecord]))
        .join(','),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

async function logProvisioningEvents(
  result: {
    institution_upsert_signature?: string;
    compliance_permit_signature?: string;
    permission_profile?: InstitutionPermissionProfile;
    nullifier_hash?: Hex;
    owner?: string;
  },
  amount?: number,
): Promise<void> {
  const profile = result.permission_profile;
  if (!profile) {
    return;
  }

  if (result.institution_upsert_signature) {
    await appendAuditRecord({
      event_type: 'INSTITUTION_UPSERTED',
      institution_id_hash: profile.institution_id_hash,
      operator: result.owner,
      kyb_ref_hash: profile.kyb_ref_hash,
      tx_signature: result.institution_upsert_signature,
      metadata: {
        institution_label: profile.institution_label,
        daily_mint_cap: profile.daily_mint_cap,
        lifetime_mint_cap: profile.lifetime_mint_cap,
      },
    });
  }

  if (result.compliance_permit_signature) {
    await appendAuditRecord({
      event_type: 'COMPLIANCE_PERMIT_ISSUED',
      institution_id_hash: profile.institution_id_hash,
      nullifier_hash: result.nullifier_hash,
      operator: result.owner,
      amount,
      kyt_score: profile.kyt_score,
      kyb_ref_hash: profile.kyb_ref_hash,
      travel_rule_ref_hash: profile.travel_rule_ref_hash,
      tx_signature: result.compliance_permit_signature,
      metadata: {
        permit_expires_at: profile.permit_expires_at,
        travel_rule_provider: profile.travel_rule_provider_label,
      },
    });
  }
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
  const travelRuleRecord = buildTravelRuleRecord(
    body,
    institutionLabel,
    ownerScope,
    zkusdAmount,
    now,
    travelRuleProviderLabel,
    originatorVaspLabel,
    beneficiaryVaspLabel,
    travelRuleReference,
  );
  const kybRefHash = buildStructuredAuditHash('kyb_decision', {
    provider: kybProviderLabel,
    reference: kybReference,
    owner_scope: ownerScope,
    institution: institutionLabel,
  });
  const travelRuleDecisionRefHash = deriveTravelRuleDecisionRefHash(travelRuleRecord);
  const travelRuleRefHash = deriveTravelRuleRefHash(travelRuleRecord);

  return {
    institution_id_hash: buildStructuredAuditHash('institution', {
      institution: institutionLabel,
      owner_scope: ownerScope,
    }),
    institution_label: institutionLabel,
    kyb_ref_hash: kybRefHash,
    travel_rule_ref_hash: travelRuleRefHash,
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

app.get('/compliance/audit-trail', requireApiKey, async (req, res) => {
  try {
    const institutionIdHash = req.query.institution_id_hash;
    if (typeof institutionIdHash !== 'string' || institutionIdHash.length === 0) {
      return res.status(400).json({ error: 'institution_id_hash is required' });
    }

    const fromUnix = typeof req.query.from === 'string' ? Number(req.query.from) : 0;
    const toUnix =
      typeof req.query.to === 'string' ? Number(req.query.to) : Math.floor(Date.now() / 1000);
    const format = req.query.format === 'csv' ? 'csv' : 'json';

    const records = (await readAuditRecords())
      .filter((record) => record.institution_id_hash === institutionIdHash)
      .filter((record) => record.recorded_unix >= fromUnix && record.recorded_unix <= toUnix)
      .sort((left, right) => left.recorded_unix - right.recorded_unix);

    if (format === 'csv') {
      const csv = toAuditCsv(records);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit_${institutionIdHash.slice(2, 10)}_${Date.now()}.csv"`,
      );
      return res.send(csv);
    }

    return res.json({
      institution_id_hash: institutionIdHash,
      record_count: records.length,
      records,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown audit trail export failure';
    return res.status(500).json({
      code: 'ERROR_AUDIT_TRAIL_EXPORT_FAILED',
      error: 'Failed to export compliance audit trail',
      message,
    });
  }
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

app.post('/compliance/warm-oracle', requireApiKey, async (_req, res) => {
  try {
    const warmed = await warmOracleOnDevnet(config);
    const auditRecord = await appendAuditRecord({
      event_type: 'ORACLE_WARMED',
      metadata: warmed,
    });
    return res.json({
      success: true,
      ...warmed,
      audit_record_id: auditRecord.record_id,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown oracle warmup failure';
    return res.status(500).json({
      code: 'ERROR_ORACLE_WARMUP_FAILED',
      error: 'Failed to warm oracle path',
      message,
    });
  }
});

app.post('/compliance/warm-proof', requireApiKey, async (req, res) => {
  try {
    const requestedAddress = req.body?.solana_address;
    const fixture = await createDynamicDevMintFixture({
      solana_address: typeof requestedAddress === 'string' && requestedAddress.length > 0
        ? requestedAddress as Hex
        : DEV_SOLANA_ADDRESS,
    });
    const bundle = await generateDevnetMintProofBundle(fixture.prover_inputs);
    const auditRecord = await appendAuditRecord({
      event_type: 'PROOF_WARMED',
      nullifier_hash: fixture.prover_inputs.nullifier_hash,
      metadata: {
        prover_adapter_mode: getGroth16AdapterMode(),
        proof_bytes: (bundle.proof.length - 2) / 2,
        public_inputs_bytes: (bundle.public_inputs.length - 2) / 2,
      },
    });
    return res.json({
      success: true,
      nullifier_hash: fixture.prover_inputs.nullifier_hash,
      prover_adapter_mode: getGroth16AdapterMode(),
      proof_bytes: (bundle.proof.length - 2) / 2,
      public_inputs_bytes: (bundle.public_inputs.length - 2) / 2,
      audit_record_id: auditRecord.record_id,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown proof warmup failure';
    return res.status(500).json({
      code: 'ERROR_PROOF_WARMUP_FAILED',
      error: 'Failed to warm proof generation path',
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
    await appendAuditRecord({
      event_type: 'INSTITUTION_STATUS_CHANGED',
      institution_id_hash: institutionIdHash as Hex,
      status,
      tx_signature: signature,
    });
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
    const snapshot = await fetchPermissionedState(config, institutionIdHash as Hex, nullifierHash as Hex);
    await appendAuditRecord({
      event_type: 'COMPLIANCE_PERMIT_REVOKED',
      institution_id_hash: institutionIdHash as Hex,
      nullifier_hash: nullifierHash as Hex,
      operator: snapshot.permit?.operator,
      amount: snapshot.permit?.max_amount,
      kyt_score: snapshot.permit?.kyt_score,
      kyb_ref_hash: snapshot.permit?.kyb_ref_hash,
      travel_rule_ref_hash: snapshot.permit?.travel_rule_ref_hash,
      tx_signature: signature,
      status: snapshot.permit?.state,
    });
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
    const institutionIdHash = req.body?.institution_id_hash;
    if (typeof ownerPubkey !== 'string' || ownerPubkey.length === 0) {
      return res.status(400).json({ error: 'owner_pubkey is required' });
    }

    const signature = await setZkUsdAccountFreezeOnDevnet(config, ownerPubkey, true);
    await appendAuditRecord({
      event_type: 'HOLDER_FREEZE_CHANGED',
      institution_id_hash: typeof institutionIdHash === 'string' ? institutionIdHash as Hex : undefined,
      owner_pubkey: ownerPubkey,
      tx_signature: signature,
      status: 'frozen',
    });
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
    const institutionIdHash = req.body?.institution_id_hash;
    if (typeof ownerPubkey !== 'string' || ownerPubkey.length === 0) {
      return res.status(400).json({ error: 'owner_pubkey is required' });
    }

    const signature = await setZkUsdAccountFreezeOnDevnet(config, ownerPubkey, false);
    await appendAuditRecord({
      event_type: 'HOLDER_FREEZE_CHANGED',
      institution_id_hash: typeof institutionIdHash === 'string' ? institutionIdHash as Hex : undefined,
      owner_pubkey: ownerPubkey,
      tx_signature: signature,
      status: 'active',
    });
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
    await appendAuditRecord({
      event_type: 'PROTOCOL_PAUSE_CHANGED',
      tx_signature: signature,
      status: paused ? 'paused' : 'active',
    });
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

app.post('/compliance/record-mint-submission', requireApiKey, async (req, res) => {
  try {
    const institutionIdHash = req.body?.institution_id_hash;
    const nullifierHash = req.body?.nullifier_hash;
    const signature = req.body?.signature;
    if (typeof institutionIdHash !== 'string' || typeof nullifierHash !== 'string' || typeof signature !== 'string') {
      return res.status(400).json({ error: 'institution_id_hash, nullifier_hash, and signature are required' });
    }

    const snapshot = await fetchPermissionedState(config, institutionIdHash as Hex, nullifierHash as Hex);
    const auditRecord = await appendAuditRecord({
      event_type: 'MINT_SUBMITTED',
      institution_id_hash: institutionIdHash as Hex,
      nullifier_hash: nullifierHash as Hex,
      operator: snapshot.permit?.operator || snapshot.institution?.approved_operator,
      amount: snapshot.permit?.max_amount,
      kyt_score: snapshot.permit?.kyt_score,
      kyb_ref_hash: snapshot.permit?.kyb_ref_hash || snapshot.institution?.kyb_ref_hash,
      travel_rule_ref_hash: snapshot.permit?.travel_rule_ref_hash,
      tx_signature: signature,
      status: snapshot.permit?.state,
      metadata: {
        holder_frozen: snapshot.holder?.frozen ?? null,
        minted_total: snapshot.institution?.minted_total ?? null,
        current_period_minted: snapshot.institution?.current_period_minted ?? null,
      },
    });

    return res.json({
      success: true,
      audit_record_id: auditRecord.record_id,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown mint submission recording failure';
    return res.status(500).json({
      code: 'ERROR_RECORD_MINT_SUBMISSION_FAILED',
      error: 'Failed to record mint submission in compliance audit trail',
      message,
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
    await logProvisioningEvents(mintResult, zkusdAmount);
    await appendAuditRecord({
      event_type: 'MINT_SUBMITTED',
      institution_id_hash: permissionProfile.institution_id_hash,
      nullifier_hash: proverInputs.nullifier_hash,
      operator: mintResult.owner,
      amount: zkusdAmount,
      kyt_score: permissionProfile.kyt_score,
      kyb_ref_hash: permissionProfile.kyb_ref_hash,
      travel_rule_ref_hash: permissionProfile.travel_rule_ref_hash,
      tx_signature: mintResult.signature,
      status: 'used',
      metadata: {
        oracle_live_price_e8: mintResult.oracle_live_price_e8 ?? null,
        oracle_min_price_e8: mintResult.oracle_min_price_e8 ?? null,
        oracle_slippage_bps: mintResult.oracle_slippage_bps ?? null,
      },
    });

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
    await logProvisioningEvents(mintResult, zkusdAmount);
    await appendAuditRecord({
      event_type: 'MINT_PREPARED',
      institution_id_hash: permissionProfile.institution_id_hash,
      nullifier_hash: fixture.prover_inputs.nullifier_hash,
      operator: owner.toBase58(),
      amount: zkusdAmount,
      kyt_score: permissionProfile.kyt_score,
      kyb_ref_hash: permissionProfile.kyb_ref_hash,
      travel_rule_ref_hash: permissionProfile.travel_rule_ref_hash,
      status: mintResult.cached ? 'cached' : 'pending',
      metadata: {
        compliance_permit_pda: mintResult.compliance_permit_pda,
        oracle_live_price_e8: mintResult.oracle_live_price_e8 ?? null,
        oracle_min_price_e8: mintResult.oracle_min_price_e8 ?? null,
        oracle_slippage_bps: mintResult.oracle_slippage_bps ?? null,
      },
    });

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
