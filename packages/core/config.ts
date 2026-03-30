import { Hex } from './contracts';

export interface SolvusConfig {
  environment: string;
  proverServerUrl: string;
  solanaClusterUrl: string;
  solvusProgramId?: string;
  groth16VerifierProgramId?: string;
  oraclePriceFeedId?: string;
  zkusdMintAddress?: string;
  zkusdMintDecimals: number;
  solanaWalletPath: string;
  relayerPrivateKey?: Hex;
  proverBackend: 'groth16_adapter';
}

function readOptionalEnv(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env = process.env): SolvusConfig {
  const isRailwayRuntime = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
  const solanaWalletPath =
    readOptionalEnv(env.SOLANA_WALLET) ||
    (isRailwayRuntime ? undefined : `${process.env.HOME || ''}/.config/solana/id.json`);

  return {
    environment: readOptionalEnv(env.SOLVUS_ENV) || 'devnet',
    proverServerUrl: readOptionalEnv(env.PROVER_SERVER_URL) || 'http://localhost:3001',
    solanaClusterUrl: readOptionalEnv(env.SOLANA_CLUSTER_URL) || 'https://api.devnet.solana.com',
    solvusProgramId: readOptionalEnv(env.SOLVUS_PROGRAM_ID),
    groth16VerifierProgramId: readOptionalEnv(env.GROTH16_VERIFIER_PROGRAM_ID),
    oraclePriceFeedId: readOptionalEnv(env.ORACLE_PRICE_FEED_ID),
    zkusdMintAddress: readOptionalEnv(env.ZKUSD_MINT_ADDRESS),
    zkusdMintDecimals: Number.parseInt(readOptionalEnv(env.ZKUSD_MINT_DECIMALS) || '6', 10),
    solanaWalletPath: solanaWalletPath || '',
    relayerPrivateKey: readOptionalEnv(env.RELAYER_SECP256K1_PRIVATE_KEY) as Hex | undefined,
    proverBackend: 'groth16_adapter',
  };
}
