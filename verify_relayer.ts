import dotenv from 'dotenv';
import path from 'path';
import { fetchRelayerData } from './packages/core/relayer/index';

dotenv.config();

async function run() {
  const pubkeyX = new Uint8Array(32).fill(1); 
  try {
    const r = await fetchRelayerData(pubkeyX, 'bc1qtest', 1);
    console.log('JSON_START');
    console.log(JSON.stringify(r, null, 2));
    console.log('JSON_END');
  } catch(e: any) {
    console.error('FAIL:', e.message);
  }
}
run();
