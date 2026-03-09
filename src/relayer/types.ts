/**
 * RelayerResponse: Source of truth for relayer output shape.
 * INV-05: Relayer signatures must be 64-byte compact format [r||s].
 * INV-10: btc_data is either satoshis (badge_type=1) or days (badge_type=2).
 */
export interface RelayerResponse {
  btc_data: number;       // satoshi (badge_type=1) hoặc days (badge_type=2)
  timestamp: number;      // unix seconds — PHẢI dùng trong proverInputs
  relayer_sig: Uint8Array; // compact 64 bytes [r||s], NOT DER format
}
