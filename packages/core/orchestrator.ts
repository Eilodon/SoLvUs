import { BadgeType, Hex, MintZkUSDInput, ProofResponse } from './contracts';
import { buildMintMessage } from './client/user_sig';
import { computeNullifierSecret } from './identity/nullifier_secret';
import { fetchRelayerData } from './relayer';
import { BitcoinIndexer, RelayerSigner } from './relayer/types';
import { buildProverInputs, serializeVerifierPublicInputs } from './prover/inputs';
import { computeNonce } from './prover/nonce';
import { sha256Hex } from './shared/utils';

export interface PrepareMintRequestParams {
  btcAddress: string;
  solanaAddress: Hex;
  badgeType: BadgeType;
  userPubkeyX: Hex;
  userPubkeyY: Hex;
  userSignature: Hex;
  zkusdAmount: number;
  indexer: BitcoinIndexer;
  signer: RelayerSigner;
}

export async function prepareMintRequest(params: PrepareMintRequestParams): Promise<{
  prover_inputs: Awaited<ReturnType<typeof buildProverInputs>>;
  mint_input: MintZkUSDInput;
  idempotency_key: Hex;
  signable_message: string;
}> {
  const relayer_response = await fetchRelayerData({
    btcAddress: params.btcAddress,
    badgeType: params.badgeType,
    userPubkeyX: params.userPubkeyX,
    solanaAddress: params.solanaAddress,
    indexer: params.indexer,
    signer: params.signer,
  });

  const nullifier_secret = computeNullifierSecret(params.userSignature);
  const prover_inputs = await buildProverInputs({
    user_pubkey_x: params.userPubkeyX,
    user_pubkey_y: params.userPubkeyY,
    user_sig: params.userSignature,
    relayer_response,
    nullifier_secret,
    solana_address: params.solanaAddress,
    badge_type: params.badgeType,
  });

  const public_inputs = serializeVerifierPublicInputs(prover_inputs);
  const mint_input: MintZkUSDInput = {
    nullifier_hash: prover_inputs.nullifier_hash,
    zkusd_amount: params.zkusdAmount,
    proof: '0x',
    public_inputs,
  };

  return {
    prover_inputs,
    mint_input,
    idempotency_key: sha256Hex(JSON.stringify(prover_inputs)),
    signable_message: buildMintMessage(
      params.solanaAddress,
      await computeNonce(params.solanaAddress, relayer_response.timestamp),
    ),
  };
}
