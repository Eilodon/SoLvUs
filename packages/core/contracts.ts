export type Hex = `0x${string}`;

export const BN254_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const ZKUSD_MINT_AUTHORITY_SEED = 'zkusd_mint_authority';
export const PDA_NULLIFIER_SEED = 'nullifier_account';
export const VERIFICATION_PAYLOAD_SEED = 'verification_payload';
export const PROTOCOL_CONFIG_SEED = 'protocol_config';
export const INSTITUTION_ACCOUNT_SEED = 'institution_account';
export const COMPLIANCE_PERMIT_SEED = 'compliance_permit';
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
export const BALANCE_PROFILE_THRESHOLD = 100_000_000;
export const VINTAGE_PROFILE_THRESHOLD = 365;
export const DISTRIBUTION_PROFILE_THRESHOLD = 10;

export enum CollateralProfile {
  Balance = 1,
  Vintage = 2,
  Distribution = 3,
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
  nullifier_secret: Hex;
  pubkey_x: Hex;
  pubkey_y: Hex;
  user_sig: Hex;
  btc_data: number;
  relayer_sig: Hex;
  solana_address: Hex;
  relayer_pubkey_x: Hex;
  relayer_pubkey_y: Hex;
  collateral_profile: CollateralProfile;
  threshold: number;
  is_upper_bound: boolean;
  nullifier_hash: Hex;
}

export interface MintZkUSDInput {
  nullifier_hash: Hex;
  zkusd_amount: number;
  proof: Hex;
  public_inputs: Hex;
  l1_refund_timelock: number;
  relayer_fee?: number;
  institution_id_hash?: Hex;
  kyb_ref_hash?: Hex;
  travel_rule_ref_hash?: Hex;
  permit_expires_at?: number;
  kyt_score?: number;
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
  protocol_admin: Hex;
  compliance_admin: Hex;
  groth16_verifier_program_id: string;
  oracle_price_feed_id: string;
  liquidation_program_id?: string;
  authorized_relayer_pubkey_x: Hex;
  authorized_relayer_pubkey_y: Hex;
  collateral_ratio_bps: number;
  oracle_max_staleness_seconds: number;
  protocol_paused: boolean;
  updated_at: number;
}

export interface InstitutionPermissionProfile {
  institution_id_hash: Hex;
  institution_label: string;
  kyb_ref_hash: Hex;
  travel_rule_ref_hash: Hex;
  kyb_provider_ref_hash: Hex;
  travel_rule_provider_ref_hash: Hex;
  travel_rule_decision_ref_hash: Hex;
  originator_vasp_ref_hash: Hex;
  beneficiary_vasp_ref_hash: Hex;
  kyb_provider_label: string;
  travel_rule_provider_label: string;
  originator_vasp_label: string;
  beneficiary_vasp_label: string;
  permit_expires_at: number;
  kyt_score: number;
  daily_mint_cap: number;
  lifetime_mint_cap: number;
  travel_rule_required: boolean;
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

export function assertCollateralProfile(value: number): asserts value is CollateralProfile {
  if (
    value !== CollateralProfile.Balance &&
    value !== CollateralProfile.Vintage &&
    value !== CollateralProfile.Distribution
  ) {
    throw new Error(`Invalid collateral profile: ${value}`);
  }
}

export function getThresholdForCollateralProfile(collateralProfile: CollateralProfile): number {
  switch (collateralProfile) {
    case CollateralProfile.Balance:
      return BALANCE_PROFILE_THRESHOLD;
    case CollateralProfile.Vintage:
      return VINTAGE_PROFILE_THRESHOLD;
    case CollateralProfile.Distribution:
      return DISTRIBUTION_PROFILE_THRESHOLD;
    default:
      throw new Error(`Unsupported collateral profile: ${collateralProfile}`);
  }
}
