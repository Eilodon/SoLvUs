import { Account, ArraySignatureType, CallData, Contract, RpcProvider, ec, hash, num } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const provider = new RpcProvider({ 
    nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/oD44xOXHjcJW3bAkmHW9C',
    specVersion: '0.7'
});

async function deploy() {
    console.log('🚀 Starting Solvus Deployment on Sepolia...');

    const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS!;
    const privateKey = process.env.STARKNET_PRIVATE_KEY!;
    const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY!;
    
    if (!accountAddress || !privateKey || !relayerPrivateKey) {
        throw new Error('Missing STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY, or RELAYER_PRIVATE_KEY in .env');
    }

    const account = new Account(provider, accountAddress, privateKey);

    // 1. Load compiled artifacts
    const sierraPath = path.join(__dirname, '../target/dev/solvus_SolvusBadge.contract_class.json');
    const casmPath = path.join(__dirname, '../target/dev/solvus_SolvusBadge.compiled_contract_class.json');

    if (!fs.existsSync(sierraPath) || !fs.existsSync(casmPath)) {
        throw new Error('Artifacts not found. Please run "scarb build" in cairo directory first.');
    }

    const sierra = JSON.parse(fs.readFileSync(sierraPath, 'utf8'));
    const casm = JSON.parse(fs.readFileSync(casmPath, 'utf8'));

    // 2. Derive Relayer Pubkey (X, Y)
    // Relayer uses a standard ECDSA key for signing BTC data attestations.
    const relayerPoint = ec.starkCurve.ProjectivePoint.fromPrivateKey(relayerPrivateKey);
    const relayerPubkeyX = num.toHex(relayerPoint.x);
    const relayerPubkeyY = num.toHex(relayerPoint.y);

    console.log('Relayer Pubkey X:', relayerPubkeyX);
    console.log('Relayer Pubkey Y:', relayerPubkeyY);

    // 3. Declare contract
    console.log('⏳ Declaring contract...');
    const declareResponse = await account.declare({ contract: sierra, casm: casm });
    console.log('✅ Class Hash:', declareResponse.class_hash);
    await provider.waitForTransaction(declareResponse.transaction_hash);

    // 4. Deploy instance
    // Constructor args: garaga_verifier_address, relayer_pubkey_x, relayer_pubkey_y
    // NOTE: Replace placeholder with actual Garaga verifier on Sepolia
    const garagaVerifier = process.env.GARAGA_VERIFIER_ADDRESS || '0x0000000000000000000000000000000000000000000000000000000000000000'; 
    
    console.log('⏳ Deploying contract...');
    const deployResponse = await account.deployContract({
        classHash: declareResponse.class_hash,
        constructorCalldata: CallData.compile([
            garagaVerifier,
            relayerPubkeyX,
            relayerPubkeyY
        ]),
        salt: '0x1234'
    });
    const transaction_hash = deployResponse.transaction_hash;
    const contract_address = deployResponse.contract_address;
    
    console.log('✅ Contract Address:', contract_address);
    console.log('⏳ Waiting for confirmation...');
    await provider.waitForTransaction(transaction_hash);

    // 5. Save deployment info
    const deployment = {
        network: 'sepolia',
        contract_address: contract_address,
        class_hash: declareResponse.class_hash,
        deploy_tx: transaction_hash,
        deployed_at: new Date().toISOString(),
        garaga_verifier: garagaVerifier,
        relayer_pubkey_x: relayerPubkeyX,
        relayer_pubkey_y: relayerPubkeyY
    };

    fs.writeFileSync(path.join(__dirname, '../deployment.json'), JSON.stringify(deployment, null, 2));
    console.log('🎉 Deployment Complete! Info saved to cairo/deployment.json');
}

deploy().catch(console.error);
