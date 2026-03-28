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
  Hex,
  MintZkUSDInput,
  PDA_NULLIFIER_SEED,
  PROTOCOL_CONFIG_SEED,
  serializePublicInputs,
  SolvusConfig,
  SPL_TOKEN_PROGRAM_ID,
  ZKUSD_MINT_AUTHORITY_SEED,
  bytesToHex,
  hexToBytes,
} from '../core';

const WORKSPACE_ROOT = path.join(__dirname, '../..');
const DEFAULT_MINT_KEYPAIR_PATH = path.join(WORKSPACE_ROOT, 'config/devnet-zkusd-mint-keypair.json');
const MAX_LEGACY_TRANSACTION_BYTES = 1232;
const MINT_ZKUSD_COMPUTE_UNIT_LIMIT = 800_000;

export interface DevnetMintResult {
  signature: string;
  cached?: boolean;
  proof: Hex;
  public_inputs: Hex;
  nullifier_pda: string;
  vault_pda: string;
  zkusd_mint: string;
  zkusd_token_account: string;
  owner: string;
}

export interface PreparedDevnetMintResult {
  serialized_transaction?: string;
  cached?: boolean;
  proof: Hex;
  public_inputs: Hex;
  nullifier_pda: string;
  vault_pda: string;
  zkusd_mint: string;
  zkusd_token_account: string;
  owner: string;
  fee_payer: string;
  cluster_url: string;
}

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

function encodeMintZkUsdInstruction(input: MintZkUSDInput): Buffer {
  const proofBytes = Buffer.from(hexToBytes(input.proof));
  const publicInputBytes = Buffer.from(hexToBytes(input.public_inputs));

  return Buffer.concat([
    discriminator('mint_zkusd'),
    Buffer.from(hexToBytes(input.nullifier_hash)),
    encodeU64LE(input.zkusd_amount),
    encodeU32LE(proofBytes.length),
    proofBytes,
    encodeU32LE(publicInputBytes.length),
    publicInputBytes,
    encodeI64LE(input.l1_refund_timelock),
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

async function buildMintTransaction(
  config: SolvusConfig,
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mintInput: MintZkUSDInput,
): Promise<{
  transaction: Transaction;
  nullifierPda: PublicKey;
  vaultPda: PublicKey;
  mint: PublicKey;
  tokenAccount: PublicKey;
  cached: boolean;
}> {
  const programId = new PublicKey(config.solvusProgramId!);
  const verifierProgramId = new PublicKey(config.groth16VerifierProgramId!);

  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_CONFIG_SEED, 'utf8')],
    programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault', 'utf8'), owner.toBuffer()],
    programId,
  );
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_NULLIFIER_SEED, 'utf8'), Buffer.from(hexToBytes(mintInput.nullifier_hash))],
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
      mint,
      tokenAccount,
      cached: true,
    };
  }

  const instructionData = encodeMintZkUsdInstruction(mintInput);
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: nullifierPda, isSigner: false, isWritable: true },
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
    mint,
    tokenAccount,
    cached: false,
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
): Promise<DevnetMintResult> {
  if (!config.solvusProgramId) {
    throw new Error('Missing SOLVUS_PROGRAM_ID');
  }
  if (!config.groth16VerifierProgramId) {
    throw new Error('Missing GROTH16_VERIFIER_PROGRAM_ID');
  }
  if (!config.solanaWalletPath || !existsSync(config.solanaWalletPath)) {
    throw new Error(`Missing Solana wallet at ${config.solanaWalletPath}`);
  }
  if (config.zkusdMintDecimals < 0 || config.zkusdMintDecimals > 9) {
    throw new Error(`Invalid ZKUSD_MINT_DECIMALS: ${config.zkusdMintDecimals}`);
  }

  const connection = new Connection(config.solanaClusterUrl, 'confirmed');
  const payer = await readKeypair(config.solanaWalletPath);
  const { transaction, nullifierPda, vaultPda, mint, tokenAccount, cached } = await buildMintTransaction(
    config,
    connection,
    payer,
    payer.publicKey,
    mintInput,
  );
  if (cached) {
    return {
      signature: 'already-minted',
      cached: true,
      proof: mintInput.proof,
      public_inputs: mintInput.public_inputs,
      nullifier_pda: nullifierPda.toBase58(),
      vault_pda: vaultPda.toBase58(),
      zkusd_mint: mint.toBase58(),
      zkusd_token_account: tokenAccount.toBase58(),
      owner: payer.publicKey.toBase58(),
    };
  }

  assertLegacyTransactionSize(transaction);

  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
  });

  return {
    signature,
    proof: mintInput.proof,
    public_inputs: mintInput.public_inputs,
    nullifier_pda: nullifierPda.toBase58(),
    vault_pda: vaultPda.toBase58(),
    zkusd_mint: mint.toBase58(),
    zkusd_token_account: tokenAccount.toBase58(),
    owner: payer.publicKey.toBase58(),
  };
}

export async function prepareMintOnDevnet(
  config: SolvusConfig,
  ownerAddress: string,
  mintInput: MintZkUSDInput,
): Promise<PreparedDevnetMintResult> {
  if (!config.solvusProgramId) {
    throw new Error('Missing SOLVUS_PROGRAM_ID');
  }
  if (!config.groth16VerifierProgramId) {
    throw new Error('Missing GROTH16_VERIFIER_PROGRAM_ID');
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
  const { transaction, nullifierPda, vaultPda, mint, tokenAccount, cached } = await buildMintTransaction(
    config,
    connection,
    payer,
    owner,
    mintInput,
  );

  if (cached) {
    return {
      cached: true,
      proof: mintInput.proof,
      public_inputs: mintInput.public_inputs,
      nullifier_pda: nullifierPda.toBase58(),
      vault_pda: vaultPda.toBase58(),
      zkusd_mint: mint.toBase58(),
      zkusd_token_account: tokenAccount.toBase58(),
      owner: owner.toBase58(),
      fee_payer: payer.publicKey.toBase58(),
      cluster_url: config.solanaClusterUrl,
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
    proof: mintInput.proof,
    public_inputs: mintInput.public_inputs,
    nullifier_pda: nullifierPda.toBase58(),
    vault_pda: vaultPda.toBase58(),
    zkusd_mint: mint.toBase58(),
    zkusd_token_account: tokenAccount.toBase58(),
    owner: owner.toBase58(),
    fee_payer: payer.publicKey.toBase58(),
    cluster_url: config.solanaClusterUrl,
  };
}
