import { Hex } from '../contracts';

export interface RelayerSigningRecord {
  solanaAddress: Hex;
  signedAt: number;       // unix timestamp
  btcAddress: string;
  btcData: number;
  nullifierCommitment: Hex; // commitment signed by relayer
}

export interface RelayerStateStore {
  hasBeenSigned(solanaAddress: Hex): Promise<boolean>;
  recordSigning(record: RelayerSigningRecord): Promise<void>;
  getRecord(solanaAddress: Hex): Promise<RelayerSigningRecord | null>;
}

/**
 * In-memory implementation of RelayerStateStore.
 * Note: High Entropy in production. Replace with persistent store (Redis/DB) for survival.
 */
export class InMemoryRelayerStore implements RelayerStateStore {
  private records = new Map<string, RelayerSigningRecord>();

  async hasBeenSigned(solanaAddress: Hex): Promise<boolean> {
    return this.records.has(solanaAddress.toLowerCase());
  }

  async recordSigning(record: RelayerSigningRecord): Promise<void> {
    this.records.set(record.solanaAddress.toLowerCase(), record);
  }

  async getRecord(solanaAddress: Hex): Promise<RelayerSigningRecord | null> {
    return this.records.get(solanaAddress.toLowerCase()) ?? null;
  }
}
