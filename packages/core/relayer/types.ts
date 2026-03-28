import { BadgeType, Hex, RelayerResponse } from '../contracts';

export interface Utxo {
  value: number;
  block_time: number;
}

export interface BitcoinIndexer {
  getBalance(btcAddress: string): Promise<number>;
  getUtxos(btcAddress: string): Promise<Utxo[]>;
  hasActiveDlc?(btcAddress: string): Promise<boolean>;
}

export interface RelayerSigner {
  getPublicKeyXY(): Promise<{ pubkey_x: Hex; pubkey_y: Hex }>;
  signCommitment(commitment: Hex): Promise<Hex>;
}

import { RelayerStateStore } from './state';

export interface FetchRelayerDataParams {
  btcAddress: string;
  badgeType: BadgeType;
  userPubkeyX: Hex;
  solanaAddress: Hex;
  timestamp: number;           // ADD — timestamp to validate
  indexer: BitcoinIndexer;
  signer: RelayerSigner;
  stateStore?: RelayerStateStore;
  now?: number;
  allowReuse?: boolean;
}

export type { RelayerResponse };
