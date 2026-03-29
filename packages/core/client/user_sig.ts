import { createHash } from 'crypto';
import { Hex } from '../contracts';
import {
  bytesToHex,
  fieldToHex32,
  normalizeHex,
  stripRecoveryByte,
  validateBytesLength,
} from '../shared/utils';

const BITCOIN_SIGNED_MESSAGE_PREFIX = Uint8Array.from([
  0x18, 0x42, 0x69, 0x74, 0x63, 0x6f, 0x69, 0x6e, 0x20, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x20,
  0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x3a, 0x0a, 0x80,
]);

export function buildMintMessage(solanaAddress: Hex, nonce: Hex | bigint): string {
  validateBytesLength(solanaAddress, 32, 'solana_address');
  const dlcContractIdHex = typeof nonce === 'bigint' ? fieldToHex32(nonce) : normalizeHex(nonce);
  validateBytesLength(dlcContractIdHex, 32, 'dlc_contract_id');
  return solanaAddress.slice(2) + dlcContractIdHex.slice(2);
}

export function buildMintMessagePreimage(solanaAddress: Hex, nonce: Hex | bigint): Uint8Array {
  const message = Buffer.from(buildMintMessage(solanaAddress, nonce), 'utf8');
  return new Uint8Array(Buffer.concat([Buffer.from(BITCOIN_SIGNED_MESSAGE_PREFIX), message]));
}

export function hashMintMessage(solanaAddress: Hex, nonce: Hex | bigint): Uint8Array {
  const preimage = buildMintMessagePreimage(solanaAddress, nonce);
  const firstPass = createHash('sha256').update(preimage).digest();
  return new Uint8Array(createHash('sha256').update(firstPass).digest());
}

export function compactSignatureFromBase64(signatureBase64: string): Hex {
  return bytesToHex(stripRecoveryByte(signatureBase64));
}
