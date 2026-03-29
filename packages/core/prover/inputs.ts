import { BadgeType, getThresholdForBadge, Hex, ProverInputs, RelayerResponse } from '../contracts';
import {
  bytes32BEToField,
  bytesToHex,
  fieldToHex32,
  hexToBigInt,
  hexToTomlByteArray,
  hexToBytes,
  poseidonHash,
  sha256Hex,
  splitBytes32To128BitFields,
  validateBytesLength,
  validateFieldElementHex,
} from '../shared/utils';

export const GROTH16_PUBLIC_INPUT_FIELD_COUNT = 10;
export const GROTH16_PUBLIC_INPUT_FIELD_BYTES = 32;
export const GROTH16_PUBLIC_INPUTS_TOTAL_BYTES =
  GROTH16_PUBLIC_INPUT_FIELD_COUNT * GROTH16_PUBLIC_INPUT_FIELD_BYTES;
export const GROTH16_VERIFIER_PUBLIC_INPUT_COUNT = 69;
export const GROTH16_VERIFIER_PUBLIC_INPUT_HEADER_BYTES = 12;
export const GROTH16_VERIFIER_PUBLIC_INPUTS_TOTAL_BYTES =
  GROTH16_VERIFIER_PUBLIC_INPUT_HEADER_BYTES +
  GROTH16_VERIFIER_PUBLIC_INPUT_COUNT * GROTH16_PUBLIC_INPUT_FIELD_BYTES;

export interface BuildProverInputsParams {
  user_pubkey_x: Hex;
  user_pubkey_y: Hex;
  user_sig: Hex;
  relayer_response: RelayerResponse;
  solana_address: Hex;
  badge_type: BadgeType;
  nullifier_secret: Hex;
}

export async function computeNullifierHash(
  dlcContractId: Hex,
  badgeType: BadgeType,
  nullifierSecret: Hex,
): Promise<Hex> {
  validateBytesLength(dlcContractId, 32, 'dlc_contract_id');
  validateBytesLength(nullifierSecret, 32, 'nullifier_secret');
  const dlcBigInt = bytes32BEToField(dlcContractId);
  const secretBigInt = bytes32BEToField(nullifierSecret);
  const hash = await poseidonHash([
    dlcBigInt,
    BigInt(badgeType),
    secretBigInt,
    0n,
  ]);
  return fieldToHex32(hash);
}

export async function buildProverInputs(params: BuildProverInputsParams): Promise<ProverInputs> {
  validateBytesLength(params.user_pubkey_x, 32, 'pubkey_x');
  validateBytesLength(params.user_pubkey_y, 32, 'pubkey_y');
  validateBytesLength(params.user_sig, 64, 'user_sig');
  validateBytesLength(params.relayer_response.signature, 64, 'relayer_sig');
  validateBytesLength(params.relayer_response.pubkey_x, 32, 'relayer_pubkey_x');
  validateBytesLength(params.relayer_response.pubkey_y, 32, 'relayer_pubkey_y');
  validateBytesLength(params.solana_address, 32, 'solana_address');
  validateFieldElementHex(params.relayer_response.dlc_contract_id, 'dlc_contract_id');
  validateFieldElementHex(params.nullifier_secret, 'nullifier_secret');

  const nullifier_hash = await computeNullifierHash(
    params.relayer_response.dlc_contract_id,
    params.badge_type,
    params.nullifier_secret,
  );

  return {
    dlc_contract_id: params.relayer_response.dlc_contract_id,
    nullifier_secret: params.nullifier_secret,
    pubkey_x: params.user_pubkey_x,
    pubkey_y: params.user_pubkey_y,
    user_sig: params.user_sig,
    btc_data: params.relayer_response.btc_data,
    relayer_sig: params.relayer_response.signature,
    solana_address: params.solana_address,
    relayer_pubkey_x: params.relayer_response.pubkey_x,
    relayer_pubkey_y: params.relayer_response.pubkey_y,
    badge_type: params.badge_type,
    threshold: getThresholdForBadge(params.badge_type),
    is_upper_bound: false,
    nullifier_hash,
  };
}

export function collectPublicInputs(inputs: ProverInputs): Hex[] {
  return [
    inputs.solana_address,
    inputs.dlc_contract_id,
    inputs.relayer_pubkey_x,
    inputs.relayer_pubkey_y,
    fieldToHex32(BigInt(inputs.badge_type)),
    fieldToHex32(BigInt(inputs.threshold)),
    fieldToHex32(inputs.is_upper_bound ? 1n : 0n),
    inputs.nullifier_hash,
  ];
}

export function serializePublicInputs(inputs: ProverInputs): Hex {
  const fields = collectPublicInputs(inputs);
  const bytes = Buffer.concat(
    fields.map((field, index) => {
      validateBytesLength(field, GROTH16_PUBLIC_INPUT_FIELD_BYTES, `public_inputs[${index}]`);
      return Buffer.from(hexToBytes(field));
    }),
  );

  if (bytes.length !== GROTH16_PUBLIC_INPUTS_TOTAL_BYTES) {
    throw new Error(
      `Invalid canonical public_inputs length: expected ${GROTH16_PUBLIC_INPUTS_TOTAL_BYTES} bytes, got ${bytes.length}`,
    );
  }

  return bytesToHex(bytes);
}

export function deserializePublicInputs(serialized: Hex): Hex[] {
  validateBytesLength(serialized, GROTH16_PUBLIC_INPUTS_TOTAL_BYTES, 'public_inputs');
  const bytes = hexToBytes(serialized);
  const fields: Hex[] = [];

  for (let offset = 0; offset < bytes.length; offset += GROTH16_PUBLIC_INPUT_FIELD_BYTES) {
    fields.push(bytesToHex(bytes.slice(offset, offset + GROTH16_PUBLIC_INPUT_FIELD_BYTES)));
  }

  return fields;
}

function encodeVerifierWitnessHeader(publicInputCount: number): Buffer {
  const header = Buffer.alloc(GROTH16_VERIFIER_PUBLIC_INPUT_HEADER_BYTES);
  header.writeUInt32BE(publicInputCount, 0);
  header.writeUInt32BE(0, 4);
  header.writeUInt32BE(publicInputCount, 8);
  return header;
}

export function collectVerifierPublicInputs(inputs: ProverInputs): Hex[] {
  const solanaAddressBytes = hexToBytes(inputs.solana_address);
  const relayerBytesX = hexToBytes(inputs.relayer_pubkey_x);
  const relayerBytesY = hexToBytes(inputs.relayer_pubkey_y);
  const fields: Hex[] = [];

  // Field 0: sol_hi - first 16 bytes of solana_address as Field (big-endian)
  let solHi = 0n;
  for (let i = 0; i < 16; i++) {
    solHi = solHi * 256n + BigInt(solanaAddressBytes[i]);
  }
  fields.push(fieldToHex32(solHi));

  // Field 1: sol_lo - last 16 bytes of solana_address as Field (big-endian)
  let solLo = 0n;
  for (let i = 16; i < 32; i++) {
    solLo = solLo * 256n + BigInt(solanaAddressBytes[i]);
  }
  fields.push(fieldToHex32(solLo));

  // Fields 2-33: relayer_pubkey_x - 32 bytes as 32 Fields (1 byte per field)
  for (let i = 0; i < 32; i++) {
    fields.push(fieldToHex32(BigInt(relayerBytesX[i])));
  }

  // Fields 34-65: relayer_pubkey_y - 32 bytes as 32 Fields (1 byte per field)
  for (let i = 0; i < 32; i++) {
    fields.push(fieldToHex32(BigInt(relayerBytesY[i])));
  }

  // Field 66: dlc_contract_id - 32 bytes as single Field
  fields.push(fieldToHex32(hexToBigInt(inputs.dlc_contract_id)));

  // Field 67: nullifier_hash - already a 32-byte hex string
  fields.push(inputs.nullifier_hash);

  // Field 68: btc_data - already a number, convert to Field
  fields.push(fieldToHex32(BigInt(inputs.btc_data)));

  return fields;
}

export function serializeVerifierPublicInputs(inputs: ProverInputs): Hex {
  const fields = collectVerifierPublicInputs(inputs);
  const bytes = Buffer.concat([
    encodeVerifierWitnessHeader(fields.length),
    ...fields.map((field, index) => {
      validateBytesLength(field, GROTH16_PUBLIC_INPUT_FIELD_BYTES, `verifier_public_inputs[${index}]`);
      return Buffer.from(hexToBytes(field));
    }),
  ]);

  if (bytes.length !== GROTH16_VERIFIER_PUBLIC_INPUTS_TOTAL_BYTES) {
    throw new Error(
      `Invalid Groth16 verifier public_inputs length: expected ${GROTH16_VERIFIER_PUBLIC_INPUTS_TOTAL_BYTES} bytes, got ${bytes.length}`,
    );
  }

  return bytesToHex(bytes);
}

export function serializeCircuitInputsToToml(inputs: ProverInputs): string {
  const [solHi, solLo] = splitBytes32To128BitFields(inputs.solana_address);

  return [
    `solana_address = ${hexToTomlByteArray(inputs.solana_address)}`,
    `sol_hi = "${fieldToHex32(solHi)}"`,
    `sol_lo = "${fieldToHex32(solLo)}"`,
    `relayer_pubkey_x = ${hexToTomlByteArray(inputs.relayer_pubkey_x)}`,
    `relayer_pubkey_y = ${hexToTomlByteArray(inputs.relayer_pubkey_y)}`,
    `badge_type = ${inputs.badge_type}`,
    `threshold = ${inputs.threshold}`,
    `is_upper_bound = ${inputs.is_upper_bound}`,
    `dlc_contract_id = "${inputs.dlc_contract_id}"`,
    `nullifier_secret = "${inputs.nullifier_secret}"`,
    `nullifier_hash = "${inputs.nullifier_hash}"`,
    `pubkey_x = ${hexToTomlByteArray(inputs.pubkey_x)}`,
    `pubkey_y = ${hexToTomlByteArray(inputs.pubkey_y)}`,
    `user_sig = ${hexToTomlByteArray(inputs.user_sig)}`,
    `btc_data = ${inputs.btc_data}`,
    `relayer_sig = ${hexToTomlByteArray(inputs.relayer_sig)}`,
    '',
  ].join('\n');
}

export function buildDeterministicScaffoldProof(
  inputs: ProverInputs,
  byteLength = 320,
): Hex {
  const publicInputs = serializePublicInputs(inputs);
  const publicInputBytes = Buffer.from(hexToBytes(publicInputs));
  const chunks: Buffer[] = [];

  for (let counter = 0; Buffer.concat(chunks).length < byteLength; counter += 1) {
    const counterBytes = Buffer.alloc(2);
    counterBytes.writeUInt16BE(counter);
    const chunk = sha256Hex(Buffer.concat([publicInputBytes, counterBytes]));
    chunks.push(Buffer.from(hexToBytes(chunk)));
  }

  return bytesToHex(Buffer.concat(chunks).subarray(0, byteLength));
}
