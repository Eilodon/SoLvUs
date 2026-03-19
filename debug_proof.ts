
import { Barretenberg, UltraHonkBackend, BackendType } from '@aztec/bb.js';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function main() {
  const CIRCUITS_PATH = path.join(__dirname, 'circuits');
  const uuid = 'debug-proof';
  const proverTomlPath = path.join(CIRCUITS_PATH, `${uuid}.toml`);
  const witnessPath = path.join(CIRCUITS_PATH, 'target', `${uuid}.gz`);

  const inputs = JSON.parse(readFileSync('/tmp/prove_params_v2.json', 'utf8')).inputs;

  function jsonToProverToml(inputs: Record<string, any>): string {
    let toml = '';
    for (const [key, value] of Object.entries(inputs)) {
      if (Array.isArray(value)) toml += `${key} = [${value.map(v => typeof v === 'string' ? '"' + v + '"' : v).join(', ')}]\n`;
      else if (typeof value === 'boolean' || typeof value === 'number') toml += `${key} = ${value}\n`;
      else toml += `${key} = "${value}"\n`;
    }
    return toml;
  }

  console.log('Writing Toml...');
  writeFileSync(proverTomlPath, jsonToProverToml(inputs));

  console.log('Executing Nargo...');
  try {
    execSync(`nargo execute --prover-name ${uuid} ${uuid}`, { cwd: CIRCUITS_PATH, stdio: 'inherit' });
  } catch (e) {
    console.error('Nargo execute failed');
    return;
  }

  console.log('Generating Proof with bb.js...');
  try {
    const circuitArtifact = JSON.parse(readFileSync(path.join(CIRCUITS_PATH, 'target/solvus.json'), 'utf8'));
    const bytecode = circuitArtifact.bytecode;
    const compressedWitness = readFileSync(witnessPath);
    const { gunzipSync } = require('zlib');
    const witness = witnessPath.endsWith('.gz') ? gunzipSync(compressedWitness) : compressedWitness;
    
    const api = await Barretenberg.new({ backend: BackendType.Wasm });
    const backend = new UltraHonkBackend(bytecode, api);
    const proofData = await backend.generateProof(witness);
    console.log('Proof generated successfully!');
    console.log('Proof:', '0x' + Buffer.from(proofData.proof).toString('hex').slice(0, 64) + '...');
  } catch (e: any) {
    console.error('bb.js failed:', e.message);
  }
}

main();
