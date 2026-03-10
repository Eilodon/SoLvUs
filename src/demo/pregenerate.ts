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

  // Realistic looking inputs for the circuit (even though assertions are currently bypassed)
  const inputs = {
    starknet_address: "0x00000000d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    nonce: "0x1",
    user_sig: Array(64).fill(0),
    relayer_pubkey_x: Array(32).fill(0),
    relayer_pubkey_y: Array(32).fill(0),
    relayer_sig: Array(64).fill(0),
    badge_type: 1,
    tier: 1,
    threshold: 100000000,
    is_upper_bound: false,
    timestamp: Math.floor(Date.now() / 1000),
    pubkey_x: Array(32).fill(1), // Dummy user pubkey
    pubkey_y: Array(32).fill(1),
    btc_data: 250000000, // 2.5 BTC in sats
    nullifier_secret: "0x123",
    nullifier_hash: "0x15d1452d2b1b04847bd07c958b30ddbccdd5afff633de4341058c11d80d7a7e0" // Pre-computed dummy
  };

  console.log('📡 Sending request to Prover Server (http://localhost:3002/prove)...');
  
  try {
    const response = await fetch('http://localhost:3002/prove', {
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
