import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { u64ToBigEndian } from '../shared/utils';
import { RelayerResponse } from './types';

/**
 * Placeholder for Xverse API.
 * In a real implementation, this would be an actual API client.
 */
const xverseApi = {
  getBalance: async (address: string) => ({ balance: 0 }),
  getUtxos: async (address: string) => [] as { block_time: number }[],
};

/**
 * Loads Relayer Private Key from environment.
 * INV-16: Never hardcode private keys.
 */
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || '';

/**
 * Internal: Fetches BTC data based on badge type.
 * INV-10: Whale (1) = Satoshis, Hodler (2) = Days.
 */
async function getBtcData(btcAddress: string, badgeType: number): Promise<number> {
  if (badgeType === 1) { // Whale
    const { balance } = await xverseApi.getBalance(btcAddress);
    return balance; // satoshi
  }

  if (badgeType === 2) { // Hodler
    const utxos = await xverseApi.getUtxos(btcAddress);
    if (utxos.length === 0) return 0;

    // INV-09: Use reduce for large UTXO sets to avoid stack overflow.
    const oldest = utxos.reduce(
      (min: number, u: any) => Math.min(min, u.block_time),
      Infinity
    );
    
    // Calculate days: (current_time - oldest_utxo_time) / seconds_in_day
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.floor((nowSeconds - oldest) / 86400);
  }

  if (badgeType === 3) { // Stacker
    const utxos = await xverseApi.getUtxos(btcAddress);
    return utxos.length; // current UTXO count
  }

  throw new Error(`Unknown badge_type: ${badgeType}`);
}

/**
 * Export: Fetches data and signs it for the Prover.
 * Payload: pubkey_x[32] + btc_data[8BE] + timestamp[8BE]
 */
export async function fetchRelayerData(
  pubkeyXBytes: Uint8Array,
  btcAddress: string,
  badgeType: number
): Promise<RelayerResponse> {
  if (!RELAYER_PRIVATE_KEY) {
    throw new Error('RELAYER_PRIVATE_KEY is not set in environment.');
  }

  const btc_data = await getBtcData(btcAddress, badgeType);
  const timestamp = Math.floor(Date.now() / 1000);

  // Step 1: Payload construction (48 bytes)
  // [32 bytes pubkey_x] + [8 bytes btc_data BE] + [8 bytes timestamp BE]
  const payload = Buffer.concat([
    Buffer.from(pubkeyXBytes),
    u64ToBigEndian(btc_data),
    u64ToBigEndian(timestamp),
  ]);

  // Step 2: Sign payload (compact 64 bytes [r||s])
  // INV-05: Relayer signatures must be 64-byte compact format.
  const relayer_sig = secp256k1
    .sign(sha256(payload), RELAYER_PRIVATE_KEY)
    .toCompactRawBytes();

  return { btc_data, timestamp, relayer_sig };
}
