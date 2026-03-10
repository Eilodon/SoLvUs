import { Account, RpcProvider, ec, CallData } from 'starknet';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const provider = new RpcProvider({ 
    nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/oD44xOXHjcJW3bAkmHW9C',
    specVersion: '0.7'
});

async function main() {
    const privateKey = process.env.STARKNET_PRIVATE_KEY!;
    const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS!;
    const account = new Account(provider, accountAddress, privateKey);

    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    console.log('Public key:', publicKey);
    console.log('Deploying account:', accountAddress);

    const { transaction_hash } = await account.deployAccount({
        classHash: '0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564',
        constructorCalldata: CallData.compile({ publicKey }),
        addressSalt: '0x40b665226fadb8efe63a7f35d01e464cc5bd296ef0f7cbb8c9c5726f0aa58eb',
    });

    console.log('TX hash:', transaction_hash);
    await provider.waitForTransaction(transaction_hash);
    console.log('Account deployed successfully!');
}

main().catch(console.error);
