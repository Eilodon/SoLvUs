use garaga::definitions::{G1Point, G2Line, u288, u384};
use garaga::utils::noir::HonkVk;

// Generated from circuits/target/vk
// _vk_hash = keccak256(vk_bytes)
// vk_hash = hades_permutation(_vk_hash.low, _vk_hash.high, 2)
pub const VK_HASH: felt252 = 0xaeec503de80897f459a1c66b5dd3b0e6c962015397315bcdb225cad2386393;

pub const vk: HonkVk = HonkVk {
    circuit_size: 17,
    log_circuit_size: 23,
    public_inputs_size: 1,
    public_inputs_offset: 21744860038808601628388117079301267217560386821777671499920808337139536293994,
