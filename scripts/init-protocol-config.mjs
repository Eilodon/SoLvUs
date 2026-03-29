#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import dotenv from "dotenv";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";

const rootDir = resolve(new URL(".", import.meta.url).pathname, "..");
dotenv.config({ path: resolve(rootDir, "config/devnet.env") });

const dryRun = process.argv.includes("--dry-run");
const CURRENT_PROTOCOL_CONFIG_DATA_LEN = 257;

const walletPath = process.env.SOLANA_WALLET || resolve(process.env.HOME, ".config/solana/id.json");
const connectionUrl = process.env.SOLANA_CLUSTER_URL || "https://api.devnet.solana.com";
const solvusProgramId = new PublicKey(
  process.env.SOLVUS_PROGRAM_ID || "Cik3PiifeUrKrWcAFsHM5R7ckQVkWAc9M9THrXVfanVR",
);
const verifierProgramId = new PublicKey(
  process.env.GROTH16_VERIFIER_PROGRAM_ID || "EVA4sSUJ2V3cXkT9fHpSHWbVnxBfPuUQUtRChxwg36Cn",
);
const oraclePriceFeedId = new PublicKey(
  process.env.ORACLE_PRICE_FEED_ID || "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
);
const liquidationProgramId = new PublicKey(
  process.env.LIQUIDATION_PROGRAM_ID || "FuNY9NZLWdegyDQHJiGjzsWcSeYG8s7nsAvaqUrk8HZt",
);
const collateralRatioBps = BigInt(process.env.COLLATERAL_RATIO_BPS || "15000");
const oracleMaxStalenessSeconds = BigInt(process.env.ORACLE_MAX_STALENESS_SECONDS || "60");

const defaultRelayerPrivateKey = process.env.RELAYER_SECP256K1_PRIVATE_KEY || `0x${"22".repeat(32)}`;
const defaultRelayerPublicKey = secp256k1.getPublicKey(
  Buffer.from(defaultRelayerPrivateKey.replace(/^0x/, ""), "hex"),
  false,
);
const defaultRelayerPubkeyX = Buffer.from(defaultRelayerPublicKey.slice(1, 33));
const defaultRelayerPubkeyY = Buffer.from(defaultRelayerPublicKey.slice(33, 65));

const relayerPubkeyX = Buffer.from(
  (
    process.env.RELAYER_SECP256K1_PUBLIC_KEY_X ||
    `0x${defaultRelayerPubkeyX.toString("hex")}`
  ).replace(/^0x/, ""),
  "hex"
);
const relayerPubkeyY = Buffer.from(
  (
    process.env.RELAYER_SECP256K1_PUBLIC_KEY_Y ||
    `0x${defaultRelayerPubkeyY.toString("hex")}`
  ).replace(/^0x/, ""),
  "hex"
);

if (!existsSync(walletPath)) {
  throw new Error(`missing wallet keypair: ${walletPath}`);
}

const walletBytes = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")));
const payer = Keypair.fromSecretKey(walletBytes);
const complianceAdmin = new PublicKey(process.env.COMPLIANCE_ADMIN_PUBKEY || payer.publicKey.toBase58());
const [protocolConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("protocol_config", "utf8")],
  solvusProgramId,
);

function discriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodePubkeys(...pubkeys) {
  return Buffer.concat(pubkeys.map((pubkey) => pubkey.toBuffer()));
}

function encodeU64LE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

async function main() {
  const connection = new Connection(connectionUrl, "confirmed");
  const accountInfo = await connection.getAccountInfo(protocolConfigPda);
  const instructionName = !accountInfo
    ? "initialize_protocol_config"
    : accountInfo.data.length === CURRENT_PROTOCOL_CONFIG_DATA_LEN
      ? "update_protocol_config"
      : "migrate_protocol_config";
  const nextProtocolAdmin = new PublicKey(process.env.NEXT_PROTOCOL_ADMIN_PUBKEY || payer.publicKey.toBase58());
  const keys = accountInfo
    ? [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfigPda, isSigner: false, isWritable: true },
      ]
    : [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: protocolConfigPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];

  const data = accountInfo
    ? Buffer.concat([
        discriminator(instructionName),
        encodePubkeys(
          nextProtocolAdmin,
          complianceAdmin,
          verifierProgramId,
          oraclePriceFeedId,
          liquidationProgramId,
        ),
        relayerPubkeyX,
        relayerPubkeyY,
        encodeU64LE(collateralRatioBps),
        encodeU64LE(oracleMaxStalenessSeconds),
      ])
    : Buffer.concat([
        discriminator(instructionName),
        encodePubkeys(complianceAdmin, verifierProgramId, oraclePriceFeedId, liquidationProgramId),
        relayerPubkeyX,
        relayerPubkeyY,
        encodeU64LE(collateralRatioBps),
        encodeU64LE(oracleMaxStalenessSeconds),
      ]);

  const instruction = new TransactionInstruction({
    programId: solvusProgramId,
    keys,
    data,
  });

  console.log(`cluster: ${connectionUrl}`);
  console.log(`wallet: ${payer.publicKey.toBase58()}`);
  console.log(`next protocol admin: ${nextProtocolAdmin.toBase58()}`);
  console.log(`compliance admin: ${complianceAdmin.toBase58()}`);
  console.log(`solvus program: ${solvusProgramId.toBase58()}`);
  console.log(`protocol_config pda: ${protocolConfigPda.toBase58()}`);
  console.log(`verifier program: ${verifierProgramId.toBase58()}`);
  console.log(`oracle price feed: ${oraclePriceFeedId.toBase58()}`);
  console.log(`liquidation program: ${liquidationProgramId.toBase58()}`);
  console.log(`collateral ratio bps: ${collateralRatioBps.toString()}`);
  console.log(`oracle max staleness seconds: ${oracleMaxStalenessSeconds.toString()}`);
  console.log(`relayer pubkey x: 0x${relayerPubkeyX.toString("hex")}`);
  console.log(`relayer pubkey y: 0x${relayerPubkeyY.toString("hex")}`);
  console.log(`instruction: ${instructionName}`);

  if (dryRun) {
    console.log("dry-run: skipping transaction send");
    return;
  }

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
    { commitment: "confirmed" },
  );

  console.log(`signature: ${signature}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
