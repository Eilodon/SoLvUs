import { createHash } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import {
  COMPLIANCE_PERMIT_SEED,
  Hex,
  INSTITUTION_ACCOUNT_SEED,
  InstitutionPermissionProfile,
  MintZkUSDInput,
  PDA_NULLIFIER_SEED,
  PROTOCOL_CONFIG_SEED,
  SolvusConfig,
  SPL_TOKEN_PROGRAM_ID,
  VERIFICATION_PAYLOAD_SEED,
  ZKUSD_MINT_AUTHORITY_SEED,
  bytesToHex,
  hexToBytes,
} from '../core';

const WORKSPACE_ROOT = path.join(__dirname, '../..');
const DEFAULT_MINT_KEYPAIR_PATH = path.join(WORKSPACE_ROOT, 'config/devnet-zkusd-mint-keypair.json');
const MAX_LEGACY_TRANSACTION_BYTES = 1232;
const MINT_ZKUSD_COMPUTE_UNIT_LIMIT = 1_400_000;
const VERIFICATION_PAYLOAD_CHUNK_BYTES = 700;
const PYTH_HERMES_LATEST_FEED_URL = 'https://hermes.pyth.network/api/latest_price_feeds';
const PYTH_BTC_USD_FEED_ID = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const PYTH_PRICE_FEED_SHARD = 0;
const PYTH_UPDATE_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 100_000;
const PYTH_UPDATE_COMPUTE_UNIT_LIMIT = 400_000;
const PYTH_ENCODED_VAA_CREATE_COMPUTE_UNIT_LIMIT = 50_000;
const PYTH_PUSH_ORACLE_PROGRAM_ID = 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT';
const PYTH_RECEIVER_PROGRAM_ID = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ';
const WORMHOLE_PROGRAM_ID = 'HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ';
const PYTH_STALENESS_SECONDS = 60;

export interface DevnetMintResult {
  signature: string;
  cached?: boolean;
  nullifier_hash: Hex;
  proof: Hex;
  public_inputs: Hex;
  nullifier_pda: string;
  vault_pda: string;
  institution_pda: string;
  compliance_permit_pda: string;
  zkusd_mint: string;
  zkusd_token_account: string;
  owner: string;
  permission_profile: InstitutionPermissionProfile;
}

export interface PreparedDevnetMintResult {
  serialized_transaction?: string;
  cached?: boolean;
  nullifier_hash: Hex;
  proof: Hex;
  public_inputs: Hex;
  nullifier_pda: string;
  vault_pda: string;
  institution_pda: string;
  compliance_permit_pda: string;
  zkusd_mint: string;
  zkusd_token_account: string;
  owner: string;
  fee_payer: string;
  cluster_url: string;
  permission_profile: InstitutionPermissionProfile;
  oracle_publish_time?: number;
  oracle_refreshed_at?: number;
  oracle_expires_at?: number;
  oracle_freshness_ttl_seconds?: number;
}

export interface InstitutionAccountState {
  institution_pda: string;
  institution_id_hash: Hex;
  approved_operator: string;
  status: 'active' | 'suspended' | 'uninitialized';
  risk_tier: number;
  daily_mint_cap: number;
  lifetime_mint_cap: number;
  minted_total: number;
  current_period_start: number;
  current_period_minted: number;
  kyb_ref_hash: Hex;
  travel_rule_required: boolean;
  updated_at: number;
}

export interface CompliancePermitState {
  compliance_permit_pda: string;
  institution_id_hash: Hex;
  operator: string;
  nullifier_hash: Hex;
  max_amount: number;
  expires_at: number;
  kyt_score: number;
  kyb_ref_hash: Hex;
  travel_rule_ref_hash: Hex;
  issued_by: string;
  issued_at: number;
  used_at: number;
  state: 'pending' | 'used' | 'revoked';
}

export interface PermissionedStateSnapshot {
  institution: InstitutionAccountState | null;
  permit: CompliancePermitState | null;
}

interface HermesLatestPriceFeed {
  vaa?: string;
  price?: {
    publish_time?: number;
  };
}

interface InstructionWithEphemeralSigners {
  instruction: TransactionInstruction;
  signers: Keypair[];
}

interface OracleRefreshWindow {
  publishTime: number | null;
  refreshedAt: number;
  expiresAt: number | null;
}

interface PermissionedMintAccounts {
  institutionPda: PublicKey;
  compliancePermitPda: PublicKey;
}

const INSTITUTION_ACCOUNT_DISCRIMINATOR = createHash('sha256')
  .update('account:InstitutionAccount')
  .digest()
  .subarray(0, 8);
const COMPLIANCE_PERMIT_DISCRIMINATOR = createHash('sha256')
  .update('account:CompliancePermit')
  .digest()
  .subarray(0, 8);

function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function encodeU32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function encodeU64LE(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function encodeI64LE(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value), 0);
  return buffer;
}

function encodeU16LE(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function encodeBool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

function encodeInstitutionStatus(status: 'active' | 'suspended'): Buffer {
  return Buffer.from([status === 'active' ? 1 : 2]);
}

function encodeHex32(value: Hex, label: string): Buffer {
  const bytes = Buffer.from(hexToBytes(value));
  if (bytes.length !== 32) {
    throw new Error(`${label} must be 32 bytes, received ${bytes.length}`);
  }
  return bytes;
}

function encodeMintZkUsdInstruction(input: MintZkUSDInput): Buffer {
  return Buffer.concat([
    discriminator('mint_zkusd'),
    Buffer.from(hexToBytes(input.nullifier_hash)),
    encodeU64LE(input.zkusd_amount),
    encodeI64LE(input.l1_refund_timelock),
  ]);
}

function encodeUpsertInstitutionInstruction(
  profile: InstitutionPermissionProfile,
  approvedOperator: PublicKey,
  riskTier: number,
): Buffer {
  return Buffer.concat([
    discriminator('upsert_institution'),
    encodeHex32(profile.institution_id_hash, 'institution_id_hash'),
    approvedOperator.toBuffer(),
    Buffer.from([riskTier & 0xff]),
    encodeU64LE(profile.daily_mint_cap),
    encodeU64LE(profile.lifetime_mint_cap),
    encodeHex32(profile.kyb_ref_hash, 'kyb_ref_hash'),
    encodeBool(profile.travel_rule_required),
  ]);
}

function encodeIssueCompliancePermitInstruction(
  profile: InstitutionPermissionProfile,
  nullifierHash: Hex,
  maxAmount: number,
): Buffer {
  return Buffer.concat([
    discriminator('issue_compliance_permit'),
    encodeHex32(profile.institution_id_hash, 'institution_id_hash'),
    encodeHex32(nullifierHash, 'nullifier_hash'),
    encodeU64LE(maxAmount),
    encodeI64LE(profile.permit_expires_at),
    encodeU16LE(profile.kyt_score),
    encodeHex32(profile.travel_rule_ref_hash, 'travel_rule_ref_hash'),
  ]);
}

function encodeSetInstitutionStatusInstruction(
  institutionIdHash: Hex,
  status: 'active' | 'suspended',
): Buffer {
  return Buffer.concat([
    discriminator('set_institution_status'),
    encodeHex32(institutionIdHash, 'institution_id_hash'),
    encodeInstitutionStatus(status),
  ]);
}

function encodeRevokeCompliancePermitInstruction(
  institutionIdHash: Hex,
  nullifierHash: Hex,
): Buffer {
  return Buffer.concat([
    discriminator('revoke_compliance_permit'),
    encodeHex32(institutionIdHash, 'institution_id_hash'),
    encodeHex32(nullifierHash, 'nullifier_hash'),
  ]);
}

function encodeInitializeVerificationPayloadInstruction(
  nullifierHash: Hex,
  proofLength: number,
  publicInputsLength: number,
): Buffer {
  return Buffer.concat([
    discriminator('initialize_verification_payload'),
    Buffer.from(hexToBytes(nullifierHash)),
    encodeU32LE(proofLength),
    encodeU32LE(publicInputsLength),
  ]);
}

function encodeAppendVerificationPayloadProofChunkInstruction(chunk: Buffer): Buffer {
  return Buffer.concat([
    discriminator('append_verification_payload_proof_chunk'),
    encodeU32LE(chunk.length),
    chunk,
  ]);
}

function encodeAppendVerificationPayloadPublicInputsChunkInstruction(chunk: Buffer): Buffer {
  return Buffer.concat([
    discriminator('append_verification_payload_public_inputs_chunk'),
    encodeU32LE(chunk.length),
    chunk,
  ]);
}

async function readKeypair(keypairPath: string): Promise<Keypair> {
  const secretKey = Uint8Array.from(JSON.parse(await fs.readFile(keypairPath, 'utf8')) as number[]);
  return Keypair.fromSecretKey(secretKey);
}

async function ensureMintKeypair(mintKeypairPath: string): Promise<Keypair> {
  if (existsSync(mintKeypairPath)) {
    return readKeypair(mintKeypairPath);
  }

  const keypair = Keypair.generate();
  await fs.mkdir(path.dirname(mintKeypairPath), { recursive: true });
  await fs.writeFile(mintKeypairPath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

async function ensureZkUsdMint(
  connection: Connection,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals: number,
  existingMintAddress?: string,
): Promise<PublicKey> {
  if (existingMintAddress) {
    const mint = new PublicKey(existingMintAddress);
    await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
    return mint;
  }

  const mintKeypair = await ensureMintKeypair(DEFAULT_MINT_KEYPAIR_PATH);
  const mint = mintKeypair.publicKey;
  const existing = await connection.getAccountInfo(mint);
  if (existing) {
    return mint;
  }

  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint, decimals, mintAuthority, null, TOKEN_PROGRAM_ID),
  );

  await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair], {
    commitment: 'confirmed',
  });

  return mint;
}

async function ensureAssociatedTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const existing = await connection.getAccountInfo(ata);
  if (existing) {
    return ata;
  }

  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );

  await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
  });

  return ata;
}

function assertLegacyTransactionSize(transaction: Transaction): void {
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  if (serialized.length > MAX_LEGACY_TRANSACTION_BYTES) {
    throw new Error(
      `mint_zkusd transaction too large for legacy packet: ${serialized.length} bytes (max ${MAX_LEGACY_TRANSACTION_BYTES})`,
    );
  }
}

async function uploadVerificationPayload(
  connection: Connection,
  payer: Keypair,
  programId: PublicKey,
  verificationPayloadPda: PublicKey,
  mintInput: MintZkUSDInput,
): Promise<void> {
  const existing = await connection.getAccountInfo(verificationPayloadPda);
  if (existing) {
    throw new Error(`Verification payload PDA already exists: ${verificationPayloadPda.toBase58()}`);
  }

  const proofBytes = Buffer.from(hexToBytes(mintInput.proof));
  const publicInputBytes = Buffer.from(hexToBytes(mintInput.public_inputs));

  const initTx = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: verificationPayloadPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeInitializeVerificationPayloadInstruction(
        mintInput.nullifier_hash,
        proofBytes.length,
        publicInputBytes.length,
      ),
    }),
  );
  await sendAndConfirmTransaction(connection, initTx, [payer], { commitment: 'confirmed' });

  for (let offset = 0; offset < proofBytes.length; offset += VERIFICATION_PAYLOAD_CHUNK_BYTES) {
    const chunk = proofBytes.subarray(offset, offset + VERIFICATION_PAYLOAD_CHUNK_BYTES);
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: verificationPayloadPda, isSigner: false, isWritable: true },
        ],
        data: encodeAppendVerificationPayloadProofChunkInstruction(chunk),
      }),
    );
    await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
  }

  for (let offset = 0; offset < publicInputBytes.length; offset += VERIFICATION_PAYLOAD_CHUNK_BYTES) {
    const chunk = publicInputBytes.subarray(offset, offset + VERIFICATION_PAYLOAD_CHUNK_BYTES);
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: verificationPayloadPda, isSigner: false, isWritable: true },
        ],
        data: encodeAppendVerificationPayloadPublicInputsChunkInstruction(chunk),
      }),
    );
    await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
  }
}

function getPermissionedMintAccounts(
  programId: PublicKey,
  profile: InstitutionPermissionProfile,
  mintInput: MintZkUSDInput,
): PermissionedMintAccounts {
  const [institutionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(INSTITUTION_ACCOUNT_SEED, 'utf8'), encodeHex32(profile.institution_id_hash, 'institution_id_hash')],
    programId,
  );
  const [compliancePermitPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(COMPLIANCE_PERMIT_SEED, 'utf8'),
      encodeHex32(profile.institution_id_hash, 'institution_id_hash'),
      Buffer.from(hexToBytes(mintInput.nullifier_hash)),
    ],
    programId,
  );
  return { institutionPda, compliancePermitPda };
}

function readPubkey(data: Buffer, offset: number): { value: PublicKey; nextOffset: number } {
  return {
    value: new PublicKey(data.subarray(offset, offset + 32)),
    nextOffset: offset + 32,
  };
}

function readFixedHex32(data: Buffer, offset: number): { value: Hex; nextOffset: number } {
  return {
    value: `0x${Buffer.from(data.subarray(offset, offset + 32)).toString('hex')}` as Hex,
    nextOffset: offset + 32,
  };
}

function readU64(data: Buffer, offset: number): { value: number; nextOffset: number } {
  return {
    value: Number(data.readBigUInt64LE(offset)),
    nextOffset: offset + 8,
  };
}

function readI64(data: Buffer, offset: number): { value: number; nextOffset: number } {
  return {
    value: Number(data.readBigInt64LE(offset)),
    nextOffset: offset + 8,
  };
}

function readBool(data: Buffer, offset: number): { value: boolean; nextOffset: number } {
  return {
    value: data.readUInt8(offset) === 1,
    nextOffset: offset + 1,
  };
}

function readU8(data: Buffer, offset: number): { value: number; nextOffset: number } {
  return {
    value: data.readUInt8(offset),
    nextOffset: offset + 1,
  };
}

function readU16(data: Buffer, offset: number): { value: number; nextOffset: number } {
  return {
    value: data.readUInt16LE(offset),
    nextOffset: offset + 2,
  };
}

function decodeInstitutionStatus(value: number): 'active' | 'suspended' | 'uninitialized' {
  if (value === 1) {
    return 'active';
  }
  if (value === 2) {
    return 'suspended';
  }
  return 'uninitialized';
}

function decodeInstitutionAccount(
  institutionPda: PublicKey,
  data: Buffer,
): InstitutionAccountState {
  if (!data.subarray(0, 8).equals(INSTITUTION_ACCOUNT_DISCRIMINATOR)) {
    throw new Error(`Invalid InstitutionAccount discriminator for ${institutionPda.toBase58()}`);
  }

  let offset = 8;
  const institutionId = readFixedHex32(data, offset);
  offset = institutionId.nextOffset;
  const operator = readPubkey(data, offset);
  offset = operator.nextOffset;
  const status = readU8(data, offset);
  offset = status.nextOffset;
  const riskTier = readU8(data, offset);
  offset = riskTier.nextOffset;
  const dailyMintCap = readU64(data, offset);
  offset = dailyMintCap.nextOffset;
  const lifetimeMintCap = readU64(data, offset);
  offset = lifetimeMintCap.nextOffset;
  const mintedTotal = readU64(data, offset);
  offset = mintedTotal.nextOffset;
  const currentPeriodStart = readI64(data, offset);
  offset = currentPeriodStart.nextOffset;
  const currentPeriodMinted = readU64(data, offset);
  offset = currentPeriodMinted.nextOffset;
  const kybRef = readFixedHex32(data, offset);
  offset = kybRef.nextOffset;
  const travelRuleRequired = readBool(data, offset);
  offset = travelRuleRequired.nextOffset;
  const updatedAt = readI64(data, offset);

  return {
    institution_pda: institutionPda.toBase58(),
    institution_id_hash: institutionId.value,
    approved_operator: operator.value.toBase58(),
    status: decodeInstitutionStatus(status.value),
    risk_tier: riskTier.value,
    daily_mint_cap: dailyMintCap.value,
    lifetime_mint_cap: lifetimeMintCap.value,
    minted_total: mintedTotal.value,
    current_period_start: currentPeriodStart.value,
    current_period_minted: currentPeriodMinted.value,
    kyb_ref_hash: kybRef.value,
    travel_rule_required: travelRuleRequired.value,
    updated_at: updatedAt.value,
  };
}

function decodeCompliancePermit(
  compliancePermitPda: PublicKey,
  data: Buffer,
): CompliancePermitState {
  if (!data.subarray(0, 8).equals(COMPLIANCE_PERMIT_DISCRIMINATOR)) {
    throw new Error(`Invalid CompliancePermit discriminator for ${compliancePermitPda.toBase58()}`);
  }

  let offset = 8;
  const institutionId = readFixedHex32(data, offset);
  offset = institutionId.nextOffset;
  const operator = readPubkey(data, offset);
  offset = operator.nextOffset;
  const nullifierHash = readFixedHex32(data, offset);
  offset = nullifierHash.nextOffset;
  const maxAmount = readU64(data, offset);
  offset = maxAmount.nextOffset;
  const expiresAt = readI64(data, offset);
  offset = expiresAt.nextOffset;
  const kytScore = readU16(data, offset);
  offset = kytScore.nextOffset;
  const kybRef = readFixedHex32(data, offset);
  offset = kybRef.nextOffset;
  const travelRuleRef = readFixedHex32(data, offset);
  offset = travelRuleRef.nextOffset;
  const issuedBy = readPubkey(data, offset);
  offset = issuedBy.nextOffset;
  const issuedAt = readI64(data, offset);
  offset = issuedAt.nextOffset;
  const usedAt = readI64(data, offset);

  return {
    compliance_permit_pda: compliancePermitPda.toBase58(),
    institution_id_hash: institutionId.value,
    operator: operator.value.toBase58(),
    nullifier_hash: nullifierHash.value,
    max_amount: maxAmount.value,
    expires_at: expiresAt.value,
    kyt_score: kytScore.value,
    kyb_ref_hash: kybRef.value,
    travel_rule_ref_hash: travelRuleRef.value,
    issued_by: issuedBy.value.toBase58(),
    issued_at: issuedAt.value,
    used_at: usedAt.value,
    state: usedAt.value < 0 ? 'revoked' : usedAt.value > 0 ? 'used' : 'pending',
  };
}

async function ensurePermissionedMintAccounts(
  connection: Connection,
  payer: Keypair,
  programId: PublicKey,
  protocolConfigPda: PublicKey,
  owner: PublicKey,
  mintInput: MintZkUSDInput,
  profile: InstitutionPermissionProfile,
): Promise<PermissionedMintAccounts> {
  const accounts = getPermissionedMintAccounts(programId, profile, mintInput);

  const upsertInstitutionTx = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
        { pubkey: accounts.institutionPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeUpsertInstitutionInstruction(profile, owner, 1),
    }),
  );
  await sendAndConfirmTransaction(connection, upsertInstitutionTx, [payer], { commitment: 'confirmed' });

  const existingPermit = await connection.getAccountInfo(accounts.compliancePermitPda);
  if (!existingPermit) {
    const issuePermitTx = new Transaction().add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
          { pubkey: accounts.institutionPda, isSigner: false, isWritable: false },
          { pubkey: accounts.compliancePermitPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeIssueCompliancePermitInstruction(profile, mintInput.nullifier_hash, mintInput.zkusd_amount),
      }),
    );
    await sendAndConfirmTransaction(connection, issuePermitTx, [payer], { commitment: 'confirmed' });
  }

  return accounts;
}

function buildAnchorWallet(payer: Keypair): {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
} {
  return {
    publicKey: payer.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof Transaction) {
        tx.partialSign(payer);
      } else {
        tx.sign([payer]);
      }
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      return Promise.all(txs.map((tx) => this.signTransaction(tx)));
    },
  };
}

async function fetchLatestHermesPriceFeed(feedId: string): Promise<HermesLatestPriceFeed> {
  const url = new URL(PYTH_HERMES_LATEST_FEED_URL);
  url.searchParams.set('binary', 'true');
  url.searchParams.append('ids[]', feedId);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Hermes price update: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as HermesLatestPriceFeed[];
  const latestFeed = payload[0];
  if (!latestFeed?.vaa) {
    throw new Error(`Hermes response missing VAA for feed ${feedId}`);
  }

  return latestFeed;
}

function getTreasuryPda(treasuryId: number, receiverProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), Buffer.from([treasuryId])],
    receiverProgramId,
  )[0];
}

function getConfigPda(receiverProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], receiverProgramId)[0];
}

function getPriceFeedAccountAddress(
  shardId: number,
  priceFeedId: Buffer,
  pushOracleProgramId: PublicKey,
): PublicKey {
  const shardBuffer = Buffer.alloc(2);
  shardBuffer.writeUint16LE(shardId, 0);
  return PublicKey.findProgramAddressSync([shardBuffer, priceFeedId], pushOracleProgramId)[0];
}

async function sendSingleInstructionTransaction(
  connection: Connection,
  payer: Keypair,
  instructionWithSigners: InstructionWithEphemeralSigners,
  computeUnitLimit: number,
): Promise<string> {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: PYTH_UPDATE_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnitLimit,
    }),
    instructionWithSigners.instruction,
  );

  return sendAndConfirmTransaction(connection, tx, [payer, ...instructionWithSigners.signers], {
    commitment: 'confirmed',
  });
}

async function postFreshOraclePriceUpdate(
  connection: Connection,
  payer: Keypair,
): Promise<OracleRefreshWindow> {
  const latestFeed = await fetchLatestHermesPriceFeed(PYTH_BTC_USD_FEED_ID);
  const latestVaa = latestFeed.vaa;
  if (!latestVaa) {
    throw new Error(`Hermes response missing VAA for feed ${PYTH_BTC_USD_FEED_ID}`);
  }
  const refreshedAt = Math.floor(Date.now() / 1000);
  const publishTime = latestFeed.price?.publish_time ?? null;
  const anchor = require('@coral-xyz/anchor') as typeof import('@coral-xyz/anchor');
  const { parseAccumulatorUpdateData, parsePriceFeedMessage } = require('@pythnetwork/price-service-sdk') as typeof import('@pythnetwork/price-service-sdk');
  const { IDL: receiverIdl } = require('@pythnetwork/pyth-solana-receiver/lib/idl/pyth_solana_receiver.js') as {
    IDL: import('@coral-xyz/anchor').Idl;
  };
  const { IDL: wormholeIdl } = require('@pythnetwork/pyth-solana-receiver/lib/idl/wormhole_core_bridge_solana.js') as {
    IDL: import('@coral-xyz/anchor').Idl;
  };
  const { IDL: pushOracleIdl } = require('@pythnetwork/pyth-solana-receiver/lib/idl/pyth_push_oracle.js') as {
    IDL: import('@coral-xyz/anchor').Idl;
  };
  const {
    buildPostEncodedVaaInstructions,
  } = require('@pythnetwork/pyth-solana-receiver/lib/vaa.js') as {
    buildPostEncodedVaaInstructions: (
      wormhole: import('@coral-xyz/anchor').Program,
      vaa: Buffer,
    ) => Promise<{
      encodedVaaAddress: PublicKey;
      postInstructions: InstructionWithEphemeralSigners[];
      closeInstructions: InstructionWithEphemeralSigners[];
    }>;
  };

  const receiverProgramId = new PublicKey(PYTH_RECEIVER_PROGRAM_ID);
  const pushOracleProgramId = new PublicKey(PYTH_PUSH_ORACLE_PROGRAM_ID);
  const wormholeProgramId = new PublicKey(WORMHOLE_PROGRAM_ID);
  const treasuryId = 0;
  const wallet = buildAnchorWallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: connection.commitment ?? 'confirmed',
  });
  const receiver = new anchor.Program(receiverIdl, receiverProgramId, provider);
  const wormhole = new anchor.Program(wormholeIdl, wormholeProgramId, provider);
  const pushOracle = new anchor.Program(pushOracleIdl, pushOracleProgramId, provider);
  const accumulatorUpdateData = parseAccumulatorUpdateData(Buffer.from(latestVaa, 'base64'));
  const { encodedVaaAddress, postInstructions, closeInstructions } = await buildPostEncodedVaaInstructions(
    wormhole,
    accumulatorUpdateData.vaa,
  );

  for (const instructionWithSigners of postInstructions) {
    const isCreateInstruction = instructionWithSigners.signers.length > 0;
    await sendSingleInstructionTransaction(
      connection,
      payer,
      instructionWithSigners,
      isCreateInstruction ? PYTH_ENCODED_VAA_CREATE_COMPUTE_UNIT_LIMIT : PYTH_UPDATE_COMPUTE_UNIT_LIMIT,
    );
  }

  for (const update of accumulatorUpdateData.updates) {
    const feedId = parsePriceFeedMessage(update.message).feedId as Buffer;
    const updateInstruction = await pushOracle.methods
      .updatePriceFeed(
        {
          merklePriceUpdate: update,
          treasuryId,
        },
        PYTH_PRICE_FEED_SHARD,
        Array.from(feedId),
      )
      .accounts({
        payer: payer.publicKey,
        pythSolanaReceiver: receiver.programId,
        encodedVaa: encodedVaaAddress,
        priceFeedAccount: getPriceFeedAccountAddress(PYTH_PRICE_FEED_SHARD, feedId, pushOracleProgramId),
        treasury: getTreasuryPda(treasuryId, receiverProgramId),
        config: getConfigPda(receiverProgramId),
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    await sendSingleInstructionTransaction(
      connection,
      payer,
      { instruction: updateInstruction, signers: [] },
      PYTH_UPDATE_COMPUTE_UNIT_LIMIT,
    );
  }
  for (const instructionWithSigners of closeInstructions) {
    await sendSingleInstructionTransaction(
      connection,
      payer,
      instructionWithSigners,
      PYTH_UPDATE_COMPUTE_UNIT_LIMIT,
    );
  }

  return {
    publishTime,
    refreshedAt,
    expiresAt: publishTime === null ? null : publishTime + PYTH_STALENESS_SECONDS,
  };
}

async function buildMintTransaction(
  config: SolvusConfig,
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mintInput: MintZkUSDInput,
  permissionProfile: InstitutionPermissionProfile,
  refreshOraclePriceFeed = false,
): Promise<{
  transaction: Transaction;
  nullifierPda: PublicKey;
  vaultPda: PublicKey;
  institutionPda: PublicKey;
  compliancePermitPda: PublicKey;
  mint: PublicKey;
  tokenAccount: PublicKey;
  verificationPayloadPda: PublicKey;
  cached: boolean;
  oracleRefreshWindow: OracleRefreshWindow | null;
  permissionProfile: InstitutionPermissionProfile;
}> {
  const programId = new PublicKey(config.solvusProgramId!);
  const verifierProgramId = new PublicKey(config.groth16VerifierProgramId!);
  const oraclePriceFeedId = new PublicKey(config.oraclePriceFeedId!);

  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_CONFIG_SEED, 'utf8')],
    programId,
  );
  const { institutionPda, compliancePermitPda } = getPermissionedMintAccounts(
    programId,
    permissionProfile,
    mintInput,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault', 'utf8'), owner.toBuffer()],
    programId,
  );
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_NULLIFIER_SEED, 'utf8'), Buffer.from(hexToBytes(mintInput.nullifier_hash))],
    programId,
  );
  const [verificationPayloadPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(VERIFICATION_PAYLOAD_SEED, 'utf8'), Buffer.from(hexToBytes(mintInput.nullifier_hash))],
    programId,
  );
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(ZKUSD_MINT_AUTHORITY_SEED, 'utf8')],
    programId,
  );

  const mint = await ensureZkUsdMint(
    connection,
    payer,
    mintAuthorityPda,
    config.zkusdMintDecimals,
    config.zkusdMintAddress,
  );
  const tokenAccount = await ensureAssociatedTokenAccount(connection, payer, mint, owner);
  const existingNullifier = await connection.getAccountInfo(nullifierPda);
  if (existingNullifier) {
    return {
      transaction: new Transaction(),
      nullifierPda,
      vaultPda,
      institutionPda,
      compliancePermitPda,
      mint,
      tokenAccount,
      verificationPayloadPda,
      cached: true,
      oracleRefreshWindow: null,
      permissionProfile,
    };
  }

  await ensurePermissionedMintAccounts(
    connection,
    payer,
    programId,
    protocolConfigPda,
    owner,
    mintInput,
    permissionProfile,
  );
  await uploadVerificationPayload(connection, payer, programId, verificationPayloadPda, mintInput);
  let oracleRefreshWindow: OracleRefreshWindow | null = null;
  if (refreshOraclePriceFeed) {
    oracleRefreshWindow = await postFreshOraclePriceUpdate(connection, payer);
  }

  const instructionData = encodeMintZkUsdInstruction(mintInput);
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
      { pubkey: institutionPda, isSigner: false, isWritable: true },
      { pubkey: compliancePermitPda, isSigner: false, isWritable: true },
      { pubkey: oraclePriceFeedId, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: nullifierPda, isSigner: false, isWritable: true },
      { pubkey: verificationPayloadPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: verifierProgramId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SPL_TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: MINT_ZKUSD_COMPUTE_UNIT_LIMIT,
    }),
    instruction,
  );
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = blockhash;

  return {
    transaction,
    nullifierPda,
    vaultPda,
    institutionPda,
    compliancePermitPda,
    mint,
    tokenAccount,
    verificationPayloadPda,
    cached: false,
    oracleRefreshWindow,
    permissionProfile,
  };
}

export function getDevnetMintContext(config: SolvusConfig): {
  clusterUrl: string;
  walletPath: string;
  solvusProgramId?: string;
  groth16VerifierProgramId?: string;
  zkusdMintAddress?: string;
  zkusdMintDecimals: number;
} {
  return {
    clusterUrl: config.solanaClusterUrl,
    walletPath: config.solanaWalletPath,
    solvusProgramId: config.solvusProgramId,
    groth16VerifierProgramId: config.groth16VerifierProgramId,
    zkusdMintAddress: config.zkusdMintAddress,
    zkusdMintDecimals: config.zkusdMintDecimals,
  };
}

export async function mintOnDevnet(
  config: SolvusConfig,
  mintInput: MintZkUSDInput,
  permissionProfile: InstitutionPermissionProfile,
): Promise<DevnetMintResult> {
  if (!config.solvusProgramId) {
    throw new Error('Missing SOLVUS_PROGRAM_ID');
  }
  if (!config.groth16VerifierProgramId) {
    throw new Error('Missing GROTH16_VERIFIER_PROGRAM_ID');
  }
  if (!config.oraclePriceFeedId) {
    throw new Error('Missing ORACLE_PRICE_FEED_ID');
  }
  if (!config.solanaWalletPath || !existsSync(config.solanaWalletPath)) {
    throw new Error(`Missing Solana wallet at ${config.solanaWalletPath}`);
  }
  if (config.zkusdMintDecimals < 0 || config.zkusdMintDecimals > 9) {
    throw new Error(`Invalid ZKUSD_MINT_DECIMALS: ${config.zkusdMintDecimals}`);
  }

  const connection = new Connection(config.solanaClusterUrl, 'confirmed');
  const payer = await readKeypair(config.solanaWalletPath);
  const {
    transaction,
    nullifierPda,
    vaultPda,
    institutionPda,
    compliancePermitPda,
    mint,
    tokenAccount,
    cached,
  } = await buildMintTransaction(
    config,
    connection,
    payer,
    payer.publicKey,
    mintInput,
    permissionProfile,
    true,
  );
  if (cached) {
    return {
      signature: 'already-minted',
      cached: true,
      nullifier_hash: mintInput.nullifier_hash,
      proof: mintInput.proof,
      public_inputs: mintInput.public_inputs,
      nullifier_pda: nullifierPda.toBase58(),
      vault_pda: vaultPda.toBase58(),
      institution_pda: institutionPda.toBase58(),
      compliance_permit_pda: compliancePermitPda.toBase58(),
      zkusd_mint: mint.toBase58(),
      zkusd_token_account: tokenAccount.toBase58(),
      owner: payer.publicKey.toBase58(),
      permission_profile: permissionProfile,
    };
  }

  assertLegacyTransactionSize(transaction);

  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
  });

  return {
    signature,
    nullifier_hash: mintInput.nullifier_hash,
    proof: mintInput.proof,
    public_inputs: mintInput.public_inputs,
    nullifier_pda: nullifierPda.toBase58(),
    vault_pda: vaultPda.toBase58(),
    institution_pda: institutionPda.toBase58(),
    compliance_permit_pda: compliancePermitPda.toBase58(),
    zkusd_mint: mint.toBase58(),
    zkusd_token_account: tokenAccount.toBase58(),
    owner: payer.publicKey.toBase58(),
    permission_profile: permissionProfile,
  };
}

export async function prepareMintOnDevnet(
  config: SolvusConfig,
  ownerAddress: string,
  mintInput: MintZkUSDInput,
  permissionProfile: InstitutionPermissionProfile,
): Promise<PreparedDevnetMintResult> {
  if (!config.solvusProgramId) {
    throw new Error('Missing SOLVUS_PROGRAM_ID');
  }
  if (!config.groth16VerifierProgramId) {
    throw new Error('Missing GROTH16_VERIFIER_PROGRAM_ID');
  }
  if (!config.oraclePriceFeedId) {
    throw new Error('Missing ORACLE_PRICE_FEED_ID');
  }
  if (!config.solanaWalletPath || !existsSync(config.solanaWalletPath)) {
    throw new Error(`Missing Solana wallet at ${config.solanaWalletPath}`);
  }
  if (config.zkusdMintDecimals < 0 || config.zkusdMintDecimals > 9) {
    throw new Error(`Invalid ZKUSD_MINT_DECIMALS: ${config.zkusdMintDecimals}`);
  }

  const connection = new Connection(config.solanaClusterUrl, 'confirmed');
  const payer = await readKeypair(config.solanaWalletPath);
  const owner = new PublicKey(ownerAddress);
  const {
    transaction,
    nullifierPda,
    vaultPda,
    institutionPda,
    compliancePermitPda,
    mint,
    tokenAccount,
    cached,
    oracleRefreshWindow,
  } = await buildMintTransaction(
    config,
    connection,
    payer,
    owner,
    mintInput,
    permissionProfile,
    true,
  );

  if (cached) {
    return {
      cached: true,
      nullifier_hash: mintInput.nullifier_hash,
      proof: mintInput.proof,
      public_inputs: mintInput.public_inputs,
      nullifier_pda: nullifierPda.toBase58(),
      vault_pda: vaultPda.toBase58(),
      institution_pda: institutionPda.toBase58(),
      compliance_permit_pda: compliancePermitPda.toBase58(),
      zkusd_mint: mint.toBase58(),
      zkusd_token_account: tokenAccount.toBase58(),
      owner: owner.toBase58(),
      fee_payer: payer.publicKey.toBase58(),
      cluster_url: config.solanaClusterUrl,
      permission_profile: permissionProfile,
    };
  }

  transaction.partialSign(payer);
  assertLegacyTransactionSize(transaction);

  return {
    serialized_transaction: transaction
      .serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
      .toString('base64'),
    nullifier_hash: mintInput.nullifier_hash,
    proof: mintInput.proof,
    public_inputs: mintInput.public_inputs,
    nullifier_pda: nullifierPda.toBase58(),
    vault_pda: vaultPda.toBase58(),
    institution_pda: institutionPda.toBase58(),
    compliance_permit_pda: compliancePermitPda.toBase58(),
    zkusd_mint: mint.toBase58(),
    zkusd_token_account: tokenAccount.toBase58(),
    owner: owner.toBase58(),
    fee_payer: payer.publicKey.toBase58(),
    cluster_url: config.solanaClusterUrl,
    permission_profile: permissionProfile,
    oracle_publish_time: oracleRefreshWindow?.publishTime ?? undefined,
    oracle_refreshed_at: oracleRefreshWindow?.refreshedAt ?? undefined,
    oracle_expires_at: oracleRefreshWindow?.expiresAt ?? undefined,
    oracle_freshness_ttl_seconds: oracleRefreshWindow ? PYTH_STALENESS_SECONDS : undefined,
  };
}

export async function fetchPermissionedState(
  config: SolvusConfig,
  institutionIdHash: Hex,
  nullifierHash: Hex,
): Promise<PermissionedStateSnapshot> {
  if (!config.solvusProgramId) {
    throw new Error('Missing SOLVUS_PROGRAM_ID');
  }

  const connection = new Connection(config.solanaClusterUrl, 'confirmed');
  const programId = new PublicKey(config.solvusProgramId);
  const accounts = getPermissionedMintAccounts(
    programId,
    {
      institution_id_hash: institutionIdHash,
      institution_label: '',
      kyb_ref_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      travel_rule_ref_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      permit_expires_at: 0,
      kyt_score: 0,
      daily_mint_cap: 0,
      lifetime_mint_cap: 0,
      travel_rule_required: true,
    },
    {
      nullifier_hash: nullifierHash,
      zkusd_amount: 0,
      proof: '0x' as Hex,
      public_inputs: '0x' as Hex,
      l1_refund_timelock: 0,
    },
  );
  const [institutionInfo, permitInfo] = await Promise.all([
    connection.getAccountInfo(accounts.institutionPda),
    connection.getAccountInfo(accounts.compliancePermitPda),
  ]);

  return {
    institution: institutionInfo ? decodeInstitutionAccount(accounts.institutionPda, institutionInfo.data) : null,
    permit: permitInfo ? decodeCompliancePermit(accounts.compliancePermitPda, permitInfo.data) : null,
  };
}

async function sendAdminInstruction(
  config: SolvusConfig,
  buildInstruction: (programId: PublicKey, protocolConfigPda: PublicKey, payer: Keypair) => TransactionInstruction,
): Promise<string> {
  if (!config.solvusProgramId) {
    throw new Error('Missing SOLVUS_PROGRAM_ID');
  }
  if (!config.solanaWalletPath || !existsSync(config.solanaWalletPath)) {
    throw new Error(`Missing Solana wallet at ${config.solanaWalletPath}`);
  }

  const connection = new Connection(config.solanaClusterUrl, 'confirmed');
  const payer = await readKeypair(config.solanaWalletPath);
  const programId = new PublicKey(config.solvusProgramId);
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_CONFIG_SEED, 'utf8')],
    programId,
  );

  const transaction = new Transaction().add(buildInstruction(programId, protocolConfigPda, payer));
  return sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
  });
}

export async function setInstitutionStatusOnDevnet(
  config: SolvusConfig,
  institutionIdHash: Hex,
  status: 'active' | 'suspended',
): Promise<string> {
  return sendAdminInstruction(config, (programId, protocolConfigPda, payer) => {
    const [institutionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(INSTITUTION_ACCOUNT_SEED, 'utf8'), encodeHex32(institutionIdHash, 'institution_id_hash')],
      programId,
    );
    return new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
        { pubkey: institutionPda, isSigner: false, isWritable: true },
      ],
      data: encodeSetInstitutionStatusInstruction(institutionIdHash, status),
    });
  });
}

export async function revokeCompliancePermitOnDevnet(
  config: SolvusConfig,
  institutionIdHash: Hex,
  nullifierHash: Hex,
): Promise<string> {
  return sendAdminInstruction(config, (programId, protocolConfigPda, payer) => {
    const accounts = getPermissionedMintAccounts(
      programId,
      {
        institution_id_hash: institutionIdHash,
        institution_label: '',
        kyb_ref_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        travel_rule_ref_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        permit_expires_at: 0,
        kyt_score: 0,
        daily_mint_cap: 0,
        lifetime_mint_cap: 0,
        travel_rule_required: true,
      },
      {
        nullifier_hash: nullifierHash,
        zkusd_amount: 0,
        proof: '0x' as Hex,
        public_inputs: '0x' as Hex,
        l1_refund_timelock: 0,
      },
    );
    return new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
        { pubkey: accounts.institutionPda, isSigner: false, isWritable: false },
        { pubkey: accounts.compliancePermitPda, isSigner: false, isWritable: true },
      ],
      data: encodeRevokeCompliancePermitInstruction(institutionIdHash, nullifierHash),
    });
  });
}
