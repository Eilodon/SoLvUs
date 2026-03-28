import { Hex, TIMESTAMP_TOLERANCE } from '../contracts';
import { bytes32BEToField, fieldToHex32, poseidonHash, validateBytesLength } from '../shared/utils';

export async function computeNonce(solanaAddress: Hex, timestamp: number): Promise<Hex> {
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }

  validateBytesLength(solanaAddress, 32, 'solana_address');
  const addressField = bytes32BEToField(solanaAddress);
  const minuteBucket = BigInt(Math.floor(timestamp / 60));
  const nonce = await poseidonHash([addressField, minuteBucket, 0n, 0n]);
  return fieldToHex32(nonce);
}

export function assertTimestampFresh(timestamp: number, now = Math.floor(Date.now() / 1000)): void {
  if (timestamp > now + TIMESTAMP_TOLERANCE) {
    throw new Error(`Timestamp expired: ${timestamp} > ${now} + ${TIMESTAMP_TOLERANCE}`);
  }
}
