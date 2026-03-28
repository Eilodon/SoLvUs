import { secp256k1 } from '@noble/curves/secp256k1';
import { BadgeType, Hex, RelayerResponse, RELAYER_SIG_EXPIRY } from '../contracts';
import {
  bytesToHex,
  fieldToBytes32BE,
  hexToBytes,
  normalizeHex,
  poseidonHash,
  splitBytes32To128BitFields,
  validateBitcoinAddress,
  validateBytesLength,
} from '../shared/utils';
import { BitcoinIndexer, FetchRelayerDataParams, RelayerSigner, Utxo } from './types';

const SANCTIONED_BTC_ADDRESSES = ['bc1q_sanctioned_dummy_1', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'];

export * from './types';
export * from './state';

function computeOldestUtxoAgeInDays(utxos: Utxo[], now: number): number {
  if (utxos.length === 0) {
    return 0;
  }

  const oldest = utxos.reduce((currentOldest, utxo) => Math.min(currentOldest, utxo.block_time), Infinity);
  return Math.floor((now - oldest) / 86400);
}

async function computeBtcData(indexer: BitcoinIndexer, btcAddress: string, badgeType: BadgeType, now: number): Promise<number> {
  switch (badgeType) {
    case BadgeType.Whale:
      return indexer.getBalance(btcAddress);
    case BadgeType.Hodler:
      return computeOldestUtxoAgeInDays(await indexer.getUtxos(btcAddress), now);
    case BadgeType.Stacker:
      return (await indexer.getUtxos(btcAddress)).length;
    default:
      throw new Error(`Unsupported badge type: ${badgeType}`);
  }
}

export async function computeRelayerCommitment(
  userPubkeyX: Hex,
  btcData: number,
  timestamp: number,
): Promise<Hex> {
  validateBytesLength(userPubkeyX, 32, 'user_pubkey_x');
  const [x_hi, x_lo] = splitBytes32To128BitFields(userPubkeyX);
  const commitment = await poseidonHash([x_hi, x_lo, BigInt(btcData), BigInt(timestamp)]);
  return bytesToHex(fieldToBytes32BE(commitment));
}

export class Secp256k1EnvRelayerSigner implements RelayerSigner {
  constructor(private readonly privateKeyHex: Hex) {}

  async getPublicKeyXY(): Promise<{ pubkey_x: Hex; pubkey_y: Hex }> {
    const uncompressed = secp256k1.getPublicKey(hexToBytes(this.privateKeyHex), false);
    return {
      pubkey_x: bytesToHex(uncompressed.slice(1, 33)),
      pubkey_y: bytesToHex(uncompressed.slice(33, 65)),
    };
  }

  async signCommitment(commitment: Hex): Promise<Hex> {
    validateBytesLength(commitment, 32, 'commitment');
    const signature = secp256k1.sign(hexToBytes(commitment), hexToBytes(this.privateKeyHex), {
      lowS: true,
      prehash: false,
    });
    return bytesToHex(signature.toCompactRawBytes());
  }
}

export async function fetchRelayerData(params: FetchRelayerDataParams): Promise<RelayerResponse> {
  const now = params.now ?? Math.floor(Date.now() / 1000);
  
  // Timestamp validation: must be within acceptable range
  const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes max age
  const MAX_TIMESTAMP_DRIFT_SECONDS = 60; // 1 minute future drift allowed
  if (now < params.timestamp - MAX_TIMESTAMP_DRIFT_SECONDS || now - params.timestamp > MAX_TIMESTAMP_AGE_SECONDS) {
    throw new Error(`Invalid timestamp: must be within ${MAX_TIMESTAMP_AGE_SECONDS}s of current time`);
  }
  
  validateBitcoinAddress(params.btcAddress);

  if (SANCTIONED_BTC_ADDRESSES.includes(params.btcAddress)) {
    throw new Error(`AML Compliance Error: The provided Bitcoin address is flagged or sanctioned.`);
  }
  validateBytesLength(params.userPubkeyX, 32, 'user_pubkey_x');

  // Check for replay if state store provided
  if (params.stateStore && !params.allowReuse) {
    const existing = await params.stateStore.getRecord(params.solanaAddress);
    if (existing) {
      throw new Error(
        `Relayer has already signed for Solana address ${params.solanaAddress} at ${new Date(
          existing.signedAt * 1000,
        ).toISOString()}. ` +
          `Replay is not allowed. Use a different address or wait for nullifier to be consumed on-chain.`,
      );
    }
  }

  // Verify DLC funding if dlcContractId is provided
  if (params.dlcContractId) {
    const isDlcFunded = await params.indexer.verifyProtocolDlcFunding(params.btcAddress, params.dlcContractId);
    if (!isDlcFunded) {
      throw new Error(`Oracle Attestation Failed: No confirmed DLC funding transaction found for contract ID ${params.dlcContractId} on Bitcoin address ${params.btcAddress}.`);
    }
  }

  const btc_data = await computeBtcData(params.indexer, params.btcAddress, params.badgeType, now);
  if (btc_data <= 0) {
    throw new Error('No UTXOs found');
  }

  const timestamp = now;
  const commitment = await computeRelayerCommitment(params.userPubkeyX, btc_data, timestamp);
  const signature = await params.signer.signCommitment(commitment);
  const publicKey = await params.signer.getPublicKeyXY();

  // Record signing after success
  if (params.stateStore) {
    await params.stateStore.recordSigning({
      solanaAddress: params.solanaAddress,
      signedAt: now,
      btcAddress: params.btcAddress,
      btcData: btc_data,
      nullifierCommitment: commitment,
    });
  }

  return {
    btc_data,
    timestamp,
    pubkey_x: publicKey.pubkey_x,
    pubkey_y: publicKey.pubkey_y,
    signature,
  };
}

export class MockBitcoinIndexer implements BitcoinIndexer {
  constructor(
    private readonly balance = 150_000_000,
    private readonly utxos: Utxo[] = [
      { value: 90_000_000, block_time: 1_700_000_000 },
      { value: 60_000_000, block_time: 1_710_000_000 },
    ],
  ) {}

  async getBalance(): Promise<number> {
    return this.balance;
  }

  async getUtxos(): Promise<Utxo[]> {
    return this.utxos;
  }

  async verifyProtocolDlcFunding(_btcAddress: string, _dlcContractId: string): Promise<boolean> {
    return true; // Mock always returns true for testing
  }
}
