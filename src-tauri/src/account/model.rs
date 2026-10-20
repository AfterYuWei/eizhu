use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUser {
    #[serde(default)]
    pub id: i64,
    pub email: String,
    pub storage_used: i64,
    pub storage_quota: i64,
    #[serde(default)]
    pub email_verified: bool,
    #[serde(default)]
    pub verification_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<AccountUser>,
    pub sync_enabled: bool,
}

#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub(super) struct AccountSession {
    #[serde(default)]
    pub user_id: i64,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub storage_used: i64,
    pub storage_quota: i64,
    #[serde(default)]
    pub email_verified: bool,
    #[serde(default)]
    pub verification_required: bool,
}

impl AccountSession {
    pub fn user(&self) -> AccountUser {
        AccountUser {
            id: self.user_id,
            email: self.email.clone(),
            storage_used: self.storage_used,
            storage_quota: self.storage_quota,
            email_verified: self.email_verified,
            verification_required: self.verification_required,
        }
    }
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub(super) struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub user: AccountUser,
}

impl From<TokenResponse> for AccountSession {
    fn from(mut value: TokenResponse) -> Self {
        Self {
            user_id: value.user.id,
            email: std::mem::take(&mut value.user.email),
            access_token: std::mem::take(&mut value.access_token),
            refresh_token: std::mem::take(&mut value.refresh_token),
            expires_in: value.expires_in,
            storage_used: value.user.storage_used,
            storage_quota: value.user.storage_quota,
            email_verified: value.user.email_verified,
            verification_required: value.user.verification_required,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MeResponse {
    pub id: i64,
    pub email: String,
    pub storage_used: i64,
    pub storage_quota: i64,
    #[serde(default)]
    pub email_verified: bool,
    #[serde(default)]
    pub verification_required: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_saved_sessions_keep_cloud_access_policy_when_fields_are_missing() {
        let legacy = r#"{"userId":7,"email":"legacy@example.com","accessToken":"access","refreshToken":"refresh","expiresIn":1800,"storageUsed":8,"storageQuota":100}"#;
        let session: AccountSession = serde_json::from_str(legacy).unwrap();
        assert!(!session.user().verification_required);
        assert!(!session.user().email_verified);
        assert_eq!(session.user().id, 7);
    }
    #[test]
    fn verification_policy_survives_login_response_and_session_round_trip() {
        let response: TokenResponse = serde_json::from_str(r#"{"accessToken":"access","refreshToken":"refresh","expiresIn":1800,"user":{"id":8,"email":"new@example.com","storageUsed":0,"storageQuota":100,"emailVerified":false,"verificationRequired":true}}"#).unwrap();
        let session = AccountSession::from(response);
        let restored: AccountSession =
            serde_json::from_str(&serde_json::to_string(&session).unwrap()).unwrap();
        assert!(restored.user().verification_required);
        assert!(!restored.user().email_verified);
    }
}
