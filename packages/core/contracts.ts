export type Hex = `0x${string}`;

export const BN254_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const ZKUSD_MINT_AUTHORITY_SEED = 'zkusd_mint_authority';
export const PDA_NULLIFIER_SEED = 'nullifier_account';
export const PROTOCOL_CONFIG_SEED = 'protocol_config';
export const BADGE_EXPIRY = 259200;
export const TIMESTAMP_TOLERANCE = 300;
export const RELAYER_SIG_EXPIRY = 3600;
export const VARINT_128 = 0x80;
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const COLLATERALIZATION_RATIO = 15000;
export const LIQUIDATION_THRESHOLD = 12000;
export const AT_RISK_THRESHOLD = 13000;
export const CIRCUIT_BREAKER_TIMEOUT = 259200;
export const DLC_CLOSE_TIMEOUT = 3600;
export const GRACE_PERIOD_DURATION = 3600;
export const WHALE_THRESHOLD = 100_000_000;
export const HODLER_THRESHOLD = 365;
export const STACKER_THRESHOLD = 10;

export enum BadgeType {
  Whale = 1,
  Hodler = 2,
  Stacker = 3,
}

export enum TransactionStatus {
  Pending = 0,
  Confirmed = 1,
  Failed = 2,
  Liquidated = 3,
  PendingBtcRelease = 4,
  DlcTimeoutPending = 5,
}

export interface RelayerResponse {
  btc_data: number;
  dlc_contract_id: Hex;
  pubkey_x: Hex;
  pubkey_y: Hex;
  signature: Hex;
}

export interface ProverInputs {
  dlc_contract_id: Hex;
  pubkey_x: Hex;
  pubkey_y: Hex;
  user_sig: Hex;
  btc_data: number;
  relayer_sig: Hex;
  solana_address: Hex;
  relayer_pubkey_x: Hex;
  relayer_pubkey_y: Hex;
  badge_type: BadgeType;
  threshold: number;
  is_upper_bound: boolean;
  nullifier_hash: Hex;
}

export interface MintZkUSDInput {
  nullifier_hash: Hex;
  zkusd_amount: number;
  proof: Hex;
  public_inputs: Hex;
  relayer_fee?: number;
}

export interface MintZkUSDOutput {
  success: boolean;
  tx_signature?: Hex;
  zkusd_account?: Hex;
  nullifier_pda?: Hex;
}

export interface BurnZkUSDInput {
  zkusd_amount: number;
  recipient_btc?: Hex;
}

export interface VaultState {
  owner: Hex;
  collateral_btc: number;
  zkusd_minted: number;
  last_update: number;
  status: TransactionStatus;
  liquidation_price?: number;
  grace_period_end?: number;
  dlc_contract_id?: Hex;
  dlc_close_deadline?: number;
}

export interface ProtocolConfig {
  admin: Hex;
  groth16_verifier_program_id: string;
  oracle_price_feed_id: string;
  authorized_relayer_pubkey_x: Hex;
  authorized_relayer_pubkey_y: Hex;
  updated_at: number;
}

export interface ProofResponse {
  proof: Hex;
  public_inputs: Hex;
  proving_time: number;
  cached: boolean;
  retry_count: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  context: Record<string, unknown>;
  trace?: string;
}

export function assertBadgeType(value: number): asserts value is BadgeType {
  if (value !== BadgeType.Whale && value !== BadgeType.Hodler && value !== BadgeType.Stacker) {
    throw new Error(`Invalid badge type: ${value}`);
  }
}

export function getThresholdForBadge(badgeType: BadgeType): number {
  switch (badgeType) {
    case BadgeType.Whale:
      return WHALE_THRESHOLD;
    case BadgeType.Hodler:
      return HODLER_THRESHOLD;
    case BadgeType.Stacker:
      return STACKER_THRESHOLD;
    default:
      throw new Error(`Unsupported badge type: ${badgeType}`);
  }
}
