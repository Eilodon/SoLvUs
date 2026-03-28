import { secp256k1 } from '@noble/curves/secp256k1';
import { BadgeType, Hex, ProverInputs, RelayerResponse } from '../contracts';
import { hashMintMessage } from '../client/user_sig';
import { computeNullifierSecret } from '../identity/nullifier_secret';
import { buildProverInputs } from '../prover/inputs';
import { computeNonce } from '../prover/nonce';
import { MockBitcoinIndexer, Secp256k1EnvRelayerSigner, fetchRelayerData, RelayerStateStore } from '../relayer';
import { bytesToHex, hexToBytes } from '../shared/utils';

export const DEV_USER_PRIVATE_KEY =
  '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
export const DEV_RELAYER_PRIVATE_KEY =
  '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex;
export const DEV_SOLANA_ADDRESS =
  '0x0d4f58e7d1b9f7e28a65194055b6ef8320a6fce8f6af02119df2584c1b0ff812' as Hex;
export const DEV_BTC_ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
export const DEV_TIMESTAMP = 1762000000;
export const DEV_BADGE_TYPE = BadgeType.Whale;

export interface DevMintFixture {
  user_private_key: Hex;
  relayer_private_key: Hex;
  btc_address: string;
  badge_type: BadgeType;
  solana_address: Hex;
  timestamp: number;
  nonce: Hex;
  user_pubkey_x: Hex;
  user_pubkey_y: Hex;
  user_sig: Hex;
  nullifier_secret: Hex;
  relayer_response: RelayerResponse;
  prover_inputs: ProverInputs;
}

export interface DynamicDevMintFixtureParams {
  solana_address: Hex;
  btc_address?: string;
  badge_type?: BadgeType;
  timestamp?: number;
  user_private_key?: Hex;
  relayer_private_key?: Hex;
  stateStore?: RelayerStateStore;
}

interface BuildDevMintFixtureParams {
  user_private_key: Hex;
  relayer_private_key: Hex;
  btc_address: string;
  badge_type: BadgeType;
  solana_address: Hex;
  timestamp: number;
  stateStore?: RelayerStateStore;
}

async function buildDevMintFixture(params: BuildDevMintFixtureParams): Promise<DevMintFixture> {
  const userPublicKey = secp256k1.getPublicKey(hexToBytes(params.user_private_key), false);
  const user_pubkey_x = bytesToHex(userPublicKey.slice(1, 33));
  const user_pubkey_y = bytesToHex(userPublicKey.slice(33, 65));

  const nonce = await computeNonce(params.solana_address, params.timestamp);
  const userMessageHash = hashMintMessage(params.solana_address, nonce);
  const user_sig = bytesToHex(
    secp256k1
      .sign(userMessageHash, hexToBytes(params.user_private_key), { lowS: true, prehash: false })
      .toCompactRawBytes(),
  );
  const nullifier_secret = computeNullifierSecret(user_sig);

  const relayer_response = await fetchRelayerData({
    btcAddress: params.btc_address,
    badgeType: params.badge_type,
    userPubkeyX: user_pubkey_x,
    solanaAddress: params.solana_address,
    indexer: new MockBitcoinIndexer(),
    signer: new Secp256k1EnvRelayerSigner(params.relayer_private_key),
    now: params.timestamp,
    stateStore: params.stateStore,
  });

  const prover_inputs = await buildProverInputs({
    user_pubkey_x,
    user_pubkey_y,
    user_sig,
    relayer_response,
    nullifier_secret,
    solana_address: params.solana_address,
    badge_type: params.badge_type,
  });

  return {
    user_private_key: params.user_private_key,
    relayer_private_key: params.relayer_private_key,
    btc_address: params.btc_address,
    badge_type: params.badge_type,
    solana_address: params.solana_address,
    timestamp: params.timestamp,
    nonce,
    user_pubkey_x,
    user_pubkey_y,
    user_sig,
    nullifier_secret,
    relayer_response,
    prover_inputs,
  };
}

export async function createDevMintFixture(): Promise<DevMintFixture> {
  return buildDevMintFixture({
    user_private_key: DEV_USER_PRIVATE_KEY,
    relayer_private_key: DEV_RELAYER_PRIVATE_KEY,
    btc_address: DEV_BTC_ADDRESS,
    badge_type: DEV_BADGE_TYPE,
    solana_address: DEV_SOLANA_ADDRESS,
    timestamp: DEV_TIMESTAMP,
  });
}

export async function createDynamicDevMintFixture(
  params: DynamicDevMintFixtureParams,
): Promise<DevMintFixture> {
  const user_private_key =
    params.user_private_key ?? bytesToHex(secp256k1.utils.randomPrivateKey());

  return buildDevMintFixture({
    user_private_key,
    relayer_private_key: params.relayer_private_key ?? DEV_RELAYER_PRIVATE_KEY,
    btc_address: params.btc_address ?? DEV_BTC_ADDRESS,
    badge_type: params.badge_type ?? DEV_BADGE_TYPE,
    solana_address: params.solana_address,
    timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
    stateStore: params.stateStore,
  });
}
