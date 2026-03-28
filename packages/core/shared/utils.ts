import { createHash } from 'crypto';
import { buildPoseidon } from 'circomlibjs';
import { BN254_PRIME, Hex } from '../contracts';

interface Poseidon {
  (inputs: bigint[]): bigint;
  F: {
    toObject(value: unknown): bigint;
  };
}

let poseidonInstance: Poseidon | null = null;

async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonInstance) {
    poseidonInstance = (await buildPoseidon()) as Poseidon;
  }
  return poseidonInstance;
}

export function normalizeHex(value: string): Hex {
  const normalized = value.startsWith('0x') ? value.toLowerCase() : `0x${value.toLowerCase()}`;
  if (!/^0x[0-9a-f]*$/.test(normalized)) {
    throw new Error(`Invalid hex string: ${value}`);
  }
  return normalized as Hex;
}

export function validateBytesLength(value: string, byteLength: number, fieldName: string): void {
  const normalized = normalizeHex(value);
  const actualBytes = (normalized.length - 2) / 2;
  if (actualBytes !== byteLength) {
    throw new Error(`Invalid ${fieldName} length: expected ${byteLength} bytes, got ${actualBytes}`);
  }
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = normalizeHex(value);
  return Uint8Array.from(Buffer.from(normalized.slice(2), 'hex'));
}

export function bytesToHex(value: Uint8Array): Hex {
  return `0x${Buffer.from(value).toString('hex')}` as Hex;
}

export function toHex64(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

export function fieldToHex32(value: bigint): Hex {
  const reduced = ((value % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
  return `0x${reduced.toString(16).padStart(64, '0')}` as Hex;
}

export function fieldToBytes32BE(value: bigint): Uint8Array {
  return hexToBytes(fieldToHex32(value));
}

export function bytes32BEToField(value: string | Uint8Array): bigint {
  const bytes = typeof value === 'string' ? hexToBytes(value) : value;
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  }
  const raw = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  return ((raw % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
}

export function u64ToBigEndian(value: number | bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

export function sha256Hex(value: string | Uint8Array): Hex {
  const hash = createHash('sha256');
  if (typeof value === 'string') {
    hash.update(value);
  } else {
    hash.update(Buffer.from(value));
  }
  return `0x${hash.digest('hex')}` as Hex;
}

export function stableJsonHash(value: unknown): Hex {
  return sha256Hex(JSON.stringify(value, Object.keys(value as object).sort()));
}

export function stripRecoveryByte(sigBase64: string): Uint8Array {
  const sigBytes = Buffer.from(sigBase64, 'base64');
  if (sigBytes.length !== 65) {
    throw new Error(`Expected 65 bytes, got ${sigBytes.length}`);
  }

  const recoveryByte = sigBytes[0];
  if (recoveryByte === 0x30) {
    throw new Error('DER signatures are not supported. Expected a compact signature with recovery byte.');
  }
  if (recoveryByte < 27 || recoveryByte > 34) {
    throw new Error(`Invalid recovery byte: ${recoveryByte}. Expected [27-34].`);
  }

  return new Uint8Array(sigBytes.slice(1));
}

export async function poseidonHash(fields: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  return poseidon.F.toObject(poseidon(fields)) as bigint;
}

export function splitBytes32To128BitFields(value: string | Uint8Array): [bigint, bigint] {
  const bytes = typeof value === 'string' ? hexToBytes(value) : value;
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  }

  const hi = BigInt(`0x${Buffer.from(bytes.slice(0, 16)).toString('hex')}`);
  const lo = BigInt(`0x${Buffer.from(bytes.slice(16, 32)).toString('hex')}`);
  return [hi, lo];
}

export function validateBitcoinAddress(address: string): void {
  const isValid =
    /^(bc1|tb1|bcrt1)[0-9ac-hj-np-z]{11,87}$/i.test(address) ||
    /^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);

  if (!isValid) {
    throw new Error(`Invalid Bitcoin address: ${address}`);
  }
}

export function hexToTomlByteArray(value: string): string {
  return `[${Array.from(hexToBytes(value)).join(', ')}]`;
}
