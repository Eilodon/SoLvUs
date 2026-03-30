import { chmod, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const workspaceRoot = process.cwd();
const runtimeSecretsDir = path.join(workspaceRoot, '.runtime-secrets');
const runtimeBinDir = path.join(runtimeSecretsDir, 'bin');
const circuitsTargetDir = path.join(workspaceRoot, 'circuits', 'target');
const volumeArtifactsDir = process.env.SOLVUS_ARTIFACTS_DIR?.trim() || '/app/data/solvus-artifacts';

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeBase64File(filePath, base64Value, mode) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, Buffer.from(base64Value, 'base64'));
  if (mode) {
    await chmod(filePath, mode);
  }
}

async function writeTextFile(filePath, value, mode) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, value, 'utf8');
  if (mode) {
    await chmod(filePath, mode);
  }
}

async function copyFile(sourcePath, destinationPath) {
  await ensureDir(path.dirname(destinationPath));
  await runCommand('cp', [sourcePath, destinationPath]);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
    });
    child.on('error', reject);
  });
}

async function materializeRuntimeInputs(env) {
  await ensureDir(runtimeSecretsDir);
  await ensureDir(circuitsTargetDir);

  if (volumeArtifactsDir) {
    await ensureDir(volumeArtifactsDir);
  }

  if (!env.SOLANA_WALLET) {
    if (env.SOLANA_WALLET_JSON) {
      const walletPath = path.join(runtimeSecretsDir, 'solana-wallet.json');
      await writeTextFile(walletPath, `${env.SOLANA_WALLET_JSON.trim()}\n`);
      env.SOLANA_WALLET = walletPath;
      console.log(`Materialized SOLANA_WALLET_JSON to ${walletPath}`);
    } else if (env.SOLANA_WALLET_B64) {
      const walletPath = path.join(runtimeSecretsDir, 'solana-wallet.json');
      await writeBase64File(walletPath, env.SOLANA_WALLET_B64.trim());
      env.SOLANA_WALLET = walletPath;
      console.log(`Materialized SOLANA_WALLET_B64 to ${walletPath}`);
    }
  }

  const circuitArtifacts = [
    ['SOLVUS_CIRCUIT_JSON_B64', 'solvus.json'],
    ['SOLVUS_GROTH16_CCS_B64', 'solvus.ccs'],
    ['SOLVUS_GROTH16_PK_B64', 'solvus.pk'],
    ['SOLVUS_GROTH16_VK_B64', 'solvus.vk'],
  ];

  const requiredCircuitFiles = ['solvus.json', 'solvus.ccs', 'solvus.pk', 'solvus.vk'];

  for (const fileName of requiredCircuitFiles) {
    const volumePath = path.join(volumeArtifactsDir, fileName);
    const targetPath = path.join(circuitsTargetDir, fileName);
    if (existsSync(volumePath) && !existsSync(targetPath)) {
      await copyFile(volumePath, targetPath);
      console.log(`Copied ${fileName} from volume ${volumePath} to ${targetPath}`);
    }
  }

  for (const [envName, fileName] of circuitArtifacts) {
    const value = env[envName]?.trim();
    if (!value) {
      continue;
    }
    const filePath = path.join(circuitsTargetDir, fileName);
    await writeBase64File(filePath, value);
    if (volumeArtifactsDir) {
      await copyFile(filePath, path.join(volumeArtifactsDir, fileName));
    }
    console.log(`Materialized ${envName} to ${filePath}`);
  }

  const artifactDownloads = [
    ['SOLVUS_CIRCUIT_JSON_URL', 'solvus.json'],
    ['SOLVUS_GROTH16_CCS_URL', 'solvus.ccs'],
    ['SOLVUS_GROTH16_PK_URL', 'solvus.pk'],
    ['SOLVUS_GROTH16_VK_URL', 'solvus.vk'],
  ];

  for (const [envName, fileName] of artifactDownloads) {
    const url = env[envName]?.trim();
    if (!url) {
      continue;
    }
    const filePath = path.join(circuitsTargetDir, fileName);
    if (existsSync(filePath)) {
      continue;
    }
    await ensureDir(path.dirname(filePath));
    await runCommand('wget', ['-q', '-O', filePath, url]);
    if (volumeArtifactsDir) {
      await copyFile(filePath, path.join(volumeArtifactsDir, fileName));
    }
    console.log(`Downloaded ${envName} to ${filePath}`);
  }

  const runtimeBinaries = [
    ['NARGO_BIN_B64', 'nargo', 'NARGO_BIN'],
    ['SUNSPOT_BIN_B64', 'sunspot', 'SUNSPOT_BIN'],
  ];

  for (const [sourceEnv, fileName, targetEnv] of runtimeBinaries) {
    const value = env[sourceEnv]?.trim();
    if (!value) {
      continue;
    }
    const binaryPath = path.join(runtimeBinDir, fileName);
    await writeBase64File(binaryPath, value, 0o755);
    env[targetEnv] = binaryPath;
    console.log(`Materialized ${sourceEnv} to ${binaryPath}`);
  }
}

async function main() {
  const env = { ...process.env };
  await materializeRuntimeInputs(env);

  const child = spawn('npm', ['run', 'server'], {
    cwd: workspaceRoot,
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error('Railway bootstrap failed:', error);
  process.exit(1);
});
