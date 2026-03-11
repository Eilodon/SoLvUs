import { toHex64, stripRecoveryByte } from '../shared/utils';

/**
 * Placeholder for Xverse signMessage.
 * In a real implementation, this would come from 'sats-connect' or a similar SDK.
 */
async function signMessage(options: { message: string; address: string }): Promise<{ signature: string }> {
  // This is a placeholder since the actual SDK is not installed in this environment
  throw new Error('Xverse SDK (signMessage) not implemented in this environment.');
}

/**
 * Builds the user signature for Proof of Ownership.
 * 
 * MESSAGE FORMAT (INV-08):
 * 128 ASCII hex chars = toHex64(starknetAddress) + toHex64(nonce)
 * - 64 chars: starknetAddress (lowercase hex, padded, NO 0x)
 * - 64 chars: nonce (lowercase hex, padded, NO 0x)
 * 
 * RETURN:
 * 64-byte Uint8Array [r||s] (stripped recovery byte)
 */
export async function buildUserSig(
  starknetAddress: string | bigint,
  nonce: bigint,
  btcAddress: string
): Promise<Uint8Array> {
  // Step 1: Message reconstruction (Match Noir bytes_to_hex64)
  const addrBN = typeof starknetAddress === 'string' ? BigInt(starknetAddress) : starknetAddress;
  const message = toHex64(addrBN) + toHex64(nonce);

  if (message.length !== 128) {
    throw new Error(`Invalid message length: ${message.length}. Expected 128.`);
  }

  // Step 2: Sign message via Xverse
  const { signature: userSigBase64 } = await signMessage({ message, address: btcAddress });

  // Step 3: Strip recovery byte (INV-03)
  // Noir expect 64 bytes [r||s]
  return stripRecoveryByte(userSigBase64);
}
