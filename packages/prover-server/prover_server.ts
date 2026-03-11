import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import cors from 'cors';
import { exec } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { fetchRelayerData, u64ToBigEndian } from '../core/index';

const app = express();
const PORT = process.env.PROVER_PORT || 3002;
const CIRCUITS_PATH = path.join(__dirname, '../../circuits');

app.use(cors());
app.use(bodyParser.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/prove', async (req, res) => {
  req.setTimeout(180000);
  const uuid = randomUUID();
  const proverTomlPath = path.join(CIRCUITS_PATH, `${uuid}.toml`);
  const witnessPath = path.join(CIRCUITS_PATH, 'target', `${uuid}.gz`);

  try {
    const { inputs } = req.body;
    if (!inputs) return res.status(400).json({ error: 'Missing inputs' });
    writeFileSync(proverTomlPath, jsonToProverToml(inputs));
    const command = `nargo execute --prover-name ${uuid} ${uuid}`;
    await new Promise((resolve, reject) => {
      exec(command, { cwd: CIRCUITS_PATH, timeout: 60000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });
    const { Barretenberg, UltraHonkBackend, BackendType } = await (eval(`import('@aztec/bb.js')`) as Promise<any>);
    const circuitArtifact = JSON.parse(readFileSync(path.join(CIRCUITS_PATH, 'target/solvus.json'), 'utf8'));
    const compressedWitness = readFileSync(witnessPath);
    const api = await Barretenberg.new({ backend: BackendType.Wasm });
    const backend = new UltraHonkBackend(circuitArtifact.bytecode, api);
    const proofData = await backend.generateProof(compressedWitness);
    res.json({
      success: true,
      proof: '0x' + Buffer.from(proofData.proof).toString('hex'),
      publicInputs: proofData.publicInputs.map((pi: Uint8Array) => '0x' + Buffer.from(pi).toString('hex')),
      id: uuid
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (existsSync(proverTomlPath)) unlinkSync(proverTomlPath);
    if (existsSync(witnessPath)) unlinkSync(witnessPath);
  }
});

/**
 * POST /sign
 * Fully self-contained relayer signing logic.
 */
app.post('/sign', async (req, res) => {
  try {
    const { pubkeyX, btcAddress, badgeType } = req.body;
    if (!pubkeyX || !btcAddress || !badgeType) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    if (!privateKey) throw new Error('RELAYER_PRIVATE_KEY is missing in env');

    console.log(`[Relayer] Signing data for BTC Address: ${btcAddress}, Badge Type: ${badgeType}`);

    const relayerResponse = await fetchRelayerData(
      Buffer.from(pubkeyX.replace('0x', ''), 'hex'),
      btcAddress,
      Number(badgeType),
      privateKey
    );

    res.json({
      success: true,
      btc_data: relayerResponse.btc_data,
      timestamp: relayerResponse.timestamp,
      relayer_sig: '0x' + Buffer.from(relayerResponse.relayer_sig).toString('hex')
    });
  } catch (error: any) {
    console.error('[Relayer] Signing failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

function jsonToProverToml(inputs: Record<string, any>): string {
  let toml = '';
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) toml += `${key} = [${value.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ')}]\n`;
    else if (typeof value === 'boolean' || typeof value === 'number') toml += `${key} = ${value}\n`;
    else toml += `${key} = "${value}"\n`;
  }
  return toml;
}

app.listen(PORT, () => {
  console.log(`🚀 Solvus Prover Server running on port ${PORT}`);
});
