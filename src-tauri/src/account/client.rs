use std::time::Duration;

use reqwest::{Client, Method, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::error::CommandError;

use super::model::{MeResponse, TokenResponse};

pub const ACCOUNT_SERVER_URL: &str = match option_env!("EIZHU_ACCOUNT_SERVER") {
    Some(url) => url,
    None => "https://account.eizhu.invalid/",
};

#[derive(Clone)]
pub(super) struct AccountClient {
    client: Client,
    base_url: Url,
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    code: String,
}

impl AccountClient {
    pub fn new() -> Result<Self, CommandError> {
        #[cfg(debug_assertions)]
        let raw =
            std::env::var("EIZHU_ACCOUNT_SERVER").unwrap_or_else(|_| ACCOUNT_SERVER_URL.to_owned());
        #[cfg(not(debug_assertions))]
        let raw = ACCOUNT_SERVER_URL.to_owned();
        Self::with_base_url(&raw)
    }

    pub(super) fn with_base_url(raw: &str) -> Result<Self, CommandError> {
        // AccountClient is also constructed directly by domain tests; keep the
        // rustls provider invariant local to this HTTP boundary as well as in bootstrap.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let base_url = Url::parse(raw)
            .and_then(|url| url.join("/"))
            .map_err(|_| CommandError::new("ACCOUNT_FAILED", "账号服务器地址无效"))?;
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(network_error)?;
        Ok(Self { client, base_url })
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<TokenResponse, CommandError> {
        self.post_credentials("api/auth/login", email, password)
            .await
    }

    pub async fn register(
        &self,
        email: &str,
        password: &str,
    ) -> Result<TokenResponse, CommandError> {
        self.post_credentials("api/auth/register", email, password)
            .await
    }

    pub async fn request_password_reset(&self, email: &str) -> Result<(), CommandError> {
        self.public_unit(
            "api/auth/password/forgot",
            serde_json::json!({ "email": email }),
        )
        .await
    }

    pub async fn reset_password(
        &self,
        email: &str,
        code: &str,
        password: &str,
    ) -> Result<(), CommandError> {
        self.public_unit(
            "api/auth/password/reset",
            serde_json::json!({ "email": email, "code": code, "newPassword": password }),
        )
        .await
    }

    async fn public_unit(&self, path: &str, body: serde_json::Value) -> Result<(), CommandError> {
        let response = self
            .client
            .post(self.url(path)?)
            .json(&body)
            .send()
            .await
            .map_err(network_error)?;
        self.unit_from_response(response).await
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<TokenResponse, CommandError> {
        let response = self
            .client
            .post(self.url("api/auth/refresh")?)
            .json(&serde_json::json!({ "refreshToken": refresh_token }))
            .send()
            .await
            .map_err(network_error)?;
        self.decode(response).await
    }

    pub async fn authorized(
        &self,
        method: Method,
        path: &str,
        access_token: &str,
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
    ) -> Result<Response, CommandError> {
        let mut request = self
            .client
            .request(method, self.url(path)?)
            .bearer_auth(access_token);
        if let Some(body) = body {
            request = request.body(body);
        }
        if let Some(content_type) = content_type {
            request = request.header("content-type", content_type);
        }
        if path.ends_with("/events") {
            request = request.timeout(Duration::from_secs(3600));
        }
        request.send().await.map_err(network_error)
    }

    pub async fn me_from_response(&self, response: Response) -> Result<MeResponse, CommandError> {
        self.decode(response).await
    }

    pub async fn unit_from_response(&self, response: Response) -> Result<(), CommandError> {
        if response.status().is_success() {
            Ok(())
        } else {
            Err(self.response_error(response).await)
        }
    }

    async fn post_credentials<T: DeserializeOwned>(
        &self,
        path: &str,
        email: &str,
        password: &str,
    ) -> Result<T, CommandError> {
        let response = self
            .client
            .post(self.url(path)?)
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await
            .map_err(network_error)?;
        self.decode(response).await
    }

    pub(crate) async fn decode<T: DeserializeOwned>(
        &self,
        response: Response,
    ) -> Result<T, CommandError> {
        if response.status().is_success() {
            response
                .json()
                .await
                .map_err(|_| CommandError::new("SYNC_PROTOCOL", "账号服务器返回了无效数据"))
        } else {
            Err(self.response_error(response).await)
        }
    }

    pub async fn response_error(&self, response: Response) -> CommandError {
        let status = response.status();
        let code = response
            .json::<ErrorEnvelope>()
            .await
            .ok()
            .map(|value| value.code);
        match (status, code.as_deref()) {
            (StatusCode::UNAUTHORIZED, Some("INVALID_CREDENTIALS")) => {
                CommandError::new("ACCOUNT_INVALID_CREDENTIALS", "邮箱或密码不正确")
            }
            (StatusCode::CONFLICT, Some("EMAIL_TAKEN")) => {
                CommandError::new("ACCOUNT_EMAIL_TAKEN", "该邮箱已被注册")
            }
            (StatusCode::FORBIDDEN, Some("EMAIL_NOT_VERIFIED")) => {
                CommandError::new("EMAIL_NOT_VERIFIED", "请先验证邮箱，再使用云同步和官方备份")
            }
            (StatusCode::BAD_REQUEST, Some("PASSWORD_TOO_LONG")) => CommandError::new(
                "PASSWORD_TOO_LONG",
                "登录密码不能超过 72 个 UTF-8 字节，请缩短密码",
            ),
            (StatusCode::BAD_REQUEST, Some("INVALID_EMAIL_CODE")) => {
                CommandError::new("INVALID_EMAIL_CODE", "验证码无效或已过期，请重新获取")
            }
            (StatusCode::TOO_MANY_REQUESTS, _) => {
                CommandError::new("RATE_LIMITED", "请求过于频繁，请稍后重试")
            }
            (StatusCode::FORBIDDEN, Some("ACCOUNT_DISABLED")) => {
                CommandError::new("ACCOUNT_DISABLED", "账号已被禁用，请联系管理员")
            }
            (StatusCode::PAYLOAD_TOO_LARGE, _) => {
                CommandError::new("ACCOUNT_QUOTA_EXCEEDED", "账号云存储空间不足")
            }
            (StatusCode::NOT_FOUND, Some("OBJECT_NOT_FOUND")) => {
                CommandError::new("OBJECT_NOT_FOUND", "云端对象不存在")
            }
            (StatusCode::UNAUTHORIZED, _) => {
                CommandError::new("ACCOUNT_NOT_LOGGED_IN", "登录已失效，请重新登录")
            }
            (
                _,
                Some(
                    "KEY_NOT_FOUND" | "REQUEST_NOT_FOUND" | "SNAPSHOT_EXPIRED" | "ITEM_CONFLICT"
                    | "KEY_CONFLICT" | "CURSOR_EXPIRED" | "EPOCH_CHANGED" | "WATERMARK_CHANGED"
                    | "REQUEST_REUSED",
                ),
            ) => CommandError::new(
                [
                    "KEY_NOT_FOUND",
                    "REQUEST_NOT_FOUND",
                    "SNAPSHOT_EXPIRED",
                    "ITEM_CONFLICT",
                    "KEY_CONFLICT",
                    "CURSOR_EXPIRED",
                    "EPOCH_CHANGED",
                    "WATERMARK_CHANGED",
                    "REQUEST_REUSED",
                ]
                .into_iter()
                .find(|known| Some(*known) == code.as_deref())
                .unwrap_or("ACCOUNT_FAILED"),
                "云端状态已变化，请重新核对",
            ),
            (
                StatusCode::BAD_GATEWAY
                | StatusCode::SERVICE_UNAVAILABLE
                | StatusCode::GATEWAY_TIMEOUT
                | StatusCode::INTERNAL_SERVER_ERROR,
                _,
            ) => CommandError::new("ACCOUNT_UNAVAILABLE", "云端暂时不可用，本地修改已保留")
                .retryable(),
            _ => CommandError::new(
                "ACCOUNT_FAILED",
                format!("账号服务器请求失败（HTTP {status}）"),
            ),
        }
    }

    pub(crate) fn server_identity(&self) -> String {
        self.base_url.to_string()
    }

    fn url(&self, path: &str) -> Result<Url, CommandError> {
        self.base_url
            .join(path)
            .map_err(|_| CommandError::new("ACCOUNT_FAILED", "账号服务器地址无效"))
    }
}

fn network_error(_error: reqwest::Error) -> CommandError {
    CommandError::new("ACCOUNT_FAILED", "无法连接账号服务器").retryable()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_is_normalized() {
        let client = AccountClient::with_base_url("https://example.com/root").unwrap();
        assert_eq!(
            client.url("api/auth/me").unwrap().as_str(),
            "https://example.com/api/auth/me"
        );
    }
}
