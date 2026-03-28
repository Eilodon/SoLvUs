import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('error', (err) => console.error('Redis connection error:', err));
redis.on('connect', () => console.log('Connected to Redis for idempotency cache'));

const workspaceRoot = path.join(__dirname, '../..');
const solvusEnv = process.env.SOLVUS_ENV || 'devnet';
dotenv.config({
  path: [path.join(workspaceRoot, `config/${solvusEnv}.env`), path.join(workspaceRoot, '.env')],
});

import {
  bytesToHex,
  createDynamicDevMintFixture,
  loadConfig,
  ProofResponse,
  ProverInputs,
  RELAYER_SIG_EXPIRY,
  stableJsonHash,
  validateBytesLength,
} from '../core';
import { getDevnetMintContext, mintOnDevnet, prepareMintOnDevnet } from './devnet_mint';
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

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Math.floor(Date.now() / 1000),
    prover_backend: config.proverBackend,
    prover_adapter_mode: getGroth16AdapterMode(),
    devnet_mint_proof_mode: getDevnetMintProofMode(),
    cache_backend: 'redis',
    solvus_program_id: config.solvusProgramId || null,
    groth16_verifier_program_id: config.groth16VerifierProgramId || null,
    oracle_price_feed_id: config.oraclePriceFeedId || null,
    devnet_mint: getDevnetMintContext(config),
  });
});

app.post('/prove', async (req, res) => {
  req.setTimeout(180000);

  try {
    const proverInputs = req.body?.prover_inputs as ProverInputs | undefined;
    if (!proverInputs) {
      return res.status(400).json({ error: 'Missing prover_inputs' });
    }

    assertValidProverInputs(proverInputs);

    const idempotencyKey =
      (req.header('X-Idempotency-Key') || stableJsonHash(proverInputs)).toLowerCase();
    
    // Check Redis cache for idempotency
    const cached = await redis.get(`idempotency:${idempotencyKey}`);
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
    await redis.set(
      `idempotency:${idempotencyKey}`,
      JSON.stringify({ expiresAt, response }),
      'EX',
      CACHE_TTL_SECONDS
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

app.post('/mint-devnet', async (req, res) => {
  req.setTimeout(180000);

  try {
    const proverInputs = req.body?.prover_inputs as ProverInputs | undefined;
    const zkusdAmount = Number(req.body?.zkusd_amount ?? 1_000_000);
    if (!proverInputs) {
      return res.status(400).json({ error: 'Missing prover_inputs' });
    }
    if (!Number.isInteger(zkusdAmount) || zkusdAmount <= 0) {
      return res.status(400).json({ error: 'zkusd_amount must be a positive integer' });
    }

    assertValidProverInputs(proverInputs);
    const bundle = await generateDevnetMintProofBundle(proverInputs);
    const mintResult = await mintOnDevnet(config, {
      nullifier_hash: proverInputs.nullifier_hash,
      zkusd_amount: zkusdAmount,
      proof: bundle.proof,
      public_inputs: bundle.public_inputs,
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

app.post('/prepare-devnet-mint', async (req, res) => {
  req.setTimeout(180000);

  try {
    const ownerPubkey = req.body?.owner_pubkey;
    const zkusdAmount = Number(req.body?.zkusd_amount ?? 1_000_000);
    if (typeof ownerPubkey !== 'string' || ownerPubkey.length === 0) {
      return res.status(400).json({ error: 'Missing owner_pubkey' });
    }
    if (!Number.isInteger(zkusdAmount) || zkusdAmount <= 0) {
      return res.status(400).json({ error: 'zkusd_amount must be a positive integer' });
    }

    const owner = new PublicKey(ownerPubkey);
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

  if (inputs.btc_data <= 0) {
    throw new Error('btc_data must be greater than zero');
  }
}

app.listen(PORT, () => {
  console.log(`Solvus Prover Server running on port ${PORT} with backend=${config.proverBackend}`);
});
