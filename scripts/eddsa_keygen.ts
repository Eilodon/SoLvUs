/**
 * BabyJubJub EdDSA Keypair Generator
 * 
 * Uses circomlibjs 0.1.7 (pinned per R10) to generate a BabyJubJub keypair
 * for the Relayer EdDSA-Poseidon signing scheme.
 * 
 * Usage: npx tsx scripts/eddsa_keygen.ts
 * 
 * Output:
 *   - Private key (hex) → store in .env as RELAYER_EDDSA_PRIVATE_KEY
 *   - Public key (x, y) as Field hex → hardcode in circuits/src/main.nr
 */

// @ts-ignore
import { buildEddsa } from 'circomlibjs';
import crypto from 'crypto';

async function main() {
  const eddsa = await buildEddsa();
  const F = eddsa.F;
  
  // Generate a random 32-byte private key
  const privKey = crypto.randomBytes(32);
  
  // Derive the public key on BabyJubJub
  const pubKey = eddsa.prv2pub(privKey);
  
  const pubX = F.toObject(pubKey[0]);
  const pubY = F.toObject(pubKey[1]);
  
  console.log('═══════════════════════════════════════════════');
  console.log('  BabyJubJub EdDSA Keypair Generated');
  console.log('═══════════════════════════════════════════════');
  console.log();
  console.log('📌 Private Key (store in .env as RELAYER_EDDSA_PRIVATE_KEY):');
  console.log(`   0x${privKey.toString('hex')}`);
  console.log();
  console.log('📌 Public Key X (hardcode in main.nr):');
  console.log(`   0x${pubX.toString(16)}`);
  console.log();
  console.log('📌 Public Key Y (hardcode in main.nr):');
  console.log(`   0x${pubY.toString(16)}`);
  console.log();
  console.log('📌 Noir code:');
  console.log(`   let relayer_pub_x: Field = 0x${pubX.toString(16)};`);
  console.log(`   let relayer_pub_y: Field = 0x${pubY.toString(16)};`);
  console.log();

  // Verify the key works by doing a test sign + verify
  const testMsg = F.e(789n);
  const sig = eddsa.signPoseidon(privKey, testMsg);
  const isValid = eddsa.verifyPoseidon(testMsg, sig, pubKey);
  console.log(`✅ Self-test (sign+verify): ${isValid ? 'PASS' : 'FAIL'}`);
  
  if (!isValid) {
    console.error('❌ CRITICAL: Self-test failed! Do NOT use this key.');
    process.exit(1);
  }
  
  // Print signature components for cross-reference
  console.log();
  console.log('📌 Test signature (msg=789) for cross-verification:');
  console.log(`   S:    0x${BigInt(F.toObject(sig.S)).toString(16)}`);
  console.log(`   R8.x: 0x${BigInt(F.toObject(sig.R8[0])).toString(16)}`);
  console.log(`   R8.y: 0x${BigInt(F.toObject(sig.R8[1])).toString(16)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
