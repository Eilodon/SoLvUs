import { secp256k1 } from '@noble/curves/secp256k1';
import { CollateralProfile, Hex, RelayerResponse, RELAYER_SIG_EXPIRY } from '../contracts';
import {
  bytes32BEToField,
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

function computeOldestUtxoAgeInDays(utxos: Utxo[], now: number): number {
  if (utxos.length === 0) {
    return 0;
  }

  const oldest = utxos.reduce((currentOldest, utxo) => Math.min(currentOldest, utxo.block_time), Infinity);
  return Math.floor((now - oldest) / 86400);
}

async function computeBtcData(
  indexer: BitcoinIndexer,
  btcAddress: string,
  collateralProfile: CollateralProfile,
  now: number,
): Promise<number> {
  switch (collateralProfile) {
    case CollateralProfile.Balance:
      return indexer.getBalance(btcAddress);
    case CollateralProfile.Vintage:
      return computeOldestUtxoAgeInDays(await indexer.getUtxos(btcAddress), now);
    case CollateralProfile.Distribution:
      return (await indexer.getUtxos(btcAddress)).length;
    default:
      throw new Error(`Unsupported collateral profile: ${collateralProfile}`);
  }
}

export async function computeRelayerCommitment(
  userPubkeyX: Hex,
  btcData: number,
  dlcContractId: Hex,
): Promise<Hex> {
  validateBytesLength(userPubkeyX, 32, 'user_pubkey_x');
  const [x_hi, x_lo] = splitBytes32To128BitFields(userPubkeyX);
  const dlcBigInt = bytes32BEToField(dlcContractId);
  const commitment = await poseidonHash([x_hi, x_lo, BigInt(btcData), dlcBigInt]);
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
  
  validateBitcoinAddress(params.btcAddress);

  if (SANCTIONED_BTC_ADDRESSES.includes(params.btcAddress)) {
    throw new Error(`AML Compliance Error: The provided Bitcoin address is flagged or sanctioned.`);
  }
  validateBytesLength(params.userPubkeyX, 32, 'user_pubkey_x');

  const isDlcValid = await params.indexer.verifyProtocolDlcFunding(params.btcAddress, params.dlcContractId);
  if (!isDlcValid) {
    throw new Error(`Invalid or unconfirmed DLC Contract ID: ${params.dlcContractId}`);
  }

  const btc_data = await computeBtcData(params.indexer, params.btcAddress, params.collateralProfile, now);
  if (btc_data <= 0) {
    throw new Error('No UTXOs found');
  }

  const commitment = await computeRelayerCommitment(params.userPubkeyX, btc_data, params.dlcContractId);
  const signature = await params.signer.signCommitment(commitment);
  const publicKey = await params.signer.getPublicKeyXY();

  return {
    btc_data,
    dlc_contract_id: params.dlcContractId,
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
