#[starknet::contract]
mod SolvusBadge {
    use starknet::ContractAddress;
    use array::ArrayTrait;
    use traits::Into;
    use traits::TryInto;
    use option::OptionTrait;

    // --- PHẦN 1: TYPES ---

    #[derive(Drop, Serde, Copy, starknet::Store)]
    struct PublicInputs {
        starknet_address: felt252,
        nonce: felt252,
        badge_type: u8,
        threshold: u64,
        is_upper_bound: bool,
        timestamp: u64,
        nullifier_hash: felt252,
    }

    #[derive(Drop, Serde, Copy, starknet::Store)]
    struct BitcoinSolvencyBadge {
        tier: u8,
        nullifier_hash: felt252,
        expires_at: u64,
    }

    #[derive(Drop, Serde, Copy, starknet::Store)]
    struct NullifierEntry {
        starknet_holder: ContractAddress,
        tier: u8,
        expires_at: u64,
    }

    // --- PHẦN 2: STORAGE ---

    #[storage]
    struct Storage {
        badges: LegacyMap<(ContractAddress, u8), BitcoinSolvencyBadge>,
        nonces: LegacyMap<ContractAddress, felt252>,
        nullifier_registry: LegacyMap<(felt252, u8), NullifierEntry>,
        garaga_verifier: ContractAddress,
    }

    // --- PHẦN 3: HELPERS ---

    /**
     * get_expected_constraints: SOURCE OF TRUTH for threshold logic.
     * Mirrors TypeScript's getThresholdForBadge().
     */
    fn get_expected_constraints(badge_type: u8, tier: u8) -> (u64, bool) {
        if badge_type == 1 { // Whale (satoshi)
            if tier == 1 { return (10_000_000, false); } // 0.1 BTC
            if tier == 2 { return (50_000_000, false); } // 0.5 BTC
            if tier == 3 { return (100_000_000, false); } // 1.0 BTC
            if tier == 4 { return (500_000_000, false); } // 5.0 BTC
        } else if badge_type == 2 { // Hodler (days)
            if tier == 1 { return (180, false); }
            if tier == 2 { return (365, false); }
        } else if badge_type == 3 { // Stacker (UTXO count)
            if tier == 1 { return (5, false); }
            if tier == 2 { return (15, false); }
            if tier == 3 { return (30, false); }
        }
        
        assert(false, 'Invalid badge_type or tier');
        (0, false)
    }

    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;

    #[starknet::interface]
    trait IGaragaVerifier<TContractState> {
        fn verify(self: @TContractState, proof: Array<felt252>, public_inputs: PublicInputs);
    }

    #[abi(embed_v0)]
    impl SolvusBadgeImpl of ISolvusBadge<ContractState> {
        fn issue_badge(
            ref self: ContractState,
            badge_type: u8,
            tier: u8,
            public_inputs: PublicInputs,
            proof: Array<felt252>,
        ) {
            let caller = get_caller_address();

            // Assert 1 — Caller match (chống front-run)
            assert(public_inputs.starknet_address == caller.into(), 'Caller mismatch');

            // Assert 2 — Nonce match (chống replay)
            let stored_nonce = self.nonces.read(caller);
            assert(public_inputs.nonce == stored_nonce, 'Nonce mismatch');

            // Assert 3 — Badge type match
            assert(public_inputs.badge_type == badge_type, 'Badge type mismatch');

            // Assert 4 — Threshold (chống 1-satoshi attack)
            let (expected_threshold, expected_bound) = get_expected_constraints(badge_type, tier);
            assert(public_inputs.threshold == expected_threshold, 'Threshold mismatch');

            // Assert 5 — is_upper_bound (chống manipulation)
            assert(public_inputs.is_upper_bound == expected_bound, 'Bound manipulation');

            // Assert 6+7 — Timestamp freshness (chống replay, chống underflow)
            let current = get_block_timestamp();
            if public_inputs.timestamp > current {
                assert(public_inputs.timestamp - current <= 60, 'Future timestamp DoS');
            } else {
                assert(current - public_inputs.timestamp <= 3600, 'Relayer signature expired');
            }

            // Assert 8 — Placeholder (Removed: Noir circuit now handles relayer verification internally)

            // Assert 9 — ZK proof (qua Garaga)
            let verifier = IGaragaVerifierDispatcher { contract_address: self.garaga_verifier.read() };
            verifier.verify(proof, public_inputs);

            // Nullifier + badge write
            let key = (public_inputs.nullifier_hash, badge_type);
            let existing = self.nullifier_registry.read(key);
            
            let is_empty = existing.starknet_holder.is_zero();
            let is_expired = get_block_timestamp() >= existing.expires_at;

            if existing.starknet_holder != caller {
                assert(is_empty || is_expired, 'Nullifier active elsewhere');
            }

            let expires = get_block_timestamp() + 259200; // 72h
            self.nullifier_registry.write(key, NullifierEntry { starknet_holder: caller, tier, expires_at: expires });
            self.badges.write((caller, badge_type), BitcoinSolvencyBadge { tier, nullifier_hash: public_inputs.nullifier_hash, expires_at: expires });
            self.nonces.write(caller, stored_nonce + 1);
        }

        fn is_badge_valid(
            self: @ContractState,
            holder: ContractAddress,
            badge_type: u8,
            min_tier: u8
        ) -> bool {
            let badge = self.badges.read((holder, badge_type));

            // Check 1: badge tồn tại
            if badge.tier == 0 { return false; }

            // Check 2: tier đủ
            if badge.tier < min_tier { return false; }

            // Check 3: fast-path expiry
            if get_block_timestamp() >= badge.expires_at { return false; }

            // Check 4: nullifier vẫn active trên đúng holder
            let key = (badge.nullifier_hash, badge_type);
            let entry = self.nullifier_registry.read(key);

            (entry.starknet_holder == holder) && (get_block_timestamp() < entry.expires_at)
        }
    }

    #[starknet::interface]
    trait ISolvusBadge<TContractState> {
        fn issue_badge(
            ref self: TContractState,
            badge_type: u8,
            tier: u8,
            public_inputs: PublicInputs,
            proof: Array<felt252>,
        );
        fn is_badge_valid(
            self: @TContractState,
            holder: ContractAddress,
            badge_type: u8,
            min_tier: u8
        ) -> bool;
    }
}
