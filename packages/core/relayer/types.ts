export interface RelayerResponse {
  btc_data: number;
  timestamp: number;
  relayer_sig_s:    string; // Field hex "0x..."
  relayer_sig_r8_x: string; // Field hex "0x..."
  relayer_sig_r8_y: string; // Field hex "0x..."
}
