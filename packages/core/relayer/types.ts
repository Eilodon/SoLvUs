import { CollateralProfile, Hex, RelayerResponse } from '../contracts';

export interface Utxo {
  value: number;
  block_time: number;
}

export interface BitcoinIndexer {
  getBalance(btcAddress: string): Promise<number>;
  getUtxos(btcAddress: string): Promise<Utxo[]>;
  verifyProtocolDlcFunding(btcAddress: string, dlcContractId: Hex): Promise<boolean>;
}

export interface RelayerSigner {
  getPublicKeyXY(): Promise<{ pubkey_x: Hex; pubkey_y: Hex }>;
  signCommitment(commitment: Hex): Promise<Hex>;
}

export interface FetchRelayerDataParams {
  btcAddress: string;
  collateralProfile: CollateralProfile;
  userPubkeyX: Hex;
  solanaAddress: Hex;
  dlcContractId: Hex;
  indexer: BitcoinIndexer;
  signer: RelayerSigner;
  now?: number;
}

export type { RelayerResponse };
