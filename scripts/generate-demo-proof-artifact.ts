import { promises as fs } from 'fs';
import path from 'path';

import { PublicKey } from '@solana/web3.js';

import {
  createDevMintFixture,
  createDynamicDevMintFixture,
  DEV_SOLANA_ADDRESS,
  hexToBytes,
  serializeVerifierPublicInputs,
  stableJsonHash,
} from '../packages/core';
import { generateDevnetMintProofBundle } from '../packages/prover-server/groth16_adapter';

function parseCountArg(): number {
  const arg = process.argv.find((value) => value.startsWith('--count='));
  const count = arg ? Number.parseInt(arg.slice('--count='.length), 10) : 1;
  return Number.isInteger(count) && count > 0 ? count : 1;
}

async function main(): Promise<void> {
  process.env.SOLVUS_GROTH16_PROOF_PATH = '';

  const count = parseCountArg();
  const outputDir = path.join(process.cwd(), 'config', 'demo-proof-artifacts');
  await fs.mkdir(outputDir, { recursive: true });

  for (let index = 0; index < count; index += 1) {
    const fixture = index === 0
      ? await createDevMintFixture()
      : await createDynamicDevMintFixture({ solana_address: DEV_SOLANA_ADDRESS });
    const bundle = await generateDevnetMintProofBundle(fixture.prover_inputs);
    const ownerPubkey = new PublicKey(Buffer.from(hexToBytes(fixture.solana_address))).toBase58();
    const outputPath = count === 1 && index === 0
      ? path.join(process.cwd(), 'config/demo-proof-artifact.json')
      : path.join(outputDir, `artifact-${String(index + 1).padStart(2, '0')}.json`);

    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          proof: bundle.proof,
          public_inputs: bundle.public_inputs,
          expected_prover_inputs_hash: stableJsonHash(fixture.prover_inputs),
          verifier_public_inputs: serializeVerifierPublicInputs(fixture.prover_inputs),
          prover_inputs: fixture.prover_inputs,
          metadata: {
            demo_owner_pubkey: ownerPubkey,
            generated_at: new Date().toISOString(),
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    console.log(`Demo owner pubkey: ${ownerPubkey}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
