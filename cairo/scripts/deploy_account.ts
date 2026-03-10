import { Account, RpcProvider, CallData, Signer } from 'starknet';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Fix path to root .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

async function main() {
    const provider = new RpcProvider({
        nodeUrl: 'https://starknet-sepolia-rpc.publicnode.com'
    });

    const privateKey = process.env.STARKNET_PRIVATE_KEY!;
    // Derived from the private key in .env
    const accountAddress = '0x06ecf9c0599a33200b7a311096770d49e6302300d7bc9a45159e5706c5afc207';
    const publicKey = '0x51356d7a3ab20cf57580965f909451c649d5a3017aa33fddaa90ee6b4d1f2da';

    const signer = new Signer(privateKey);
    const account = new Account(provider, accountAddress, signer);

    console.log('⏳ Deploying account with STRK fee (V3)...');
    
    const { transaction_hash, contract_address } = await account.deployAccount({
        classHash: '0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564',
        constructorCalldata: CallData.compile({ publicKey }),
        addressSalt: '0x40b665226fadb8efe63a7f35d01e464cc5bd296ef0f7cbb8c9c5726f0aa58eb',
    }, { version: 3 });

    console.log('TX hash:', transaction_hash);
    console.log('Contract address:', contract_address);
    await provider.waitForTransaction(transaction_hash);
    console.log('✅ Account deployed!');
}

main().catch(console.error);
