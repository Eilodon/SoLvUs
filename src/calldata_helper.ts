// @ts-ignore
import { buildPoseidon } from 'circomlibjs';

/**
 * Converts a felt252 (bigint) to a 32-byte Uint8Array (Big-Endian).
 */
export function felt252ToU8Array32(felt: bigint): Uint8Array {
  if (felt < 0n) {
    throw new Error('felt252 cannot be negative');
  }
  const hex = felt.toString(16).padStart(64, '0');
  if (hex.length > 64) {
    throw new Error('felt252 exceeds 256 bits');
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/**
 * Splits a 32-byte public key X coordinate into two 128-bit fields (big-endian).
 * INV-02: x_hi = bytes[0..16], x_lo = bytes[16..32]
 */
export function splitTo128BitFields(pubkeyXBytes: Uint8Array): [bigint, bigint] {
  if (pubkeyXBytes.length !== 32) {
    throw new Error(`Expected 32 bytes for pubkeyX, got ${pubkeyXBytes.length}`);
  }

  const x_hi = BigInt('0x' + Buffer.from(pubkeyXBytes.slice(0, 16)).toString('hex'));
  const x_lo = BigInt('0x' + Buffer.from(pubkeyXBytes.slice(16, 32)).toString('hex'));

  return [x_hi, x_lo];
}

/**
 * Returns the threshold for a given badge type and tier.
 * MIRRORS Cairo get_expected_constraints() exactly.
 */
export function getThresholdForBadge(badgeType: number, tier: number): number {
  if (badgeType === 1) { // Whale (satoshi)
    switch (tier) {
      case 1: return 10_000_000;   // 0.1 BTC
      case 2: return 50_000_000;   // 0.5 BTC
      case 3: return 100_000_000;  // 1.0 BTC
      case 4: return 500_000_000;  // 5.0 BTC
      default: break;
    }
  } else if (badgeType === 2) { // Hodler (days)
    switch (tier) {
      case 1: return 180;
      case 2: return 365;
      default: break;
    }
  } else if (badgeType === 3) { // Stacker (UTXO count)
    switch (tier) {
      case 1: return 5;
      case 2: return 15;
      case 3: return 30;
      default: break;
    }
  }

  throw new Error(`Invalid badgeType=${badgeType} or tier=${tier}`);
}

/**
 * Lazy singleton for Poseidon builder.
 */
interface Poseidon {
  (inputs: bigint[]): bigint;
  F: {
    toObject(hash: any): bigint;
  };
}
let _poseidon: Poseidon | null = null;
async function getPoseidon(): Promise<Poseidon> {
  if (!_poseidon) {
    _poseidon = await buildPoseidon();
  }
  return _poseidon!;
}

/**
 * Computes the nullifier hash.
 * INV-01 ORDER: [nullifierSecret, x_hi, x_lo, badge_type]
 */
export async function computeNullifierHash(
  pubkeyXBytes: Uint8Array,
  nullifierSecret: bigint,
  badgeType: number
): Promise<bigint> {
  if (pubkeyXBytes.length !== 32) {
    throw new Error(`Expected 32 bytes for pubkeyX, got ${pubkeyXBytes.length}`);
  }
  if (badgeType !== 1 && badgeType !== 2 && badgeType !== 3) {
    throw new Error(`Invalid badgeType=${badgeType}`);
  }

  const [x_hi, x_lo] = splitTo128BitFields(pubkeyXBytes);
  const poseidon = await getPoseidon();
  
  // INV-01: CRITICAL ORDER
  const hash = poseidon([nullifierSecret, x_hi, x_lo, BigInt(badgeType)]);
  
  return poseidon.F.toObject(hash) as bigint;
}

/**
 * Validation suite for Phase 0 calldata implementation.
 */
export async function runPhase0Tests(relayerPubkeyXHex?: string, rawPubkeyXBytes?: Uint8Array): Promise<void> {
  // Test 1: felt252ToU8Array32 round-trip
  const testFelt = 0x1234567890abcdefn;
  const bytes = felt252ToU8Array32(testFelt);
  const roundTripFelt = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  if (testFelt !== roundTripFelt) {
    throw new Error('FAIL [1/3]: felt252ToU8Array32 round-trip mismatch');
  }
  console.log('PASS [1/3]: felt252ToU8Array32 round-trip confirmed');

  // Test 2: splitTo128BitFields round-trip
  const testBytes = new Uint8Array(32).fill(0xAA);
  const [hi, lo] = splitTo128BitFields(testBytes);
  const reconstructed = (hi << 128n) | lo;
  const original = BigInt('0x' + Buffer.from(testBytes).toString('hex'));
  if (reconstructed !== original) {
    throw new Error('FAIL [2/3]: splitTo128BitFields round-trip mismatch');
  }
  console.log('PASS [2/3]: splitTo128BitFields round-trip confirmed');

  // Test 3: getThresholdForBadge mapping
  const testCases = [
    { bt: 1, t: 1, v: 10_000_000 },
    { bt: 1, t: 4, v: 500_000_000 },
    { bt: 2, t: 1, v: 180 },
    { bt: 2, t: 2, v: 365 },
  ];
  for (const { bt, t, v } of testCases) {
    if (getThresholdForBadge(bt, t) !== v) {
      throw new Error(`FAIL [3/3]: Threshold mismatch for badge=${bt} tier=${t}`);
    }
  }
  console.log('PASS [3/3]: getThresholdForBadge mapping confirmed');

  console.log('Phase 0 calldata tests: 3/3 PASSED');
}
