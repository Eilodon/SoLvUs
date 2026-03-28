#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/solana/target/deploy"
GROTH16_DEPLOY_DIR="$ROOT_DIR/circuits/target"
WALLET_PATH="${SOLANA_WALLET:-$HOME/.config/solana/id.json}"
CLUSTER_URL="${SOLANA_CLUSTER_URL:-https://api.devnet.solana.com}"
SOLANA_BIN_DIR="${SOLANA_BIN_DIR:-$HOME/.local/share/solana/install/active_release/bin}"
SOLANA_BIN="$SOLANA_BIN_DIR/solana"
SOLANA_KEYGEN_BIN="$SOLANA_BIN_DIR/solana-keygen"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    printf 'missing required file: %s\n' "$1" >&2
    exit 1
  fi
}

set +u
source "$HOME/.profile" >/dev/null 2>&1 || true
set -u

require_file "$WALLET_PATH"
require_file "$GROTH16_DEPLOY_DIR/solvus.so"
require_file "$DEPLOY_DIR/groth16_verifier-keypair.json"
require_file "$DEPLOY_DIR/solvus.so"
require_file "$DEPLOY_DIR/solvus-keypair.json"

VERIFIER_PROGRAM_ID="$("$SOLANA_KEYGEN_BIN" pubkey "$DEPLOY_DIR/groth16_verifier-keypair.json")"
SOLVUS_PROGRAM_ID="$("$SOLANA_KEYGEN_BIN" pubkey "$DEPLOY_DIR/solvus-keypair.json")"
FEE_PAYER="$("$SOLANA_KEYGEN_BIN" pubkey "$WALLET_PATH")"

printf 'cluster: %s\n' "$CLUSTER_URL"
printf 'wallet: %s\n' "$WALLET_PATH"
printf 'fee payer: %s\n' "$FEE_PAYER"
printf 'groth16_verifier program id: %s\n' "$VERIFIER_PROGRAM_ID"
printf 'solvus program id: %s\n' "$SOLVUS_PROGRAM_ID"

run_cmd "$SOLANA_BIN" config set --url "$CLUSTER_URL" --keypair "$WALLET_PATH"
run_cmd "$SOLANA_BIN" balance

run_cmd "$SOLANA_BIN" program deploy \
  "$GROTH16_DEPLOY_DIR/solvus.so" \
  --program-id "$DEPLOY_DIR/groth16_verifier-keypair.json" \
  --keypair "$WALLET_PATH" \
  --url "$CLUSTER_URL"

run_cmd "$SOLANA_BIN" program deploy \
  "$DEPLOY_DIR/solvus.so" \
  --program-id "$DEPLOY_DIR/solvus-keypair.json" \
  --keypair "$WALLET_PATH" \
  --url "$CLUSTER_URL"

printf '\nexport GROTH16_VERIFIER_PROGRAM_ID=%s\n' "$VERIFIER_PROGRAM_ID"
printf 'export SOLVUS_PROGRAM_ID=%s\n' "$SOLVUS_PROGRAM_ID"
