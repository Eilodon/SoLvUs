#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import dotenv from "dotenv";
import { Connection, Keypair, Transaction } from "@solana/web3.js";

const rootDir = resolve(new URL(".", import.meta.url).pathname, "..");
dotenv.config({ path: resolve(rootDir, "config/devnet.env") });

const serverUrl = process.env.PROVER_SERVER_URL || "http://localhost:3001";
const complianceApiKey = process.env.COMPLIANCE_API_KEY || "";
const walletPath = process.env.SOLANA_WALLET || resolve(process.env.HOME || "", ".config/solana/id.json");
const smokeAmount = Number.parseInt(process.env.STABLEHACKS_SMOKE_ZKUSD_AMOUNT || "1000000", 10);
const permitTtlSeconds = Number.parseInt(process.env.STABLEHACKS_SMOKE_PERMIT_TTL || "900", 10);
const phaseArg = process.argv.find((arg) => arg.startsWith("--phase="));
const phase = phaseArg ? phaseArg.split("=")[1] : "full";

if (!existsSync(walletPath)) {
  throw new Error(`missing wallet keypair: ${walletPath}`);
}

function readKeypair(filePath) {
  const secretKey = Uint8Array.from(JSON.parse(readFileSync(filePath, "utf8")));
  return Keypair.fromSecretKey(secretKey);
}

async function getJson(path, params = {}) {
  const url = new URL(path, serverUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || body.error || `GET ${path} failed`);
  }
  return body;
}

async function postJson(path, payload) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (complianceApiKey) {
    headers["x-api-key"] = complianceApiKey;
  }
  const response = await fetch(new URL(path, serverUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || body.error || `POST ${path} failed`);
  }
  return body;
}

async function phaseOneComplianceControls() {
  const ephemeralOwner = Keypair.generate().publicKey.toBase58();
  const institutionName = `StableHacks Controls ${Date.now()}`;
  console.log("\n[phase-1] prepare compliance-controlled mint");
  const prepared = await postJson("/prepare-devnet-mint", {
    owner_pubkey: ephemeralOwner,
    zkusd_amount: smokeAmount,
    institution_name: institutionName,
    kyb_reference: `KYB:${institutionName}`,
    travel_rule_reference: `TRAVEL:${institutionName}`,
    daily_mint_cap: smokeAmount * 5,
    lifetime_mint_cap: smokeAmount * 20,
    permit_ttl_seconds: permitTtlSeconds,
    kyt_score: 18,
    travel_rule_required: true,
  });

  const institutionIdHash = prepared.permission_profile?.institution_id_hash;
  const nullifierHash = prepared.nullifier_hash;
  if (!institutionIdHash || !nullifierHash) {
    throw new Error("prepare-devnet-mint did not return compliance context");
  }

  const initialState = await getJson("/compliance/state", {
    institution_id_hash: institutionIdHash,
    nullifier_hash: nullifierHash,
  });
  console.log("[phase-1] initial state:", JSON.stringify(initialState, null, 2));

  const suspended = await postJson("/compliance/institution-status", {
    institution_id_hash: institutionIdHash,
    status: "suspended",
  });
  console.log("[phase-1] suspend signature:", suspended.signature);

  const suspendedState = await getJson("/compliance/state", {
    institution_id_hash: institutionIdHash,
    nullifier_hash: nullifierHash,
  });
  console.log("[phase-1] suspended state:", JSON.stringify(suspendedState, null, 2));

  const reactivated = await postJson("/compliance/institution-status", {
    institution_id_hash: institutionIdHash,
    status: "active",
  });
  console.log("[phase-1] reactivate signature:", reactivated.signature);

  const revoked = await postJson("/compliance/revoke-permit", {
    institution_id_hash: institutionIdHash,
    nullifier_hash: nullifierHash,
  });
  console.log("[phase-1] revoke signature:", revoked.signature);

  const paused = await postJson("/protocol/pause", {
    paused: true,
  });
  console.log("[phase-1] protocol pause signature:", paused.signature);

  const resumed = await postJson("/protocol/pause", {
    paused: false,
  });
  console.log("[phase-1] protocol resume signature:", resumed.signature);

  const revokedState = await getJson("/compliance/state", {
    institution_id_hash: institutionIdHash,
    nullifier_hash: nullifierHash,
  });
  console.log("[phase-1] revoked state:", JSON.stringify(revokedState, null, 2));
}

async function phaseProofWarmup() {
  console.log("\n[proof-only] warm oracle");
  const warmedOracle = await postJson("/compliance/warm-oracle", {});
  console.log("[proof-only] oracle:", JSON.stringify(warmedOracle, null, 2));

  console.log("\n[proof-only] warm proof cache");
  const warmedProof = await postJson("/compliance/warm-proof", {});
  console.log("[proof-only] proof:", JSON.stringify(warmedProof, null, 2));
}

async function phaseTwoLiveMint() {
  const operator = readKeypair(walletPath);
  const institutionName = `StableHacks Live Mint ${Date.now()}`;
  console.log("\n[phase-2] prepare operator mint");
  const prepared = await postJson("/prepare-devnet-mint", {
    owner_pubkey: operator.publicKey.toBase58(),
    zkusd_amount: smokeAmount,
    institution_name: institutionName,
    kyb_reference: `KYB:${institutionName}`,
    travel_rule_reference: `TRAVEL:${institutionName}`,
    daily_mint_cap: smokeAmount * 5,
    lifetime_mint_cap: smokeAmount * 20,
    permit_ttl_seconds: permitTtlSeconds,
    kyt_score: 12,
    travel_rule_required: true,
  });

  if (!prepared.serialized_transaction) {
    throw new Error("prepare-devnet-mint did not return a serialized transaction");
  }

  const connection = new Connection(prepared.cluster_url || process.env.SOLANA_CLUSTER_URL, "confirmed");
  const transaction = Transaction.from(Buffer.from(prepared.serialized_transaction, "base64"));
  transaction.partialSign(operator);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction(signature, "confirmed");
  console.log("[phase-2] submitted signature:", signature);

  const finalState = await getJson("/compliance/state", {
    institution_id_hash: prepared.permission_profile?.institution_id_hash,
    nullifier_hash: prepared.nullifier_hash,
  });
  console.log("[phase-2] final state:", JSON.stringify(finalState, null, 2));
}

async function main() {
  const health = await getJson("/health");
  console.log("[health]", JSON.stringify(health, null, 2));

  if (phase === "proof-only") {
    await phaseProofWarmup();
    console.log("\nproof warm-up complete");
    return;
  }

  if (phase === "controls-only") {
    await phaseOneComplianceControls();
    console.log("\ncontrol-plane rehearsal complete");
    return;
  }

  if (phase === "mint-only") {
    await phaseTwoLiveMint();
    console.log("\nlive mint rehearsal complete");
    return;
  }

  await phaseProofWarmup();
  await phaseOneComplianceControls();
  await phaseTwoLiveMint();
  console.log("\nsmoke complete");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
