use solana_program::account_info::AccountInfo;
use solana_program::entrypoint;
use solana_program::entrypoint::ProgramResult;
use solana_program::msg;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

#[allow(dead_code)]
#[path = "../../../verifier_contract.rs"]
mod verifier_contract;

entrypoint!(process_instruction);

#[repr(u32)]
enum VerifierError {
    InvalidPayload = 0,
    InvalidProofLength = 1,
    InvalidPublicInputsLength = 2,
    UnsupportedHarnessInvocation = 3,
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

fn split_artifact_payload<'a>(instruction_data: &'a [u8]) -> Option<(&'a [u8], &'a [u8])> {
    let proof_end = verifier_contract::GROTH16_PROOF_BYTES;
    let public_inputs_end =
        proof_end.checked_add(verifier_contract::GROTH16_PUBLIC_INPUT_BYTES)?;
    if instruction_data.len() != public_inputs_end {
        return None;
    }
    Some(instruction_data.split_at(proof_end))
}

fn split_legacy_payload<'a>(instruction_data: &'a [u8]) -> Result<(&'a [u8], &'a [u8]), ProgramError> {
    let mut offset = 0usize;
    let proof = read_vec(instruction_data, &mut offset)?;
    let public_inputs = read_vec(instruction_data, &mut offset)?;

    if offset != instruction_data.len() {
        msg!("groth16_verifier: trailing bytes detected in payload");
        return Err(VerifierError::InvalidPayload.into());
    }

    Ok((proof, public_inputs))
}

fn split_verifier_payload<'a>(
    instruction_data: &'a [u8],
) -> Result<(&'a [u8], &'a [u8]), ProgramError> {
    if let Some((proof, public_inputs)) = split_artifact_payload(instruction_data) {
        return Ok((proof, public_inputs));
    }

    split_legacy_payload(instruction_data)
}

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo<'_>],
    instruction_data: &[u8],
) -> ProgramResult {
    let (proof, public_inputs) = split_verifier_payload(instruction_data)?;

    if proof.len() != verifier_contract::GROTH16_PROOF_BYTES {
        msg!(
            "groth16_verifier: invalid proof length. expected={}, got={}",
            verifier_contract::GROTH16_PROOF_BYTES,
            proof.len()
        );
        return Err(VerifierError::InvalidProofLength.into());
    }

    if public_inputs.len() != verifier_contract::GROTH16_PUBLIC_INPUT_BYTES {
        msg!(
            "groth16_verifier: invalid public_inputs length. expected={}, got={}",
            verifier_contract::GROTH16_PUBLIC_INPUT_BYTES,
            public_inputs.len()
        );
        return Err(VerifierError::InvalidPublicInputsLength.into());
    }

    msg!(
        "groth16_verifier: local harness matches artifact contract only. mode={}, vk_sha256={}, program_sha256={}",
        verifier_contract::VERIFIER_ARTIFACT_MODE,
        verifier_contract::VERIFIER_VK_SHA256,
        verifier_contract::VERIFIER_PROGRAM_SHA256
    );
    msg!(
        "groth16_verifier: deploy {} for real verification; this crate is non-authoritative",
        verifier_contract::VERIFIER_PROGRAM_PATH
    );

    Err(VerifierError::UnsupportedHarnessInvocation.into())
}

#[cfg(test)]
mod tests {
    use super::{split_verifier_payload, verifier_contract};

    #[test]
    fn accepts_artifact_boundary_payload() {
        let payload = vec![
            7u8;
            verifier_contract::GROTH16_PROOF_BYTES
                + verifier_contract::GROTH16_PUBLIC_INPUT_BYTES
        ];

        let (proof, public_inputs) =
            split_verifier_payload(&payload).expect("artifact payload should parse");

        assert_eq!(proof.len(), verifier_contract::GROTH16_PROOF_BYTES);
        assert_eq!(
            public_inputs.len(),
            verifier_contract::GROTH16_PUBLIC_INPUT_BYTES
        );
    }

    #[test]
    fn accepts_legacy_length_prefixed_payload() {
        let proof = vec![1u8; verifier_contract::GROTH16_PROOF_BYTES];
        let public_inputs = vec![2u8; verifier_contract::GROTH16_PUBLIC_INPUT_BYTES];

        let mut payload = Vec::new();
        payload.extend_from_slice(&(proof.len() as u32).to_le_bytes());
        payload.extend_from_slice(&proof);
        payload.extend_from_slice(&(public_inputs.len() as u32).to_le_bytes());
        payload.extend_from_slice(&public_inputs);

        let (parsed_proof, parsed_public_inputs) =
            split_verifier_payload(&payload).expect("legacy payload should parse");

        assert_eq!(parsed_proof, proof.as_slice());
        assert_eq!(parsed_public_inputs, public_inputs.as_slice());
    }
}
