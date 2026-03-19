use dep::std;



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

fn bytes_to_hex64(b: [u8; 32]) -> [u8; 64] {
    let mut hex = [0; 64];
    for i in 0..32 {
        let hi = b[i] / 16;
        let lo = b[i] - (hi * 16);
        hex[i * 2] = if hi < 10 { hi + 48 } else { hi + 87 };
        hex[i * 2 + 1] = if lo < 10 { lo + 48 } else { lo + 87 };
    }
    hex
}

fn main(
    starknet_address: pub Field,
    nonce: pub Field,
    user_sig: [u8; 64],
    relayer_sig_s: Field,
    relayer_sig_r8_x: Field,
    relayer_sig_r8_y: Field,
    badge_type: pub u8,
    _tier: u8, // _tier: Cairo enforces tier<->threshold via get_expected_constraints()
    threshold: pub u64,
    is_upper_bound: pub bool,
    timestamp: pub u64,
    pubkey_x: [u8; 32],
    pubkey_y: [u8; 32],
    btc_data: u64,
    nullifier_secret: Field,
    nullifier_hash: pub Field
) {
    // Hardcoded Relayer EdDSA (BabyJubJub) Public Key
    let relayer_pub_x: Field = 0xbbf872feb02f85ea9e79eb8640dc1f0daa8d641c6043127743ee1bba0042bd8;
    let relayer_pub_y: Field = 0xb96e3c9bd23d9e416e691de9cc656e1a76175ce8c1fb6905c5e9d385b170f3f;

    // STEP 0 - Serialization
    let addr_bytes: [u8; 32] = starknet_address.to_be_bytes::<32>();
    let nonce_bytes: [u8; 32] = nonce.to_be_bytes::<32>();
    let addr_hex: [u8; 64] = bytes_to_hex64(addr_bytes);
    let nonce_hex: [u8; 64] = bytes_to_hex64(nonce_bytes);

    // STEP 1 - USER ECDSA
    let bsm_prefix: [u8; 26] = [
        0x18, 0x42, 0x69, 0x74, 0x63, 0x6f, 0x69, 0x6e, 0x20, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x20, 
        0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x3a, 0x0a, 0x80
    ];

    let mut full_message = [0; 154];
    for i in 0..26 { full_message[i] = bsm_prefix[i]; }
    for i in 0..64 { full_message[26 + i] = addr_hex[i]; }
    for i in 0..64 { full_message[90 + i] = nonce_hex[i]; }

    let hashed_msg = std::hash::sha256(std::hash::sha256(full_message));
    assert(std::ecdsa_secp256k1::verify_signature(pubkey_x, pubkey_y, user_sig, hashed_msg));

    // STEP 2 - RELAYER VERIFICATION (ZK-Native EdDSA + Poseidon)
    let (x_hi_r, x_lo_r) = split_to_128bit_fields(pubkey_x);
    let payload_hash = std::hash::poseidon::bn254::hash_4([
        x_hi_r, x_lo_r, btc_data as Field, timestamp as Field
    ]);
    let is_valid_relayer = dep::eddsa::eddsa_verify::<dep::poseidon::poseidon::PoseidonHasher>(
        relayer_pub_x, relayer_pub_y,
        relayer_sig_s, relayer_sig_r8_x, relayer_sig_r8_y,
        payload_hash
    );
    assert(is_valid_relayer);

    // STEP 3 - THRESHOLD CHECK
    if is_upper_bound {
        assert(btc_data <= threshold);
    } else {
        assert(btc_data >= threshold);
    }

    // STEP 4 - NULLIFIER BINDING
    let (x_hi, x_lo) = split_to_128bit_fields(pubkey_x);
    let computed_nullifier = std::hash::poseidon::bn254::hash_4([nullifier_secret, x_hi, x_lo, badge_type as Field]);
    assert(computed_nullifier == nullifier_hash);
}

#[test]
fn test_integration_sync() {
    let pubkey_x: [u8; 32] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
        0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
        0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20
    ];
    let (x_hi, x_lo) = split_to_128bit_fields(pubkey_x);
    let nullifier_secret: Field = 0x123;
    let badge_type: u8 = 1;
    
    let computed = std::hash::poseidon::bn254::hash_4([nullifier_secret, x_hi, x_lo, badge_type as Field]);
    assert(computed == 9868318295022348008278243854539044859959337000782034887914225572392925112288);
}
