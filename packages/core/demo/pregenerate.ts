/**
 * Pregenerate Demo Proof
 * 
 * This script generates a ZK proof for the demo and saves it to a JSON file.
 * The UI in DEMO_MODE will use this cached proof to skip the proving wait time.
 */

import fs from 'fs';
import path from 'path';

async function pregenerate() {
  console.log('🚀 Starting Pre-generation of Demo Proof...');

  // Load env to get the private key for signing
  require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
  const privKeyHex = process.env.RELAYER_EDDSA_PRIVATE_KEY || 'b23323dfede91e8935147c93f8575d9a7caea4ceb8705c6564d11b3c459daa35';
  
  // Initialize circomlibjs for EdDSA signing
  // @ts-ignore
  const { buildEddsa, buildPoseidon } = await import('circomlibjs');
  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();
  const F = eddsa.F;

  // Mock data setup
  const pubkey_x = Array(32).fill(1);
  const btc_data = 250000000;

  // INV-05: Capture timestamp ONCE per proof generation.
  // Note: For a persistent demo, this timestamp should theoretically match the verifier's current window.
  const timestamp = Math.floor(Date.now() / 1000);
  const relayerResponse: any = {
    timestamp: timestamp
  };

  // Compute Poseidon hash identical to main.nr: [x_hi, x_lo, btc_data, timestamp]
  const x_hi = BigInt('0x' + Buffer.from(pubkey_x.slice(0, 16)).toString('hex'));
  const x_lo = BigInt('0x' + Buffer.from(pubkey_x.slice(16, 32)).toString('hex'));
  const payloadHashBuffer = poseidon([x_hi, x_lo, BigInt(btc_data), BigInt(timestamp)]);
  const payloadHash = poseidon.F.toObject(payloadHashBuffer);

  // Sign with the real Relayer private key
  const privKeyBuffer = Buffer.from(privKeyHex.replace('0x', ''), 'hex');
  const sig = eddsa.signPoseidon(privKeyBuffer, payloadHash);

  // Realistic looking inputs for the circuit
  const inputs = {
    starknet_address: "0x00000000d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    nonce: "0x1",
    user_sig: Array(64).fill(0), // Note: user_sig assertion might fail main.nr if uncommented
    relayer_sig_s: '0x' + F.toObject(sig.S).toString(16),
    relayer_sig_r8_x: '0x' + F.toObject(sig.R8[0]).toString(16),
    relayer_sig_r8_y: '0x' + F.toObject(sig.R8[1]).toString(16),
    badge_type: 1,
    tier: 1,
    threshold: 100000000,
    is_upper_bound: false,
    timestamp: timestamp,
    pubkey_x: pubkey_x,
    pubkey_y: Array(32).fill(1),
    btc_data: btc_data,
    nullifier_secret: "0x123",
    nullifier_hash: "0x15d1452d2b1b04847bd07c958b30ddbccdd5afff633de4341058c11d80d7a7e0" // Pre-computed dummy
  };

  console.log('📡 Sending request to Prover Server (http://localhost:3001/prove)...');
  
  try {
    const response = await fetch('http://localhost:3001/prove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Proof received from server!');

    const outputDir = path.join(process.cwd(), 'ui/public/demo');
    const outputPath = path.join(outputDir, 'cached_proof.json');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`💾 Demo proof cached at: ${outputPath}`);
  } catch (error) {
    console.error('❌ Failed to pregenerate:', error);
    process.exit(1);
  }
}

pregenerate();
