import { writeFileSync } from 'fs';
import path from 'path';
import { createDevMintFixture, hexToTomlByteArray } from './packages/core';

function proverInputsToToml(inputs: Record<string, unknown>): string {
  const arrayFields = new Set([
    'solana_address',
    'relayer_pubkey_x',
    'relayer_pubkey_y',
    'pubkey_x',
    'pubkey_y',
    'user_sig',
    'relayer_sig',
  ]);

  let toml = '';
  for (const [key, value] of Object.entries(inputs)) {
    if (arrayFields.has(key)) {
      toml += `${key} = ${hexToTomlByteArray(value as string)}\n`;
      continue;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      toml += `${key} = ${value}\n`;
      continue;
    }
    toml += `${key} = "${value}"\n`;
  }
  return toml;
}

async function run() {
  const fixture = await createDevMintFixture();
  const asJson = process.argv.includes('--json');
  const outputArgIndex = process.argv.indexOf('--output');
  const outputPath =
    outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
      ? path.resolve(process.cwd(), process.argv[outputArgIndex + 1])
      : null;

  const body = asJson
    ? JSON.stringify({ prover_inputs: fixture.prover_inputs }, null, 2)
    : proverInputsToToml(fixture.prover_inputs as unknown as Record<string, unknown>);

  if (outputPath) {
    writeFileSync(outputPath, body);
    console.error(`Wrote sample prover inputs to ${outputPath}`);
    return;
  }

  console.log(body);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exit(1);
});
