import { computeNullifierSecret } from './identity/nullifier_secret';
import { buildUserSig } from './client/user_sig';
import { fetchRelayerData } from './relayer/index';
import { buildProverInputs, ProverInputParams } from './prover/inputs';

/**
 * SolvusOrchestrator: Coordinates the end-to-end proof generation flow.
 * Ensures relayer data freshness to comply with Cairo's 1-hour window (INV-05).
 */
export class SolvusOrchestrator {
  /**
   * Prepares all inputs for the Noir prover.
   * Forces a fresh relayer data fetch to avoid signature expiration.
   */
  async prepareInputs(params: {
    starknetAddress: string;
    nonce: bigint;
    btcAddress: string;
    badgeType: 1 | 2;
    tier: number;
    pubkeyXBytes: Uint8Array;
    pubkeyYBytes: Uint8Array;
    relayerPubkeyXFelt: bigint;
    relayerPubkeyYFelt: bigint;
  }): Promise<Record<string, unknown>> {
    const {
      starknetAddress,
      nonce,
      btcAddress,
      badgeType,
      tier,
      pubkeyXBytes,
      pubkeyYBytes,
      relayerPubkeyXFelt,
      relayerPubkeyYFelt,
    } = params;

    // 1. Identity Layer: Compute nullifier secret (deterministic)
    const nullifierSecretHex = await computeNullifierSecret(btcAddress);

    // 2. Client Layer: Build user signature (Bitcoin Signed Message)
    const userSig = await buildUserSig(starknetAddress, nonce, btcAddress);

    // 3. Relayer Layer: Fetch FRESH BTC data and signature (CRITICAL for INV-05)
    // This step ensures the timestamp is current and within Cairo's 3600s window.
    const relayerResponse = await fetchRelayerData(pubkeyXBytes, btcAddress, badgeType);

    // 4. Prover Layer: Assemble all 15 inputs for Noir
    const proverInputParams: ProverInputParams = {
      pubkeyXBytes,
      pubkeyYBytes,
      userSig,
      relayerResponse,
      nullifierSecretHex,
      starknetAddress,
      nonce,
      badgeType,
      tier,
      relayerPubkeyXFelt,
      relayerPubkeyYFelt,
    };

    return await buildProverInputs(proverInputParams);
  }
}
