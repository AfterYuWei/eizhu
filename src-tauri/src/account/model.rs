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
}

impl AccountSession {
    pub fn user(&self) -> AccountUser {
        AccountUser {
            id: self.user_id,
            email: self.email.clone(),
            storage_used: self.storage_used,
            storage_quota: self.storage_quota,
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
}
