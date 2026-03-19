import { buildEddsa, buildPoseidon } from 'circomlibjs';
import { u64ToBigEndian } from '../shared/utils';
import { RelayerResponse } from './types';

const xverseApi = {
  getBalance: async (address: string) => ({ balance: 0 }),
  getUtxos: async (address: string) => [] as { block_time: number }[],
};

async function getBtcData(btcAddress: string, badgeType: number, timestamp: number): Promise<number> {
  if (badgeType === 1) { // Whale
    const { balance } = await xverseApi.getBalance(btcAddress);
    return balance;
  }
  if (badgeType === 2) { // Hodler
    const utxos = await xverseApi.getUtxos(btcAddress);
    if (utxos.length === 0) return 0;
    const oldest = utxos.reduce((min: number, u: any) => Math.min(min, u.block_time), Infinity);
    return Math.floor((timestamp - oldest) / 86400);
  }
  if (badgeType === 3) { // Stacker
    const utxos = await xverseApi.getUtxos(btcAddress);
    return utxos.length;
  }
  throw new Error(`Unknown badge_type: ${badgeType}`);
}

export async function fetchRelayerData(
  pubkeyXBytes: Uint8Array,
  btcAddress: string,
  badgeType: number,
  relayerKey?: string,
  forcedTimestamp?: number
): Promise<RelayerResponse> {
  const privateKeyHex = (relayerKey || process.env.RELAYER_EDDSA_PRIVATE_KEY || '').replace('0x','');
  if (!privateKeyHex) throw new Error('RELAYER_EDDSA_PRIVATE_KEY is not set.');

  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();

  // INV-05: Single Source of Truth for Time. 
  // Relayer originates the time, but can be forced for testing/determinism.
  const timestamp = forcedTimestamp || Math.floor(Date.now() / 1000);
  
  const response: RelayerResponse = {
    timestamp,
    btc_data: 0,
    relayer_sig_s: '',
    relayer_sig_r8_x: '',
    relayer_sig_r8_y: '',
  };

  response.btc_data = await getBtcData(btcAddress, badgeType, response.timestamp);

  const x_hi = BigInt('0x' + Buffer.from(pubkeyXBytes.slice(0, 16)).toString('hex'));
  const x_lo = BigInt('0x' + Buffer.from(pubkeyXBytes.slice(16, 32)).toString('hex'));
  
  const payloadHashBuffer = poseidon([x_hi, x_lo, BigInt(response.btc_data), BigInt(response.timestamp)]);
  const payloadHash = eddsa.F.e(poseidon.F.toObject(payloadHashBuffer));

  const privKey = Buffer.from(privateKeyHex, 'hex');
  const signature = eddsa.signPoseidon(privKey, payloadHash);

  response.relayer_sig_s = '0x' + BigInt(signature.S).toString(16).padStart(64, '0');
  response.relayer_sig_r8_x = '0x' + eddsa.F.toObject(signature.R8[0]).toString(16).padStart(64, '0');
  response.relayer_sig_r8_y = '0x' + eddsa.F.toObject(signature.R8[1]).toString(16).padStart(64, '0');

  return response;
}
