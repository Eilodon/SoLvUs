use dep::sha256;
use dep::poseidon;

fn main() {
    let msg: [u8; 1] = [0];
    let _h = sha256::sha256(msg);
    
    let fields: [Field; 4] = [1, 2, 3, 4];
    let _p = poseidon::bn254::hash_4(fields);
}
