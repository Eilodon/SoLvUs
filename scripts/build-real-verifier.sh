#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUNSPOT_ROOT="${SUNSPOT_ROOT:-/tmp/sunspot}"
GNARK_SOLANA_DIR="$SUNSPOT_ROOT/gnark-solana"
VERIFIER_BIN_DIR="$GNARK_SOLANA_DIR/crates/verifier-bin"
VERIFIER_LIB_VK_RS="$GNARK_SOLANA_DIR/crates/verifier-lib/src/vk.rs"
VERIFIER_BIN_CARGO="$VERIFIER_BIN_DIR/Cargo.toml"
VK_PATH="${1:-$ROOT_DIR/circuits/target/solvus.vk}"
SOLANA_BIN_DIR="${SOLANA_BIN_DIR:-$HOME/.local/share/solana/install/active_release/bin}"
SUNSPOT_BIN="${SUNSPOT_BIN:-$SUNSPOT_ROOT/bin/sunspot}"

require_file() {
  if [[ ! -f "$1" ]]; then
    printf 'missing required file: %s\n' "$1" >&2
    exit 1
  fi
}

require_dir() {
  if [[ ! -d "$1" ]]; then
    printf 'missing required directory: %s\n' "$1" >&2
    exit 1
  fi
}

require_dir "$GNARK_SOLANA_DIR"
require_file "$VERIFIER_LIB_VK_RS"
require_file "$VERIFIER_BIN_CARGO"
require_file "$VK_PATH"
require_file "$SUNSPOT_BIN"
require_file "$SOLANA_BIN_DIR/cargo-build-sbf"

python3 - <<'PY' "$VERIFIER_BIN_CARGO" "$VERIFIER_LIB_VK_RS"
from pathlib import Path
import sys

cargo_toml = Path(sys.argv[1])
vk_rs = Path(sys.argv[2])

cargo_text = cargo_toml.read_text()
needle = 'solana-program = "3.0.0"'
replacement = 'solana-program = "2.2.1"'
if needle in cargo_text:
    cargo_toml.write_text(cargo_text.replace(needle, replacement))

vk_text = vk_rs.read_text()
import_line = 'use std::mem::size_of;\n'
if import_line not in vk_text:
    target = 'use std::io::{self, Read, Write};\n'
    if target not in vk_text:
        raise SystemExit(f'failed to locate import insertion point in {vk_rs}')
    vk_rs.write_text(vk_text.replace(target, target + import_line))
PY

cargo update --manifest-path "$GNARK_SOLANA_DIR/Cargo.toml" -p indexmap --precise 2.11.4

export GNARK_VERIFIER_BIN="$VERIFIER_BIN_DIR"
export PATH="$HOME/.local/go/bin:$SOLANA_BIN_DIR:$PATH"

"$SUNSPOT_BIN" deploy "$VK_PATH"
npm run sample:verifier-manifest
