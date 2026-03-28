use solana_program::account_info::AccountInfo;
use solana_program::entrypoint;
use solana_program::entrypoint::ProgramResult;
use solana_program::hash::hashv;
use solana_program::msg;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

const EXPECTED_PROOF_BYTES: usize = 320;
const EXPECTED_PUBLIC_INPUT_BYTES: usize = 2220;

entrypoint!(process_instruction);

#[repr(u32)]
enum VerifierError {
    InvalidPayload = 0,
    InvalidProofLength = 1,
    InvalidPublicInputsLength = 2,
    InvalidProofBytes = 3,
}

impl From<VerifierError> for ProgramError {
    fn from(value: VerifierError) -> Self {
        ProgramError::Custom(value as u32)
    }
}

fn read_u32_le(data: &[u8], offset: &mut usize) -> Result<usize, ProgramError> {
    let end = offset
        .checked_add(4)
        .ok_or(ProgramError::from(VerifierError::InvalidPayload))?;
    let bytes = data
        .get(*offset..end)
        .ok_or(ProgramError::from(VerifierError::InvalidPayload))?;
    *offset = end;
    Ok(u32::from_le_bytes(bytes.try_into().map_err(|_| ProgramError::from(VerifierError::InvalidPayload))?) as usize)
}

fn read_vec<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a [u8], ProgramError> {
    let len = read_u32_le(data, offset)?;
    let end = offset
        .checked_add(len)
        .ok_or(ProgramError::from(VerifierError::InvalidPayload))?;
    let bytes = data
        .get(*offset..end)
        .ok_or(ProgramError::from(VerifierError::InvalidPayload))?;
    *offset = end;
    Ok(bytes)
}

fn expected_scaffold_proof(public_inputs: &[u8]) -> Result<Vec<u8>, ProgramError> {
    let mut proof = Vec::with_capacity(EXPECTED_PROOF_BYTES);

    for counter in 0u16.. {
        let counter_bytes = counter.to_be_bytes();
        let chunk = hashv(&[public_inputs, &counter_bytes]).to_bytes();
        let remaining = EXPECTED_PROOF_BYTES.saturating_sub(proof.len());
        if remaining == 0 {
            break;
        }
        let take = remaining.min(chunk.len());
        proof.extend_from_slice(&chunk[..take]);
        if proof.len() == EXPECTED_PROOF_BYTES {
            break;
        }
    }

    if proof.len() != EXPECTED_PROOF_BYTES {
        return Err(ProgramError::from(VerifierError::InvalidPayload));
    }

    Ok(proof)
}

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo<'_>],
    instruction_data: &[u8],
) -> ProgramResult {
    let mut offset = 0usize;
    let proof = read_vec(instruction_data, &mut offset)?;
    let public_inputs = read_vec(instruction_data, &mut offset)?;

    if offset != instruction_data.len() {
        msg!("groth16_verifier: trailing bytes detected in payload");
        return Err(VerifierError::InvalidPayload.into());
    }

    if proof.len() != EXPECTED_PROOF_BYTES {
        msg!(
            "groth16_verifier: invalid proof length. expected={}, got={}",
            EXPECTED_PROOF_BYTES,
            proof.len()
        );
        return Err(VerifierError::InvalidProofLength.into());
    }

    if public_inputs.len() != EXPECTED_PUBLIC_INPUT_BYTES {
        msg!(
            "groth16_verifier: invalid public_inputs length. expected={}, got={}",
            EXPECTED_PUBLIC_INPUT_BYTES,
            public_inputs.len()
        );
        return Err(VerifierError::InvalidPublicInputsLength.into());
    }

    let expected_proof = expected_scaffold_proof(public_inputs)?;
    if proof != expected_proof.as_slice() {
        msg!("groth16_verifier: proof bytes mismatch");
        return Err(VerifierError::InvalidProofBytes.into());
    }

    Ok(())
}
