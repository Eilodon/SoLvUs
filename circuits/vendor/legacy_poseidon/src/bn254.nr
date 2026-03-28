pub mod perm;
pub mod consts;

#[no_predicates]
pub fn hash_4(input: [Field; 4]) -> Field {
    let mut state = [0; 5];
    for i in 0..input.len() {
        state[i + 1] = input[i];
    }

    perm::x5_5(state)[0]
}
