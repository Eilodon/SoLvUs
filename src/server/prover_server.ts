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

const app = express();
const PORT = process.env.PROVER_PORT || 3002;
const CIRCUITS_PATH = path.join(__dirname, '../../circuits');

app.use(cors());
app.use(bodyParser.json());

// Helper for Relayer Payloads
function u64ToBigEndian(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(value));
  return buf;
}

// Dummy BTC API
const xverseApi = {
  getBalance: async (address: string) => ({ balance: 0 }),
  getUtxos: async (address: string) => [] as { block_time: number }[],
};

/**
 * BTC Data Fetcher
 */
async function getBtcData(btcAddress: string, badgeType: number): Promise<number> {
  if (badgeType === 1) { // Whale
    const { balance } = await xverseApi.getBalance(btcAddress);
    return balance;
  }
  if (badgeType === 2) { // Hodler
    const utxos = await xverseApi.getUtxos(btcAddress);
    if (utxos.length === 0) return 0;
    const oldest = utxos.reduce((min: number, u: any) => Math.min(min, u.block_time), Infinity);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.floor((nowSeconds - oldest) / 86400);
  }
  if (badgeType === 3) { // Stacker
    const utxos = await xverseApi.getUtxos(btcAddress);
    return utxos.length;
  }
  throw new Error(`Unknown badge_type: ${badgeType}`);
}

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

    const btc_data = await getBtcData(btcAddress, Number(badgeType));
    const timestamp = Math.floor(Date.now() / 1000);
    const pubkeyXBytes = Buffer.from(pubkeyX.replace('0x', ''), 'hex');

    // Payload: pubkey_x[32] + btc_data[8BE] + timestamp[8BE]
    const payload = Buffer.concat([
      pubkeyXBytes,
      u64ToBigEndian(btc_data),
      u64ToBigEndian(timestamp),
    ]);

    const relayer_sig = secp256k1
      .sign(sha256(payload), privateKey.replace('0x', ''))
      .toCompactRawBytes();

    res.json({
      success: true,
      btc_data,
      timestamp,
      relayer_sig: '0x' + Buffer.from(relayer_sig).toString('hex')
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
