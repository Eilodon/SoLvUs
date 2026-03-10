import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { u64ToBigEndian } from '../shared/utils';
import { RelayerResponse } from './types';

const xverseApi = {
  getBalance: async (address: string) => ({ balance: 0 }),
  getUtxos: async (address: string) => [] as { block_time: number }[],
};

async function getBtcData(btcAddress: string, badgeType: number): Promise<number> {
  if (badgeType === 1) { // Whale
    const { balance } = await xverseApi.getBalance(btcAddress);
    return balance;
  }
  if (badgeType === 2) { // Hodler
    const utxos = await xverseApi.getUtxos(btcAddress);
    if (utxos.length === 0) return 0;
    const oldest = utxos.reduce((min: number, u: any) => Math.min(min, u.block_time), Infinity);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.floor((nowSeconds - oldest) / 86400);
  }
  if (badgeType === 3) { // Stacker
    const utxos = await xverseApi.getUtxos(btcAddress);
    return utxos.length;
  }
  throw new Error(`Unknown badge_type: ${badgeType}`);
}

/**
 * Main Relayer logic.
 * Accepts private key as argument to avoid env issues in some runtimes.
 */
export async function fetchRelayerData(
  pubkeyXBytes: Uint8Array,
  btcAddress: string,
  badgeType: number,
  relayerKey?: string
): Promise<RelayerResponse> {
  const privateKey = relayerKey || process.env.RELAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('RELAYER_PRIVATE_KEY is not set.');
  }

  const btc_data = await getBtcData(btcAddress, badgeType);
  const timestamp = Math.floor(Date.now() / 1000);

  const payload = Buffer.concat([
    Buffer.from(pubkeyXBytes),
    u64ToBigEndian(btc_data),
    u64ToBigEndian(timestamp),
  ]);

  const relayer_sig = secp256k1
    .sign(sha256(payload), privateKey)
    .toCompactRawBytes();

  return { btc_data, timestamp, relayer_sig };
}
