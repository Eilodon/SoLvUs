use std::hash::sha256_compression;

type Sha256Block = [u32; 16];
type Sha256Hash = [u8; 32];
type Sha256State = [u32; 8];

global SHA256_INITIAL_STATE: Sha256State =
    [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];

fn bytes64_to_block(bytes: [u8; 64]) -> Sha256Block {
    let mut block: Sha256Block = [0; 16];
    for i in 0..16 {
        let base = 4 * i;
        block[i] = (bytes[base] as u32) << 24
            | (bytes[base + 1] as u32) << 16
            | (bytes[base + 2] as u32) << 8
            | (bytes[base + 3] as u32);
    }
    block
}

fn state_to_hash(state: Sha256State) -> Sha256Hash {
    let mut out: Sha256Hash = [0; 32];
    for i in 0..8 {
        let word_bytes: [u8; 4] = (state[i] as Field).to_be_bytes();
        for j in 0..4 {
            out[4 * i + j] = word_bytes[j];
        }
    }
    out
}

fn single_final_block<let N: u32>(tail: [u8; N], total_message_bytes: u32) -> Sha256Block {
    std::static_assert(N < 56, "single_final_block requires a tail shorter than 56 bytes");

    let mut final_bytes = [0; 64];
    for i in 0..N {
        final_bytes[i] = tail[i];
    }
    final_bytes[N] = 0x80;

    let bit_length: u64 = (total_message_bytes as u64) * 8;
    let length_bytes: [u8; 8] = (bit_length as Field).to_be_bytes();
    for i in 0..8 {
        final_bytes[56 + i] = length_bytes[i];
    }

    bytes64_to_block(final_bytes)
}

fn slice_bytes<let IN: u32, let OUT: u32>(input: [u8; IN], offset: u32) -> [u8; OUT] {
    let mut out = [0; OUT];
    for i in 0..OUT {
        out[i] = input[offset + i];
    }
    out
}

fn digest_154(msg: [u8; 154]) -> Sha256Hash {
    let mut state = SHA256_INITIAL_STATE;

    let block0 = bytes64_to_block(slice_bytes::<154, 64>(msg, 0));
    state = sha256_compression(block0, state);

    let block1 = bytes64_to_block(slice_bytes::<154, 64>(msg, 64));
    state = sha256_compression(block1, state);

    let block2 = single_final_block(slice_bytes::<154, 26>(msg, 128), 154);
    state = sha256_compression(block2, state);

    state_to_hash(state)
}

fn digest_32(msg: [u8; 32]) -> Sha256Hash {
    let state = sha256_compression(single_final_block(msg, 32), SHA256_INITIAL_STATE);
    state_to_hash(state)
}

pub fn double_sha256_154(msg: [u8; 154]) -> Sha256Hash {
    digest_32(digest_154(msg))
}
