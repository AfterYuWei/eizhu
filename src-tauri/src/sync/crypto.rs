//! Versioned account encryption. Secrets are never part of Debug output.
use crate::error::CommandError;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyEnvelope {
    pub salt: String,
    pub time: u32,
    pub memory: u32,
    pub threads: u32,
    pub wrapped_key: String,
    pub version: i64,
    pub revision: i64,
}
fn error() -> CommandError {
    CommandError::new("SYNC_CRYPTO", "同步密码错误或加密数据已损坏")
}
fn derive(password: &str, envelope: &KeyEnvelope) -> Result<Zeroizing<[u8; 32]>, CommandError> {
    if envelope.version != 1
        || envelope.memory < 8192
        || envelope.memory > 1048576
        || envelope.time == 0
        || envelope.time > 100
        || envelope.threads == 0
        || envelope.threads > 16
    {
        return Err(error());
    }
    let salt = STANDARD.decode(&envelope.salt).map_err(|_| error())?;
    if salt.len() != 16 {
        return Err(error());
    }
    let params = Params::new(envelope.memory, envelope.time, envelope.threads, Some(32))
        .map_err(|_| error())?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), &salt, key.as_mut())
        .map_err(|_| error())?;
    Ok(key)
}
pub(crate) fn wrap(
    password: &str,
    key: &[u8; 32],
    user: i64,
    revision: i64,
) -> Result<KeyEnvelope, CommandError> {
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|_| error())?;
    let mut envelope = KeyEnvelope {
        salt: STANDARD.encode(salt),
        time: 3,
        memory: 65536,
        threads: 2,
        wrapped_key: String::new(),
        version: 1,
        revision,
    };
    let derived = derive(password, &envelope)?;
    envelope.wrapped_key = seal(&derived, key, format!("eizhu:key:2:{user}:1").as_bytes())?;
    Ok(envelope)
}
pub(crate) fn unwrap(
    password: &str,
    envelope: &KeyEnvelope,
    user: i64,
) -> Result<Zeroizing<[u8; 32]>, CommandError> {
    let derived = derive(password, envelope)?;
    let bytes = open(
        &derived,
        &envelope.wrapped_key,
        format!("eizhu:key:2:{user}:1").as_bytes(),
    )?;
    if bytes.len() != 32 {
        return Err(error());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&bytes);
    Ok(key)
}
pub(crate) fn aad(
    user: i64,
    kind: &str,
    id: &str,
    revision: i64,
    epoch: i64,
    deleted: bool,
) -> Result<Vec<u8>, CommandError> {
    serde_json::to_vec(&("eizhu:item", 2, user, kind, id, revision, epoch, 1, deleted))
        .map_err(CommandError::database)
}
pub(crate) fn seal(key: &[u8; 32], plain: &[u8], aad: &[u8]) -> Result<String, CommandError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| error())?;
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).map_err(|_| error())?;
    let body = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad })
        .map_err(|_| error())?;
    let mut bytes = nonce.to_vec();
    bytes.extend_from_slice(&body);
    Ok(STANDARD.encode(bytes))
}
pub(crate) fn open(
    key: &[u8; 32],
    encoded: &str,
    aad: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CommandError> {
    let bytes = STANDARD.decode(encoded).map_err(|_| error())?;
    if bytes.len() < 28 {
        return Err(error());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| error())?;
    cipher
        .decrypt(
            Nonce::from_slice(&bytes[..12]),
            Payload {
                msg: &bytes[12..],
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| error())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ciphertext_is_bound_to_identity_revision_and_epoch() {
        let key = [7; 32];
        let associated = aad(1, "vault", "secret", 1, 1, false).unwrap();
        let encrypted = seal(&key, b"private key", &associated).unwrap();
        assert_eq!(
            open(&key, &encrypted, &associated).unwrap().as_slice(),
            b"private key"
        );
        for other in [
            aad(2, "vault", "secret", 1, 1, false),
            aad(1, "profile", "secret", 1, 1, false),
            aad(1, "vault", "secret", 2, 1, false),
            aad(1, "vault", "secret", 1, 2, false),
        ] {
            assert!(open(&key, &encrypted, &other.unwrap()).is_err());
        }
    }
    #[test]
    fn changing_password_preserves_the_data_key() {
        let key = [9; 32];
        let first = wrap("old password", &key, 4, 0).unwrap();
        assert!(unwrap("wrong", &first, 4).is_err());
        let second = wrap(
            "new password",
            &unwrap("old password", &first, 4).unwrap(),
            4,
            first.revision,
        )
        .unwrap();
        assert_eq!(*unwrap("new password", &second, 4).unwrap(), key);
    }
}
