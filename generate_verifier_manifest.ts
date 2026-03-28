import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

import { normalizeHex } from './packages/core';

interface ArtifactFixture {
  proof: string;
  public_inputs: string;
}

function sha256Hex(bytes: Buffer): string {
  return `0x${createHash('sha256').update(bytes).digest('hex')}`;
}

function hexToBuffer(value: string): Buffer {
  const normalized = normalizeHex(value);
  return Buffer.from(normalized.slice(2), 'hex');
}

const artifactPath = process.argv[2] || 'artifacts/devnet/groth16_fixture.json';
const outputPath = process.argv[3] || 'artifacts/devnet/verifier_manifest.json';

const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as ArtifactFixture;
const proof = hexToBuffer(artifact.proof);
const publicInputs = hexToBuffer(artifact.public_inputs);

const manifest = {
  mode: 'artifact-verifier',
  artifact_path: artifactPath,
  proof_bytes: proof.length,
  public_inputs_bytes: publicInputs.length,
  proof_sha256: sha256Hex(proof),
  public_inputs_sha256: sha256Hex(publicInputs),
};

writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
