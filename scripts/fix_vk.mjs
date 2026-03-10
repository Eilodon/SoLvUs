import { Barretenberg, UltraHonkBackend, BackendType } from '@aztec/bb.js';
import fs from 'fs';
import { Buffer } from 'buffer';

async function main() {
    try {
        console.log("Loading circuit artifact...");
        const artifact = JSON.parse(fs.readFileSync('circuits/target/solvus.json', 'utf8'));
        
        console.log("Initializing Barretenberg WASM (Forced)...");
        const bb = await Barretenberg.new({ backend: BackendType.Wasm });
        
        console.log("Creating UltraHonk backend...");
        // Pass the bb instance as the second argument (api)
        const backend = new UltraHonkBackend(artifact.bytecode, bb);
        
        console.log("Generating verification key (this may take a while)...");
        const vk = await backend.getVerificationKey();
        
        console.log("Writing VK to circuits/target/solvus.vk");
        fs.writeFileSync('circuits/target/solvus.vk', Buffer.from(vk));
        
        console.log("Success!");
        await bb.destroy();
    } catch (err) {
        console.error("Failed to generate VK:");
        console.error(err);
        process.exit(1);
    }
}

main();
