/**
 * BN254_PRIME (bigint constant) 
 * Source: EIP-197, circom/snarkjs, Noir stdlib. 
 * MUST be decimal literal to avoid transcription error.
 */
export const BN254_PRIME = 
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Converts a number or bigint to an 8-byte big-endian Buffer.
 * Uses Buffer.alloc(8) for zero-initialization safety.
 */
export function u64ToBigEndian(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(value));
  return buf;
}

/**
 * Returns a 64-character lowercase hex string without "0x" prefix.
 * Used for signing ASCII messages.
 */
export function toHex64(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/**
 * Returns a 66-character lowercase hex string with "0x" prefix.
 * Used for Field public inputs.
 */
export function toFieldHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Strips the recovery byte from an Xverse/Bitcoin signature (base64).
 * Returns 64 bytes [r||s].
 */
export function stripRecoveryByte(sigBase64: string): Uint8Array {
  const sigBytes = Buffer.from(sigBase64, 'base64');
  
  if (sigBytes.length !== 65) {
    throw new Error(`Expected 65 bytes, got ${sigBytes.length}`);
  }

  const rb = sigBytes[0];
  
  // DER signatures usually start with 0x30 (48).
  // Compact signatures should have rb in range [27, 34].
  if (rb === 48) {
    throw new Error(`Invalid recovery byte: ${rb}. Expected [27–34] (compact sig). If wallet returns DER format (starts with 0x30), use a DER canonicalizer first.`);
  }

  if (rb < 27 || rb > 34) {
    throw new Error(`Invalid recovery byte: ${rb}. Expected [27–34] (compact sig).`);
  }

  // Return r and s (64 bytes total), stripping the recovery byte at index 0.
  return new Uint8Array(sigBytes.slice(1));
}
