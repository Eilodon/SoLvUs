import { Account, CallData, RpcProvider, ec, num, Signer } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Use path.join to find the root .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const provider = new RpcProvider({ 
    nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-sepolia-rpc.publicnode.com'
});

async function deploy() {
    console.log('🚀 Starting Solvus Deployment on Sepolia...');

    const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS!;
    const privateKey = process.env.STARKNET_PRIVATE_KEY!;
    const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY!;
    
    if (!accountAddress || !privateKey || !relayerPrivateKey) {
        throw new Error('Missing STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY, or RELAYER_PRIVATE_KEY in .env');
    }

    console.log('Account Address:', accountAddress);
    console.log('Private Key length:', privateKey.length);
    console.log('Relayer Private Key length:', relayerPrivateKey.length);

    // Starknet.js v7 requires explicit Signer for Account
    const signer = new Signer(privateKey);
    const account = new Account(provider, accountAddress, signer);

    // 1. Load compiled artifacts
    const sierraPath = path.join(__dirname, '../target/dev/solvus_SolvusBadge.contract_class.json');
    const casmPath = path.join(__dirname, '../target/dev/solvus_SolvusBadge.compiled_contract_class.json');

    if (!fs.existsSync(sierraPath) || !fs.existsSync(casmPath)) {
        throw new Error('Artifacts not found. Please run "scarb build" in cairo directory first.');
    }

    const sierra = JSON.parse(fs.readFileSync(sierraPath, 'utf8'));
    const casm = JSON.parse(fs.readFileSync(casmPath, 'utf8'));

    // 2. Relayer keys are now BabyJubJub and hardcoded in the circuit. 
    // We no longer need to pass them to the Starknet contract constructor.


    // 3. Declare contract
    console.log('⏳ Declaring/Fetching contract class...');
    let classHash = '';
    const EXPECTED_COMPILED_HASH = '0x47cf6044efa69c8af0a2d0d203bf7acbb84d1563f4973be7a85c2485639b1b1';
    const KNOWN_SIERRA_HASH = '0x6dcc61b96b59d88676a51632c18fc2b9cc822eb8a542890089846832868f29b';

    try {
        const declareResponse = await account.declare({ 
            contract: sierra, 
            casm: casm,
            compiledClassHash: EXPECTED_COMPILED_HASH
        });
        classHash = declareResponse.class_hash;
        console.log('✅ Class Declared:', classHash);
        await provider.waitForTransaction(declareResponse.transaction_hash);
    } catch (e: any) {
        const errorStr = JSON.stringify(e);
        if (errorStr.includes('already declared')) {
            classHash = KNOWN_SIERRA_HASH;
            console.log('ℹ️ Class already declared:', classHash);
        } else if (errorStr.includes('Mismatch compiled class hash')) {
             // Extract Expected hash from error: "... Expected: 0x..."
             const match = errorStr.match(/Expected: (0x[a-fA-F0-9]+)/);
             if (match) {
                 console.log('⚠️ Hash Mismatch! Sequencer expects:', match[1]);
                 console.log('Please update EXPECTED_COMPILED_HASH and retry.');
                 throw new Error(`HASH_MISMATCH:${match[1]}`);
             }
             throw e;
        } else {
            throw e;
        }
    }

    // 4. Deploy instance
    // Constructor args: garaga_verifier_address, relayer_pubkey_x, relayer_pubkey_y
    const garagaVerifier = process.env.GARAGA_VERIFIER_ADDRESS || '0x0'; 
    
    console.log('⏳ Deploying contract...');
    const deployResponse = await account.deployContract({
        classHash: classHash,
        constructorCalldata: CallData.compile([
            garagaVerifier,
        ]),
        salt: '0x' + Math.floor(Math.random() * 1000000).toString(16)
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
        class_hash: classHash,
        deploy_tx: transaction_hash,
        deployed_at: new Date().toISOString(),
        garaga_verifier: garagaVerifier
    };

    fs.writeFileSync(path.join(__dirname, '../deployment.json'), JSON.stringify(deployment, null, 2));
    console.log('🎉 Deployment Complete! Info saved to cairo/deployment.json');
}

deploy().catch((e) => {
    console.error('❌ Deployment Failed!');
    console.error(JSON.stringify(e, null, 2));
    process.exit(1);
});
