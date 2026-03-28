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
  solanaAddress: Hex;       // ADD — needed for dedup check
  indexer: BitcoinIndexer;
  signer: RelayerSigner;
  stateStore?: RelayerStateStore;   // ADD — optional for backward compat
  now?: number;
  allowReuse?: boolean;     // ADD — for testing; defaults to false
}

export type { RelayerResponse };
