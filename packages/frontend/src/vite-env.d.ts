/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROVER_SERVER_URL: string
  readonly VITE_CONTRACT_ADDRESS: string
  readonly VITE_STARKNET_RPC: string
  readonly VITE_DEMO_MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
