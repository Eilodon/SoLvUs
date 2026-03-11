import * as deployment from '../cairo/deployment.json';

export const DEPLOYMENT = deployment;
export const CONTRACT_ADDRESS = deployment.contract_address;
export const PROVER_SERVER_URL = process.env.PROVER_SERVER_URL || 'http://localhost:3001';

/**
 * Invariant Check: Ensure consistency between contract address in config and deployment.json.
 */
if (!CONTRACT_ADDRESS) {
  console.warn('⚠️ CONTRACT_ADDRESS is not set. Run deployment script first.');
}
