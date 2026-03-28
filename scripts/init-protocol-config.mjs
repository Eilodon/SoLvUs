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

const rootDir = resolve(new URL(".", import.meta.url).pathname, "..");
dotenv.config({ path: resolve(rootDir, "config/devnet.env") });

const dryRun = process.argv.includes("--dry-run");

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

const relayerPubkeyX = Buffer.from(
  (process.env.RELAYER_SECP256K1_PUBLIC_KEY_X || "00".repeat(32)).replace(/^0x/, ""),
  "hex"
);
const relayerPubkeyY = Buffer.from(
  (process.env.RELAYER_SECP256K1_PUBLIC_KEY_Y || "00".repeat(32)).replace(/^0x/, ""),
  "hex"
);

if (!existsSync(walletPath)) {
  throw new Error(`missing wallet keypair: ${walletPath}`);
}

const walletBytes = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")));
const payer = Keypair.fromSecretKey(walletBytes);
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

async function main() {
  const connection = new Connection(connectionUrl, "confirmed");
  const accountInfo = await connection.getAccountInfo(protocolConfigPda);
  const instructionName = accountInfo ? "update_protocol_config" : "initialize_protocol_config";
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

  const data = Buffer.concat([
    discriminator(instructionName),
    encodePubkeys(verifierProgramId, oraclePriceFeedId),
    relayerPubkeyX,
    relayerPubkeyY,
  ]);

  const instruction = new TransactionInstruction({
    programId: solvusProgramId,
    keys,
    data,
  });

  console.log(`cluster: ${connectionUrl}`);
  console.log(`wallet: ${payer.publicKey.toBase58()}`);
  console.log(`solvus program: ${solvusProgramId.toBase58()}`);
  console.log(`protocol_config pda: ${protocolConfigPda.toBase58()}`);
  console.log(`verifier program: ${verifierProgramId.toBase58()}`);
  console.log(`oracle price feed: ${oraclePriceFeedId.toBase58()}`);
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
