import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { exec } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';

const app = express();
const PORT = process.env.PROVER_PORT || 3002;
const CIRCUITS_PATH = path.join(__dirname, '../../circuits');

app.use(cors());
app.use(bodyParser.json());

/**
 * Helper: Convert JSON inputs to Noir TOML format.
 */
function jsonToProverToml(inputs: Record<string, any>): string {
  let toml = '';
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      toml += `${key} = [${value.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ')}]\n`;
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      toml += `${key} = ${value}\n`;
    } else {
      toml += `${key} = "${value}"\n`;
    }
  }
  return toml;
}

/**
 * GET /health
 * Return system status
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

/**
 * POST /prove
 * Receives inputs, runs Noir 'nargo execute', and then 'bb.js' for proving.
 */
app.post('/prove', async (req, res) => {
  req.setTimeout(180000); // 3 minutes timeout for WASM proving
  
  const uuid = randomUUID();
  const proverTomlPath = path.join(CIRCUITS_PATH, `${uuid}.toml`);
  const witnessPath = path.join(CIRCUITS_PATH, 'target', `${uuid}.gz`);

  try {
    const { inputs } = req.body;
    if (!inputs) {
      return res.status(400).json({ error: 'Missing inputs in request body' });
    }

    console.log(`[Prover] Starting proof generation for ID: ${uuid}`);

    // 1. Write inputs to custom TOML file
    writeFileSync(proverTomlPath, jsonToProverToml(inputs));
    console.log(`[Prover] Wrote inputs to ${proverTomlPath}`);

    // 2. Execute nargo execute to generate witness
    console.log(`[Prover] Generating witness...`);
    const command = `nargo execute --prover-name ${uuid} ${uuid}`;
    
    await new Promise((resolve, reject) => {
      exec(command, { cwd: CIRCUITS_PATH, timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[Prover] Nargo execute error: ${stderr}`);
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      });
    });

    if (!existsSync(witnessPath)) {
      throw new Error(`Witness file not found at ${witnessPath}`);
    }

    // 3. Load bb.js and generate proof
    console.log(`[Prover] Loading bb.js and generating proof...`);
    // Dynamic import for ESM in CJS
    const { Barretenberg, UltraHonkBackend, BackendType } = await (eval(`import('@aztec/bb.js')`) as Promise<any>);
    
    const circuitArtifact = JSON.parse(readFileSync(path.join(CIRCUITS_PATH, 'target/solvus.json'), 'utf8'));
    const compressedWitness = readFileSync(witnessPath);
    
    console.log(`[Prover] Initializing Barretenberg with WASM backend...`);
    const api = await Barretenberg.new({ backend: BackendType.Wasm });
    const backend = new UltraHonkBackend(circuitArtifact.bytecode, api);
    
    const proofData = await backend.generateProof(compressedWitness);
    const proofHex = Buffer.from(proofData.proof).toString('hex');
    const publicInputs = proofData.publicInputs.map((pi: Uint8Array) => '0x' + Buffer.from(pi).toString('hex'));

    console.log(`[Prover] Proof generated successfully for ID: ${uuid}`);

    // 4. Return success
    res.json({
      success: true,
      proof: '0x' + proofHex,
      publicInputs,
      id: uuid
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Prover] Failed for ID ${uuid}:`, message);
    res.status(500).json({
      success: false,
      error: message
    });
  } finally {
    // 5. Cleanup temp files
    try {
      if (existsSync(proverTomlPath)) unlinkSync(proverTomlPath);
      if (existsSync(witnessPath)) unlinkSync(witnessPath);
      console.log(`[Prover] Cleaned up temporary files for ${uuid}`);
    } catch (cleanupError) {
      console.error('[Prover] Cleanup error:', cleanupError);
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Solvus Prover Server running on port ${PORT}`);
});
