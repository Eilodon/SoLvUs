import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

interface VerifierManifest {
  mode: 'generated-artifact';
  proof_path: string;
  public_inputs_path: string;
  vk_path: string;
  verifier_program_path: string;
  circuit_path: string;
  proof_bytes: number;
  public_inputs_bytes: number;
  proof_sha256: string;
  public_inputs_sha256: string;
  vk_sha256: string;
  verifier_program_sha256: string;
  circuit_sha256: string;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readArtifactBytes(filePath: string): Buffer {
  return readFileSync(filePath);
}

function relativeFromRoot(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function buildRustContract(manifest: VerifierManifest): string {
  return `// GENERATED FILE. DO NOT EDIT.
// Regenerate with: npm run sample:verifier-manifest

pub const GROTH16_PROOF_BYTES: usize = ${manifest.proof_bytes};
pub const GROTH16_PUBLIC_INPUT_BYTES: usize = ${manifest.public_inputs_bytes};
pub const VERIFIER_ARTIFACT_MODE: &str = "${manifest.mode}";
pub const VERIFIER_PROOF_SHA256: &str = "${manifest.proof_sha256}";
pub const VERIFIER_PUBLIC_INPUTS_SHA256: &str = "${manifest.public_inputs_sha256}";
pub const VERIFIER_VK_SHA256: &str = "${manifest.vk_sha256}";
pub const VERIFIER_PROGRAM_SHA256: &str = "${manifest.verifier_program_sha256}";
pub const VERIFIER_CIRCUIT_SHA256: &str = "${manifest.circuit_sha256}";
pub const VERIFIER_PROOF_PATH: &str = "${manifest.proof_path}";
pub const VERIFIER_PUBLIC_INPUTS_PATH: &str = "${manifest.public_inputs_path}";
pub const VERIFIER_VK_PATH: &str = "${manifest.vk_path}";
pub const VERIFIER_PROGRAM_PATH: &str = "${manifest.verifier_program_path}";
pub const VERIFIER_CIRCUIT_PATH: &str = "${manifest.circuit_path}";
`;
}

const rootDir = process.cwd();
const proofPath = path.resolve(rootDir, process.argv[2] || 'circuits/target/solvus.proof');
const publicInputsPath = path.resolve(rootDir, process.argv[3] || 'circuits/target/solvus.pw');
const vkPath = path.resolve(rootDir, process.argv[4] || 'circuits/target/solvus.vk');
const verifierProgramPath = path.resolve(rootDir, process.argv[5] || 'circuits/target/solvus.so');
const circuitPath = path.resolve(rootDir, process.argv[6] || 'circuits/target/solvus.json');
const manifestOutputPath = path.resolve(rootDir, process.argv[7] || 'artifacts/devnet/verifier_manifest.json');
const rustOutputPath = path.resolve(rootDir, process.argv[8] || 'solana/verifier_contract.rs');

const proof = readArtifactBytes(proofPath);
const publicInputs = readArtifactBytes(publicInputsPath);
const vk = readArtifactBytes(vkPath);
const verifierProgram = readArtifactBytes(verifierProgramPath);
const circuit = readArtifactBytes(circuitPath);

const manifest: VerifierManifest = {
  mode: 'generated-artifact',
  proof_path: relativeFromRoot(rootDir, proofPath),
  public_inputs_path: relativeFromRoot(rootDir, publicInputsPath),
  vk_path: relativeFromRoot(rootDir, vkPath),
  verifier_program_path: relativeFromRoot(rootDir, verifierProgramPath),
  circuit_path: relativeFromRoot(rootDir, circuitPath),
  proof_bytes: proof.length,
  public_inputs_bytes: publicInputs.length,
  proof_sha256: sha256Hex(proof),
  public_inputs_sha256: sha256Hex(publicInputs),
  vk_sha256: sha256Hex(vk),
  verifier_program_sha256: sha256Hex(verifierProgram),
  circuit_sha256: sha256Hex(circuit),
};

mkdirSync(path.dirname(manifestOutputPath), { recursive: true });
writeFileSync(manifestOutputPath, JSON.stringify(manifest, null, 2) + '\n');

mkdirSync(path.dirname(rustOutputPath), { recursive: true });
writeFileSync(rustOutputPath, buildRustContract(manifest));

console.log(JSON.stringify(manifest, null, 2));
