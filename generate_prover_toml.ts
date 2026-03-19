import dotenv from 'dotenv';
import { fetchRelayerData } from './packages/core/relayer/index';
import { buildProverInputs } from './packages/core/prover/inputs';

dotenv.config();

async function run() {
  const pubkeyXBytes = new Uint8Array(32).fill(1).map((_, i) => i + 1); // [1, 2, ..., 32] as in Prover.toml line 10
  const pubkeyYBytes = new Uint8Array(32).fill(0);
  const userSig = new Uint8Array(64).fill(0);
  
  try {
    const relayerResponse = await fetchRelayerData(pubkeyXBytes, 'bc1qtest', 1);
    
    const inputs = await buildProverInputs({
      pubkeyXBytes,
      pubkeyYBytes,
      userSig,
      relayerResponse,
      nullifierSecretHex: '0x123',
      starknetAddress: '0x0',
      nonce: 0n,
      badgeType: 1,
      tier: 1
    });

    let toml = '';
    for (const [key, value] of Object.entries(inputs)) {
      if (Array.isArray(value)) {
        toml += `${key} = [${value.join(', ')}]\n`;
      } else if (typeof value === 'boolean') {
        toml += `${key} = ${value}\n`;
      } else if (typeof value === 'number') {
        toml += `${key} = ${value}\n`;
      } else {
        toml += `${key} = "${value}"\n`;
      }
    }
    console.log(toml);
  } catch(e: any) {
    console.error('FAIL:', e.message);
  }
}
run();
