import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, computeRelayerCommitment, createDevMintFixture, hexToBytes, hashMintMessage } from './packages/core';

async function run() {
  const fixture = await createDevMintFixture();
  const relayerPubkey = new Uint8Array([
    0x04,
    ...hexToBytes(fixture.relayer_response.pubkey_x),
    ...hexToBytes(fixture.relayer_response.pubkey_y),
  ]);
  const userPubkey = new Uint8Array([
    0x04,
    ...hexToBytes(fixture.user_pubkey_x),
    ...hexToBytes(fixture.user_pubkey_y),
  ]);

  const commitment = await computeRelayerCommitment(
    fixture.user_pubkey_x,
    fixture.relayer_response.btc_data,
    fixture.relayer_response.timestamp,
  );
  const relayerValid = secp256k1.verify(
    hexToBytes(fixture.relayer_response.signature),
    hexToBytes(commitment),
    relayerPubkey,
    { prehash: false },
  );
  const userValid = secp256k1.verify(
    hexToBytes(fixture.user_sig),
    hashMintMessage(fixture.solana_address, fixture.nonce),
    userPubkey,
    { prehash: false },
  );

  console.log(
    JSON.stringify(
      {
        commitment,
        user_sig: fixture.user_sig,
        relayer_response: fixture.relayer_response,
        relayer_signature_valid: relayerValid,
        user_signature_valid: userValid,
        nullifier_hash: fixture.prover_inputs.nullifier_hash,
        public_inputs: fixture.prover_inputs,
      },
      null,
      2,
    ),
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exit(1);
});
