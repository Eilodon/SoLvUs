import { computeNullifierSecret } from './identity/nullifier_secret';
import { buildUserSig } from './client/user_sig';
import { fetchRelayerData } from './relayer/index';
import { buildProverInputs } from './prover/inputs';

/**
 * Interfaces for Orchestrator Flow
 */
export interface StarknetContract {
  getNonce(address: string): Promise<bigint>;
  issueBadge(badgeType: number, tier: number, publicInputs: any, proof: string): Promise<string>;
}

export interface IssueBadgeParams {
  btcAddress: string;
  starknetAddress: string;
  badgeType: 1 | 2 | 3;
  tier: number;
  proverServerUrl: string;
  starknetContract: StarknetContract;
  onProgress?: (step: string, detail?: string) => void;
}

export interface IssueBadgeResult {
  proof: string;
  publicInputs: string[];
  nullifierHash: string;
  txHash?: string;
}

/**
 * Helper: Converts hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const array = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    array[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return array;
}

/**
 * Helper: Maps public inputs array to Cairo struct fields for Garaga.
 * INV-07: Public Inputs must match 1:1 with Cairo struct order.
 */
function buildPublicInputsStruct(publicInputs: string[]) {
  // Mapping based on contract.cairo PublicInputs struct (8 fields):
  // 0: starknet_address
  // 1: nonce
  // 2: badge_type
  // 3: threshold
  // 4: is_upper_bound
  // 5: timestamp
  // 6: nullifier_hash
  return {
    starknet_address: publicInputs[0],
    nonce: publicInputs[1],
    badge_type: parseInt(publicInputs[2], 16),
    threshold: BigInt(publicInputs[3]),
    is_upper_bound: publicInputs[4] === '0x01' || publicInputs[4] === '1',
    timestamp: parseInt(publicInputs[5], 16),
    nullifier_hash: publicInputs[6]
  };
}

/**
 * issueBadge: Complete end-to-end flow coordiantor.
 * Orchestrates Identity, Client, Relayer, Prover, and Contract layers.
 */
export async function issueBadge(params: IssueBadgeParams): Promise<IssueBadgeResult> {
  const { 
    btcAddress, 
    starknetAddress, 
    badgeType, 
    tier, 
    proverServerUrl, 
    starknetContract,
    onProgress 
  } = params;

  // Step 1 — Fetch nonce from contract
  onProgress?.('Fetching state...', 'Retrieving nonce from Starknet');
  const nonce = await starknetContract.getNonce(starknetAddress);

  // Step 2 — Get BTC pubkey from Xverse
  onProgress?.('Identity discovery...', 'Requesting public key from Bitcoin wallet');
  const { getPublicKey } = await import('sats-connect');
  const { publicKey } = await getPublicKey({ address: btcAddress });
  const pubkeyXBytes = hexToBytes(publicKey.slice(2, 66));   // bytes 1-32
  const pubkeyYBytes = hexToBytes(publicKey.slice(66, 130)); // bytes 33-64

  // Step 3 — Parallel: nullifier secret + user sig + relayer data
  onProgress?.('Cryptographic assembly...', 'Generating signatures and fetching BTC data in parallel');
  const [nullifierSecretHex, userSig, relayerResponse] = await Promise.all([
    computeNullifierSecret(btcAddress),
    buildUserSig(starknetAddress, nonce, btcAddress),
    fetchRelayerData(pubkeyXBytes, btcAddress, badgeType),
  ]);

  // Step 4 — Build prover inputs
  onProgress?.('Preparing prover inputs...', 'Assembling 13-field input object');
  const proverInputs = await buildProverInputs({
    pubkeyXBytes,
    pubkeyYBytes,
    userSig,
    relayerResponse,
    nullifierSecretHex,
    starknetAddress,
    nonce,
    badgeType,
    tier,
  });

  // Step 5 — Generate proof via server
  onProgress?.('Generating ZK proof...', 'Offloading computation to Prover Server');
  const response = await fetch(`${proverServerUrl}/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: proverInputs }),
  });

  if (!response.ok) {
    const errorData = await response.json() as { error?: string };
    throw new Error(`Proving failed: ${errorData.error || response.statusText}`);
  }

  const { proof, publicInputs } = await response.json() as { proof: string; publicInputs: string[] };

  // Step 6 — Submit lên chain
  onProgress?.('Submitting transaction...', 'Verifying proof and minting badge on Starknet');
  const txHash = await starknetContract.issueBadge(
    badgeType,
    tier,
    buildPublicInputsStruct(publicInputs),
    proof
  );

  onProgress?.('Success!', 'Badge issued successfully');

  return {
    proof,
    publicInputs,
    nullifierHash: proverInputs.nullifier_hash as string,
    txHash
  };
}
