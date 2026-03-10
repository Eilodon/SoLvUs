import { Account, Contract, ec, json, RpcProvider, stark } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-sepolia.public.blastapi.io' });

  const privateKey = process.env.STARKNET_PRIVATE_KEY || '';
  const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS || '';

  if (!privateKey || !accountAddress) {
    console.error('Missing STARKNET_PRIVATE_KEY or STARKNET_ACCOUNT_ADDRESS in .env');
    return;
  }

  const account = new Account(provider, accountAddress, privateKey);
  console.log('Account connected:', accountAddress);

  // Note: For this demo, we assume the contract is already compiled.
  // Usually, we'd use 'scarb build' to get the sierra/casm files.
  const SIERRA_PATH = path.join(__dirname, '../cairo/target/dev/solvus_protocol_SolvusBadge.contract_class.json');
  const CASM_PATH = path.join(__dirname, '../cairo/target/dev/solvus_protocol_SolvusBadge.compiled_contract_class.json');

  if (!fs.existsSync(SIERRA_PATH)) {
    console.error(`Sierra artifact not found at ${SIERRA_PATH}. Please run 'scarb build' first.`);
    return;
  }

  const sierraContent = json.parse(fs.readFileSync(SIERRA_PATH).toString('ascii'));
  const casmContent = json.parse(fs.readFileSync(CASM_PATH).toString('ascii'));

  console.log('Declaring and Deploying SolvusBadge...');
  
  // Deployment parameters (constructor)
  // Storage initialization: garaga_verifier, relayer_pubkey_x, relayer_pubkey_y
  const garagaVerifier = process.env.GARAGA_VERIFIER_ADDRESS || '0x0000000000000000000000000000000000000000'; // Placeholder
  const relayerPubkeyX = BigInt(process.env.RELAYER_PUBKEY_X || '0');
  const relayerPubkeyY = BigInt(process.env.RELAYER_PUBKEY_Y || '0');

  const deployResponse = await account.declareAndDeploy({
    contract: sierraContent,
    casm: casmContent,
    constructorCalldata: [garagaVerifier, relayerPubkeyX, relayerPubkeyY],
  });

  console.log('Deployment successful!');
  console.log('Contract Address:', deployResponse.deploy.contract_address);
  console.log('Transaction Hash:', deployResponse.deploy.transaction_hash);

  // Save to config for UI to use
  const configPath = path.join(__dirname, '../src/config/contract_addresses.json');
  const config = {
    solvusBadge: deployResponse.deploy.contract_address,
    network: 'sepolia'
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Config saved to ${configPath}`);
}

main().catch(console.error);
