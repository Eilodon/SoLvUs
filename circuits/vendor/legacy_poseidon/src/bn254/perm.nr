use crate::bn254::consts;
use crate::permute;

#[field(bn254)]
pub fn x5_5(mut state: [Field; 5]) -> [Field; 5] {
    state = permute(consts::x5_5_config(), state);
    state
}
