#!/usr/bin/env bash
set -euo pipefail

PROVER_SERVER_URL="${PROVER_SERVER_URL:-http://127.0.0.1:3901}"
COMPLIANCE_API_KEY="${COMPLIANCE_API_KEY:-}"
SOLANA_CLUSTER_URL="${SOLANA_CLUSTER_URL:-https://api.devnet.solana.com}"

echo "=== SoLvUs Demo Preflight ==="

if [[ -z "${COMPLIANCE_API_KEY}" ]]; then
  echo "FAIL: COMPLIANCE_API_KEY not set"
  exit 1
fi
echo "OK: COMPLIANCE_API_KEY present"

HEALTH_JSON="$(curl -sf "${PROVER_SERVER_URL}/health")" || {
  echo "FAIL: prover server health check failed"
  exit 1
}
echo "OK: prover server reachable"
echo "${HEALTH_JSON}" | grep -q '"status":"ok"' || {
  echo "FAIL: prover server returned unhealthy payload"
  exit 1
}
echo "OK: prover server status is ok"

curl -sf "${SOLANA_CLUSTER_URL}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q '"ok"' || {
    echo "FAIL: Solana cluster health check failed"
    exit 1
  }
echo "OK: Solana cluster reachable"

curl -sf "${PROVER_SERVER_URL}/compliance/warm-oracle" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${COMPLIANCE_API_KEY}" \
  -d '{}' >/dev/null || {
    echo "FAIL: oracle warm-up failed"
    exit 1
  }
echo "OK: oracle warm-up path"

curl -sf "${PROVER_SERVER_URL}/compliance/warm-proof" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${COMPLIANCE_API_KEY}" \
  -d '{}' >/dev/null || {
    echo "FAIL: proof warm-up failed"
    exit 1
  }
echo "OK: proof warm-up path"

echo "=== Preflight PASSED ==="
