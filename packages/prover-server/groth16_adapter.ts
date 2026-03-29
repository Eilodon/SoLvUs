import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import {
  Hex,
  ProverInputs,
  normalizeHex,
  serializeCircuitInputsToToml,
  serializeVerifierPublicInputs,
  stableJsonHash,
} from '../core';

const execFileAsync = promisify(execFile);

export type Groth16AdapterMode = 'artifact' | 'sunspot';

interface Groth16Artifact {
  proof: Hex;
  public_inputs: Hex;
  expected_prover_inputs_hash?: Hex;
}

export interface Groth16ProofBundle {
  proof: Hex;
  public_inputs: Hex;
}

const WORKSPACE_ROOT = path.join(__dirname, '../..');
const CIRCUITS_DIR = path.join(WORKSPACE_ROOT, 'circuits');
const TARGET_DIR = path.join(CIRCUITS_DIR, 'target');
const CCS_PATH = path.join(TARGET_DIR, 'solvus.ccs');
const PK_PATH = path.join(TARGET_DIR, 'solvus.pk');
const VK_PATH = path.join(TARGET_DIR, 'solvus.vk');

let adapterMode: Groth16AdapterMode = 'sunspot';

function coerceHex(value: unknown, fieldName: string): Hex {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}: expected hex string`);
  }

  const normalized = normalizeHex(value);
  if ((normalized.length - 2) % 2 === 0) {
    return normalized;
  }
  return normalizeHex(`0x0${normalized.slice(2)}`);
}

function resolveArtifactPath(): string | null {
  const explicitPath = process.env.SOLVUS_GROTH16_PROOF_PATH?.trim();
  if (!explicitPath) {
    return null;
  }
  return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath);
}

function resolveExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const expanded = candidate.startsWith('~/')
      ? path.join(process.env.HOME || '', candidate.slice(2))
      : candidate;
    const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
    try {
      require('fs').accessSync(absolute);
      return absolute;
    } catch {
      continue;
    }
  }
  return null;
}

function resolveNargoBin(): string {
  const resolved = resolveExistingPath([
    process.env.NARGO_BIN?.trim() || '',
    '~/.nargo/bin/nargo',
  ].filter(Boolean));
  if (!resolved) {
    throw new Error('Missing nargo binary. Set NARGO_BIN or install ~/.nargo/bin/nargo.');
  }
  return resolved;
}

function resolveSunspotBin(): string {
  const resolved = resolveExistingPath([
    process.env.SUNSPOT_BIN?.trim() || '',
    path.join(WORKSPACE_ROOT, 'bin/sunspot'),
    '/tmp/sunspot/bin/sunspot',
    '~/.local/bin/sunspot',
    'sunspot',
  ].filter(Boolean));
  if (!resolved) {
    throw new Error(
      'Missing sunspot binary. Set SUNSPOT_BIN or install a sunspot binary in PATH.',
    );
  }
  return resolved;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnv?: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
      },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error: any) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}${details ? `\n${details}` : ''}`,
    );
  }
}

async function loadArtifactFromDisk(artifactPath: string): Promise<Groth16Artifact> {
  const raw = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as Record<string, unknown>;

  return {
    proof: coerceHex(raw.proof, 'proof'),
    public_inputs: coerceHex(raw.public_inputs ?? raw.publicInputs, 'public_inputs'),
    expected_prover_inputs_hash: raw.expected_prover_inputs_hash
      ? coerceHex(raw.expected_prover_inputs_hash, 'expected_prover_inputs_hash')
      : undefined,
  };
}

async function assertSunspotArtifacts(): Promise<void> {
  for (const artifactPath of [CCS_PATH, PK_PATH, VK_PATH]) {
    try {
      await fs.access(artifactPath);
    } catch {
      throw new Error(
        `Missing Groth16 artifact at ${artifactPath}. Rebuild the circuit and run Sunspot setup before starting the prover server.`,
      );
    }
  }
}

async function createProofJobDir(jobId: string): Promise<{
  jobDir: string;
  baseName: string;
  proofPath: string;
  publicWitnessPath: string;
}> {
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), `solvus-groth16-${jobId}-`));
  const baseName = `solvus-${jobId}`;
  const acirPath = path.join(jobDir, `${baseName}.json`);
  const ccsPath = path.join(jobDir, `${baseName}.ccs`);
  const pkPath = path.join(jobDir, `${baseName}.pk`);
  const vkPath = path.join(jobDir, `${baseName}.vk`);

  await Promise.all([
    fs.copyFile(path.join(TARGET_DIR, 'solvus.json'), acirPath),
    fs.copyFile(CCS_PATH, ccsPath),
    fs.copyFile(PK_PATH, pkPath),
    fs.copyFile(VK_PATH, vkPath),
  ]);

  return {
    jobDir,
    baseName,
    proofPath: path.join(jobDir, `${baseName}.proof`),
    publicWitnessPath: path.join(jobDir, `${baseName}.pw`),
  };
}

async function generateSunspotProofBundle(inputs: ProverInputs): Promise<Groth16ProofBundle> {
  await assertSunspotArtifacts();

  const nargoBin = resolveNargoBin();
  const sunspotBin = resolveSunspotBin();
  const jobId = stableJsonHash(inputs).slice(2, 10);
  const proverName = `Prover-${jobId}`;
  const witnessName = `witness-${jobId}`;
  const proverTomlPath = path.join(CIRCUITS_DIR, `${proverName}.toml`);
  const witnessPath = path.join(TARGET_DIR, `${witnessName}.gz`);

  await fs.writeFile(proverTomlPath, serializeCircuitInputsToToml(inputs), 'utf8');

  const { jobDir, baseName, proofPath, publicWitnessPath } = await createProofJobDir(jobId);
  try {
    await runCommand(
      nargoBin,
      ['execute', witnessName, '--prover-name', proverName, '--package', 'solvus'],
      CIRCUITS_DIR,
      { PATH: `${path.dirname(nargoBin)}:${process.env.PATH || ''}` },
    );

    const jobWitnessPath = path.join(jobDir, `${baseName}.gz`);
    await fs.copyFile(witnessPath, jobWitnessPath);

    await runCommand(
      sunspotBin,
      [
        'prove',
        path.join(jobDir, `${baseName}.json`),
        jobWitnessPath,
        path.join(jobDir, `${baseName}.ccs`),
        path.join(jobDir, `${baseName}.pk`),
      ],
      jobDir,
    );

    await runCommand(
      sunspotBin,
      [
        'verify',
        path.join(jobDir, `${baseName}.vk`),
        proofPath,
        publicWitnessPath,
      ],
      jobDir,
    );

    adapterMode = 'sunspot';
    return {
      proof: normalizeHex((await fs.readFile(proofPath)).toString('hex')),
      public_inputs: normalizeHex((await fs.readFile(publicWitnessPath)).toString('hex')),
    };
  } finally {
    await Promise.allSettled([
      fs.rm(jobDir, { recursive: true, force: true }),
      fs.rm(proverTomlPath, { force: true }),
      fs.rm(witnessPath, { force: true }),
    ]);
  }
}

export function getGroth16AdapterMode(): Groth16AdapterMode {
  return adapterMode;
}

export function getDevnetMintProofMode(): Groth16AdapterMode {
  return adapterMode;
}

export async function generateGroth16ProofBundle(inputs: ProverInputs): Promise<Groth16ProofBundle> {
  const artifactPath = resolveArtifactPath();
  const verifierPublicInputs = serializeVerifierPublicInputs(inputs);

  if (artifactPath) {
    const artifact = await loadArtifactFromDisk(artifactPath);
    const proverInputsHash = stableJsonHash(inputs);

    if (
      artifact.expected_prover_inputs_hash &&
      artifact.expected_prover_inputs_hash !== proverInputsHash
    ) {
      throw new Error(
        `Groth16 artifact prover_inputs hash mismatch: expected ${artifact.expected_prover_inputs_hash}, got ${proverInputsHash}`,
      );
    }

    if (artifact.public_inputs !== verifierPublicInputs) {
      throw new Error(
        'Groth16 artifact public_inputs mismatch verifier witness format. Regenerate the artifact or remove SOLVUS_GROTH16_PROOF_PATH.',
      );
    }

    adapterMode = 'artifact';
    return artifact;
  }

  return generateSunspotProofBundle(inputs);
}

export async function generateDevnetMintProofBundle(
  inputs: ProverInputs,
): Promise<Groth16ProofBundle> {
  return generateGroth16ProofBundle(inputs);
}
