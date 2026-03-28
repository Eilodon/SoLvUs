import { mod } from '@noble/curves/abstract/modular';
import { sha512 } from '@noble/hashes/sha512';
import { BN254_PRIME, Hex } from '../contracts';
import { fieldToHex32, hexToBytes, stripRecoveryByte, validateBytesLength } from '../shared/utils';

export function computeNullifierSecret(userSig: Hex | Uint8Array): Hex {
  const signatureBytes = typeof userSig === 'string' ? hexToBytes(userSig) : userSig;
  if (signatureBytes.length !== 64) {
    throw new Error(`Invalid signature length: expected 64 bytes, got ${signatureBytes.length}`);
  }

  const rawInt = BigInt(`0x${Buffer.from(sha512(signatureBytes)).toString('hex')}`);
  const secret = mod(rawInt, BN254_PRIME);
  if (secret === 0n) {
    throw new Error('Nullifier secret cannot be zero');
  }

  return fieldToHex32(secret);
}

export function computeNullifierSecretFromBase64(userSigBase64: string): Hex {
  return computeNullifierSecret(stripRecoveryByte(userSigBase64));
}

export function assertNullifierSecret(secret: Hex): void {
  validateBytesLength(secret, 32, 'nullifier_secret');
}
