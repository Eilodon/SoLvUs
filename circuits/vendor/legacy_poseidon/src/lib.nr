pub mod bn254;

pub struct PoseidonConfig<let T: u32, let N: u32, let X: u32> {
    t: Field,
    rf: u8,
    rp: u8,
    alpha: Field,
    round_constants: [Field; N],
    mds: [[Field; T]; T],
    presparse_mds: [[Field; T]; T],
    sparse_mds: [Field; X],
}

pub fn config<let T: u32, let N: u32, let X: u32>(
    t: Field,
    rf: u8,
    rp: u8,
    alpha: Field,
    round_constants: [Field; N],
    mds: [[Field; T]; T],
    presparse_mds: [[Field; T]; T],
    sparse_mds: [Field; X],
) -> PoseidonConfig<T, N, X> {
    assert_eq(rf & 1, 0);
    assert_eq((t as u8) * rf + rp, N as u8);
    assert_eq(t, T as Field);
    assert(alpha != 0);

    PoseidonConfig { t, rf, rp, alpha, round_constants, mds, presparse_mds, sparse_mds }
}

pub fn permute<let T: u32, let N: u32, let X: u32>(
    pos_conf: PoseidonConfig<T, N, X>,
    mut state: [Field; T],
) -> [Field; T] {
    let PoseidonConfig { t, rf, rp, alpha, round_constants, mds, presparse_mds, sparse_mds } =
        pos_conf;

    for i in 0..state.len() {
        state[i] += round_constants[i];
    }

    for r in 0..rf / 2 - 1 {
        state = sigma(state);
        for i in 0..T {
            state[i] += round_constants[T * (r as u32 + 1) + i];
        }
        state = apply_matrix(mds, state);
    }

    state = sigma(state);
    for i in 0..T {
        state[i] += round_constants[T * (rf / 2) as u32 + i];
    }
    state = apply_matrix(presparse_mds, state);

    for i in 0..T {
        std::as_witness(state[i]);
    }

    for r in 0..rp {
        state[0] = state[0].pow_32(alpha);
        state[0] += round_constants[(rf / 2 + 1) as u32 * T + r as u32];
        std::as_witness(state[0]);

        let mut new_state_0 = 0;
        for j in 0..T {
            new_state_0 += sparse_mds[(T * 2 - 1) * r as u32 + j] * state[j];
        }
        for k in 1..T {
            state[k] += state[0] * sparse_mds[(t * 2 - 1) as u32 * r as u32 + T + k - 1];
        }
        state[0] = new_state_0;

        if r & 1 == 0 {
            for k in 1..T {
                std::as_witness(state[k]);
            }
        }
    }

    for r in 0..rf / 2 - 1 {
        state = sigma(state);
        for i in 0..state.len() {
            state[i] += round_constants[(rf / 2 + 1) as u32 * T + rp as u32 + r as u32 * T + i];
        }
        state = apply_matrix(mds, state);
    }

    state = sigma(state);
    apply_matrix(mds, state)
}

fn apply_matrix<let N: u32>(matrix: [[Field; N]; N], vec: [Field; N]) -> [Field; N] {
    let mut out = [0; N];

    for i in 0..N {
        for j in 0..N {
            out[i] += vec[j] * matrix[j][i];
        }
    }

    out
}

fn sigma<let O: u32>(x: [Field; O]) -> [Field; O] {
    let mut y = x;
    for i in 0..O {
        let t = y[i];
        let tt = t * t;
        let tttt = tt * tt;
        y[i] *= tttt;
    }
    y
}
