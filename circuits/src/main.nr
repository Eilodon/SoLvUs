use dep::std;
use dep::sha256;
use dep::poseidon;

/**
 * Helper A: u64_to_be_bytes
 */
fn u64_to_be_bytes(val: u64) -> [u8; 8] {
    let mut out = [0; 8];
    out[0] = (val >> 56) as u8;
    out[1] = (val >> 48) as u8;
    out[2] = (val >> 40) as u8;
    out[3] = (val >> 32) as u8;
    out[4] = (val >> 24) as u8;
    out[5] = (val >> 16) as u8;
    out[6] = (val >> 8) as u8;
    out[7] = val as u8;
    out
}

/**
 * Helper B: split_to_128bit_fields
 * Splits 32 bytes into [x_hi, x_lo]
 */
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

/**
 * Helper C: bytes_to_hex64
 * Converts 32 bytes to 64 ASCII hex chars (lowercase).
 */
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

/**
 * Main Circuit
 */
fn main(
    starknet_address: Field,
    nonce: Field,
    user_sig: [u8; 64],
    relayer_pubkey_x: [u8; 32],
    relayer_pubkey_y: [u8; 32],
    relayer_sig: [u8; 64],
    badge_type: u8,
    tier: u8,
    threshold: u64,
    is_upper_bound: bool,
    timestamp: u64,
    pubkey_x: [u8; 32],
    pubkey_y: [u8; 32],
    btc_data: u64,
    nullifier_secret: Field,
    nullifier_hash: pub Field
) {
    // STEP 0 - Serialization
    let addr_bytes: [u8; 32] = starknet_address.to_be_bytes::<32>();
    let nonce_bytes: [u8; 32] = nonce.to_be_bytes::<32>();
    let addr_hex: [u8; 64] = bytes_to_hex64(addr_bytes);
    let nonce_hex: [u8; 64] = bytes_to_hex64(nonce_bytes);

    // STEP 1 - USER ECDSA
    // Bitcoin Signed Message Prefix: "\x18Bitcoin Signed Message:\n" (25 bytes) 
    // + varint(128) = 0x80 (1 byte)
    // Total prefix: 26 bytes
    let bsm_prefix: [u8; 26] = [
        0x18, 0x42, 0x69, 0x74, 0x63, 0x6f, 0x69, 0x6e, 0x20, 0x53, 0x69, 0x67, 0x6e, 0x65, 0x64, 0x20, 
        0x4d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65, 0x3a, 0x0a, 0x80
    ];

    let mut full_message = [0; 154];
    for i in 0..26 { full_message[i] = bsm_prefix[i]; }
    for i in 0..64 { full_message[26 + i] = addr_hex[i]; }
    for i in 0..64 { full_message[90 + i] = nonce_hex[i]; }

    let hashed_msg = sha256::digest(sha256::digest(full_message));
    assert(std::ecdsa_secp256k1::verify_signature(pubkey_x, pubkey_y, user_sig, hashed_msg), "Invalid User Sig");

    // STEP 2 - RELAYER ECDSA
    let btc_data_bytes = u64_to_be_bytes(btc_data);
    let timestamp_bytes = u64_to_be_bytes(timestamp);
    let mut payload = [0u8; 48];
    for i in 0..32 { payload[i] = pubkey_x[i]; }
    for i in 0..8  { payload[32 + i] = btc_data_bytes[i]; }
    for i in 0..8  { payload[40 + i] = timestamp_bytes[i]; }

    assert(
        std::ecdsa_secp256k1::verify_signature(
            relayer_pubkey_x, relayer_pubkey_y, relayer_sig,
            sha256::digest(payload)
        ),
        "Invalid Relayer Sig"
    );

    // STEP 3 - THRESHOLD CHECK
    if is_upper_bound {
        assert(btc_data <= threshold, "btc_data exceeds threshold");
    } else {
        assert(btc_data >= threshold, "btc_data below threshold");
    }

    // STEP 4 - NULLIFIER BINDING
    let (x_hi, x_lo) = split_to_128bit_fields(pubkey_x);
    let computed_nullifier = poseidon::poseidon::bn254::hash_4(
        [nullifier_secret, x_hi, x_lo, badge_type as Field]
    );
    assert(computed_nullifier == nullifier_hash, "Nullifier mismatch");
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
    
    let computed = poseidon::poseidon::bn254::hash_4([nullifier_secret, x_hi, x_lo, badge_type as Field]);
    std::println(f"DEBUG - x_hi: {x_hi}");
    std::println(f"DEBUG - x_lo: {x_lo}");
    std::println(f"DEBUG - secret: {nullifier_secret}");
    std::println(f"DEBUG - computed: {computed}");
    
    // Result from TS: 9868318295022348008278243854539044859959337000782034887914225572392925112288
    assert(computed == 9868318295022348008278243854539044859959337000782034887914225572392925112288, "Integration nullifier mismatch");
}

#[test]
fn test_bytes_to_hex64_leading_zeros() {
    let addr: Field = 0x00000000d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7;
    let bytes: [u8; 32] = addr.to_be_bytes::<32>();
    let hex = bytes_to_hex64(bytes);
    assert(hex[0] == 48, "Expected ASCII '0' (48)");
    assert(hex[1] == 48, "Expected ASCII '0' (48)");
}
