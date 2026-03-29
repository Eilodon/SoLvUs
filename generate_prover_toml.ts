import { writeFileSync } from 'fs';
import path from 'path';
import { createDevMintFixture, serializeCircuitInputsToToml } from './packages/core';

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
    : serializeCircuitInputsToToml(fixture.prover_inputs);

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
