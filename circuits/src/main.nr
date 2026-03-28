use dep::legacy_poseidon;
use dep::sha256;
use std::ecdsa_secp256k1::verify_signature;

fn split_to_128bit_fields(bytes: [u8; 32]) -> (Field, Field) {
    let mut x_hi = 0;
    let mut x_lo = 0;
    for i in 0..16 {
        x_hi = x_hi * 256 + bytes[i] as Field;
    }
    for i in 0..16 {
        x_lo = x_lo * 256 + bytes[16 + i] as Field;
    }
    (x_hi, x_lo)
}

fn bytes_to_hex64(bytes: [u8; 32]) -> [u8; 64] {
    let mut hex = [0; 64];
    for i in 0..32 {
        let hi = bytes[i] / 16;
        let lo = bytes[i] - (hi * 16);
        hex[i * 2] = if hi < 10 { hi + 48 } else { hi + 87 };
        hex[i * 2 + 1] = if lo < 10 { lo + 48 } else { lo + 87 };
    }
    hex
}

fn bytes32_to_field(bytes: [u8; 32]) -> Field {
    let mut acc = 0;
    for i in 0..32 {
        acc = acc * 256 + bytes[i] as Field;
    }
    acc
}

fn main(
    solana_address: [u8; 32],
    nonce: Field,
    relayer_pubkey_x: [u8; 32],
    relayer_pubkey_y: [u8; 32],
    badge_type: u8,
    threshold: u64,
    is_upper_bound: bool,
    timestamp: u64,
    nullifier_hash: pub Field,

    nullifier_secret: Field,
    pubkey_x: [u8; 32],
    pubkey_y: [u8; 32],
    user_sig: [u8; 64],
    btc_data: u64,
    relayer_sig: [u8; 64],
) {
    let solana_address_field = bytes32_to_field(solana_address);
    let minute_bucket = (timestamp / 60) as Field;
    let expected_nonce = legacy_poseidon::bn254::hash_4([
        solana_address_field,
        minute_bucket,
        0,
        0,
    ]);
    assert(expected_nonce == nonce);

    let nonce_bytes: [u8; 32] = nonce.to_be_bytes::<32>();
    let address_hex = bytes_to_hex64(solana_address);
    let nonce_hex = bytes_to_hex64(nonce_bytes);

    let bsm_prefix: [u8; 26] = [
        0x18, 0x42, 0x69, 0x74, 0x63, 0x6f, 0x69, 0x6e, 0x20, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x20,
        0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x3a, 0x0a, 0x80
    ];

    let mut full_message = [0; 154];
    for i in 0..26 { full_message[i] = bsm_prefix[i]; }
    for i in 0..64 { full_message[26 + i] = address_hex[i]; }
    for i in 0..64 { full_message[90 + i] = nonce_hex[i]; }

    let user_message_hash = sha256::digest(sha256::digest(full_message));
    assert(verify_signature(pubkey_x, pubkey_y, user_sig, user_message_hash));

    let (x_hi, x_lo) = split_to_128bit_fields(pubkey_x);
    let relayer_payload_hash = legacy_poseidon::bn254::hash_4([
        x_hi,
        x_lo,
        btc_data as Field,
        timestamp as Field,
    ]);
    let relayer_message_hash = relayer_payload_hash.to_be_bytes::<32>();
    assert(verify_signature(
        relayer_pubkey_x,
        relayer_pubkey_y,
        relayer_sig,
        relayer_message_hash,
    ));

    if is_upper_bound {
        assert(btc_data <= threshold);
    } else {
        assert(btc_data >= threshold);
    }

    let expected_nullifier_hash = legacy_poseidon::bn254::hash_4([
        nullifier_secret,
        badge_type as Field,
        timestamp as Field,
        nonce,
    ]);
    assert(expected_nullifier_hash == nullifier_hash);
}
