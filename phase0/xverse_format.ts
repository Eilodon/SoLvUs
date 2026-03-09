import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1';

/**
 * Verifies Xverse message signature format (B#1 & B#2 Gate).
 * Note: This script is intended to be run with a real signature from a wallet during a session.
 * For Phase 0 gate, we need to confirm the prefix and recovery byte range.
 */
export async function verifyXverseMessageFormat(
  btcAddress: string,
  pubkeyXBytes: Uint8Array,
  pubkeyYBytes: Uint8Array,
  sigBase64: string
): Promise<void> {
  const sigBytes = Buffer.from(sigBase64, 'base64');
  
  // B#2 Check: Recovery byte range
  if (sigBytes.length !== 65) {
    throw new Error(`FAIL [B#2]: Expected 65 bytes, got ${sigBytes.length}`);
  }

  const rb = sigBytes[0];
  if (rb < 31 || rb > 34) {
    throw new Error(`FAIL [B#2]: Invalid recovery byte: ${rb}. Expected [31–34] for compressed Xverse.`);
  }
  console.log(`PASS [B#2]: Recovery byte = ${rb} (compressed)`);

  // B#1 Check: Bitcoin Signed Message Verification with prefix 0x80
  const testMsg = 'a'.repeat(128);
  
  // Bitcoin Signed Message Prefix: "\x18Bitcoin Signed Message:\n" + varint(length)
  // varint(128) = 0x80
  const prefix = Buffer.from('18426974636f696e205369676e6564204d6573736167653a0a80', 'hex');
  const fullMsg = Buffer.concat([prefix, Buffer.from(testMsg, 'ascii')]);
  
  // Bitcoin signatures use double SHA256 of the prefixed message
  const hash = sha256(sha256(fullMsg));
  
  // Uncompressed public key format: 0x04 || X || Y
  const pubkeyUncompressed = Uint8Array.from([0x04, ...pubkeyXBytes, ...pubkeyYBytes]);
  
  // sig64 = strip recovery byte (index 0)
  const sig64 = sigBytes.slice(1);
  
  const isValid = secp256k1.verify(sig64, hash, pubkeyUncompressed);
  
  if (!isValid) {
    throw new Error(`FAIL [B#1]: Xverse ECDSA verify failed. Check message prefix (0x80) and double SHA256 logic.`);
  }

  console.log('PASS [B#1]: Xverse format confirmed — varint 0x80 correct');
}

// CLI Execution (if called directly)
if (require.main === module) {
    console.error('ERROR: Vui lòng chạy script này với dữ liệu chữ ký thực tế từ Xverse wallet.');
    process.exit(1);
}
