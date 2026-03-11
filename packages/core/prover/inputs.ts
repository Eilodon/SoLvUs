import { 
  felt252ToU8Array32, 
  computeNullifierHash, 
  getThresholdForBadge 
} from '../calldata_helper';
import { toFieldHex } from '../shared/utils';
import { RelayerResponse } from '../relayer/types';

/**
 * ProverInputParams: Integration point for all system layers.
 */
export interface ProverInputParams {
  pubkeyXBytes: Uint8Array;      // 32 bytes
  pubkeyYBytes: Uint8Array;      // 32 bytes
  userSig: Uint8Array;           // 64 bytes [r||s], recovery stripped
  relayerResponse: RelayerResponse; // Full response from Relayer
  nullifierSecretHex: string;    // "0x..." from computeNullifierSecret()
  starknetAddress: string;       // "0x..." Starknet address
  nonce: bigint;
  badgeType: 1 | 2 | 3;
  tier: number;
}

/**
 * Builds the complete input object for Noir Prover.
 * Total 15 fields: 6 Private, 9 Public.
 * 
 * INV-01: Nullifier must bind User to Badge.
 * INV-05: Relayer signatures are compact 64-byte.
 * INV-07: Public Inputs must match 1:1 with Cairo.
 */
export async function buildProverInputs(
  params: ProverInputParams
): Promise<Record<string, unknown>> {
  // Step 1: Calculate threshold (Source of Truth is calldata_helper/Cairo)
  const threshold = getThresholdForBadge(params.badgeType, params.tier);
  
  // Step 2: Compute Nullifier Hash (INV-01)
  // CRITICAL: Must use await as Poseidon initialization is lazy/async.
  const nullifierHashBigInt = await computeNullifierHash(
    params.pubkeyXBytes,
    BigInt(params.nullifierSecretHex),
    params.badgeType
  );
  
  // Step 3: (Removed: relayer_pubkey is no longer a public input)
  
  // Step 4: Assemble 15 fields (Match Noir main.nr exactly)
  return {
    // --- PRIVATE INPUTS (6) ---
    pubkey_x:         Array.from(params.pubkeyXBytes),
    pubkey_y:         Array.from(params.pubkeyYBytes),
    user_sig:         Array.from(params.userSig),
    relayer_sig:      Array.from(params.relayerResponse.relayer_sig),
    btc_data:         params.relayerResponse.btc_data,
    nullifier_secret: params.nullifierSecretHex,
    
    // --- PUBLIC INPUTS (7) ---
    starknet_address: toFieldHex(BigInt(params.starknetAddress)),
    nonce:            toFieldHex(params.nonce),
    badge_type:       params.badgeType,
    threshold:        threshold,
    is_upper_bound:   false, // Default to false per PRD Sprint 0
    timestamp:        params.relayerResponse.timestamp, // USE RELAYER TIMESTAMP (INV-12)
    nullifier_hash:   toFieldHex(nullifierHashBigInt),
  };
}
