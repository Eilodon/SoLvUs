declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<any>;
  export function buildEddsa(): Promise<any>;
}
declare module 'sats-connect' {
  export function getPublicKey(options: { address: string }): Promise<{ publicKey: string }>;
  export function signMessage(options: { message: string; address: string }): Promise<{ signature: string }>;
}
