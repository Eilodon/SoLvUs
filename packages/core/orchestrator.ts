import { BadgeType, Hex, MintZkUSDInput, ProofResponse } from './contracts';
import { buildMintMessage } from './client/user_sig';
import { fetchRelayerData } from './relayer';
import { BitcoinIndexer, RelayerSigner } from './relayer/types';
import { buildProverInputs, serializeVerifierPublicInputs } from './prover/inputs';
import { sha256Hex } from './shared/utils';

export interface PrepareMintRequestParams {
  btcAddress: string;
  solanaAddress: Hex;
  badgeType: BadgeType;
  userPubkeyX: Hex;
  userPubkeyY: Hex;
  userSignature: Hex;
  zkusdAmount: number;
  dlcContractId: Hex;
  nullifierSecret: Hex;
  l1RefundTimelock: number;
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
    dlcContractId: params.dlcContractId,
    indexer: params.indexer,
    signer: params.signer,
  });

  const prover_inputs = await buildProverInputs({
    user_pubkey_x: params.userPubkeyX,
    user_pubkey_y: params.userPubkeyY,
    user_sig: params.userSignature,
    relayer_response,
    solana_address: params.solanaAddress,
    badge_type: params.badgeType,
    nullifier_secret: params.nullifierSecret,
  });

  const public_inputs = serializeVerifierPublicInputs(prover_inputs);
  const mint_input: MintZkUSDInput = {
    nullifier_hash: prover_inputs.nullifier_hash,
    zkusd_amount: params.zkusdAmount,
    proof: '0x',
    public_inputs,
    l1_refund_timelock: params.l1RefundTimelock,
  };

  return {
    prover_inputs,
    mint_input,
    idempotency_key: sha256Hex(JSON.stringify(prover_inputs)),
    signable_message: buildMintMessage(
      params.solanaAddress,
      relayer_response.dlc_contract_id,
    ),
  };
}
