// @ts-ignore
import { buildPoseidon } from 'circomlibjs';

/**
 * NOIR_EXPECTED value — MUST match output from 'nargo test test_poseidon_compatibility'
 */
const NOIR_EXPECTED = 9466522002691521324493589609482440198176049472180101204622755976022160999655n;

/**
 * Verifies Poseidon compatibility between TypeScript (circomlibjs) and Noir (B#7 Gate).
 */
export async function verifyPoseidonCompatibility(): Promise<void> {
  if ((NOIR_EXPECTED as bigint) === 0n) {
    console.error('ERROR: B#7 FAIL - NOIR_EXPECTED chưa được điền.');
    console.log('HƯỚNG DẪN:');
    console.log('1. cd circuits && nargo test test_poseidon_compatibility');
    console.log('2. Copy giá trị "hash_4(1,2,3,1) = <VALUE>"');
    console.log('3. Điền <VALUE> vào NOIR_EXPECTED trong phase0/poseidon_verify.ts');
    process.exit(1);
  }

  const poseidon = await buildPoseidon();
  
  // INV-01: Order MUST be [secret, x_hi, x_lo, badge_type]
  // Test vector: [1, 2, 3, 1]
  const hash = poseidon([1n, 2n, 3n, 1n]);
  const tsResult = poseidon.F.toObject(hash) as bigint;

  if (tsResult === NOIR_EXPECTED) {
    console.log(`PASS [B#7]: Poseidon compatibility confirmed`);
    console.log(`Value: ${tsResult}`);
  } else {
    console.error('FAIL [B#7]: Poseidon mismatch!');
    console.error(`TypeScript (circomlibjs): ${tsResult}`);
    console.error(`Noir (expected):        ${NOIR_EXPECTED}`);
    process.exit(1);
  }
}

// CLI Execution
if (require.main === module) {
  verifyPoseidonCompatibility().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
