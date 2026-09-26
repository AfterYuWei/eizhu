use std::sync::Arc;

use reqwest::{Method, Response, StatusCode};
use tokio::sync::Mutex;

use crate::{
    error::CommandError, infrastructure::database::Database, sync::SyncRepository, vault::Encryptor,
};

use super::{
    client::AccountClient,
    model::{AccountSession, AccountStatus, AccountUser},
    repository::AccountRepository,
};

const ACCOUNT_PROVIDER_NAME: &str = "eizhu 账号";

#[derive(Clone)]
pub(crate) struct AccountService {
    client: AccountClient,
    repository: AccountRepository,
    sync_repository: SyncRepository,
    session: Arc<Mutex<Option<AccountSession>>>,
}

impl AccountService {
    pub fn initialize(
        database: Database,
        encryptor: Encryptor,
        sync_repository: SyncRepository,
    ) -> Result<Self, CommandError> {
        let repository = AccountRepository::new(database, encryptor);
        let session = repository.load()?;
        let logged_in = session.is_some();
        let service = Self {
            client: AccountClient::new()?,
            repository,
            sync_repository,
            session: Arc::new(Mutex::new(session)),
        };
        if logged_in {
            service.ensure_account_provider()?;
        }
        Ok(service)
    }

    pub async fn status(&self) -> Result<AccountStatus, CommandError> {
        let user = self.session.lock().await.as_ref().map(AccountSession::user);
        Ok(AccountStatus {
            logged_in: user.is_some(),
            user,
            sync_enabled: self
                .sync_repository
                .account_provider_enabled()?
                .unwrap_or(false),
        })
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<AccountStatus, CommandError> {
        let session = self.client.login(email, password).await?.into();
        self.establish_session(session).await?;
        self.status().await
    }

    pub async fn register(
        &self,
        email: &str,
        password: &str,
    ) -> Result<AccountStatus, CommandError> {
        let session = self.client.register(email, password).await?.into();
        self.establish_session(session).await?;
        self.status().await
    }

    pub async fn me(&self) -> Result<AccountUser, CommandError> {
        let response = self
            .authorized_request(Method::GET, "api/auth/me", None, None)
            .await?;
        let me = self.client.me_from_response(response).await?;
        let mut session = self.session.lock().await;
        let current = session.as_mut().ok_or_else(not_logged_in)?;
        current.email.clone_from(&me.email);
        current.storage_used = me.storage_used;
        current.storage_quota = me.storage_quota;
        self.repository.save(current)?;
        Ok(current.user())
    }

    pub async fn logout(&self) -> Result<(), CommandError> {
        let remote_result = self.logout_remote().await;
        self.clear_local_session().await?;
        remote_result
    }

    pub async fn set_sync_enabled(&self, enabled: bool) -> Result<AccountStatus, CommandError> {
        if self.session.lock().await.is_none() {
            return Err(not_logged_in());
        }
        self.ensure_account_provider()?;
        self.sync_repository.set_account_provider_enabled(enabled)?;
        self.status().await
    }

    pub async fn put_object(&self, name: &str, bytes: Vec<u8>) -> Result<(), CommandError> {
        let response = self
            .authorized_request(
                Method::PUT,
                &format!("api/store/objects/{name}"),
                Some(bytes),
                Some("application/octet-stream"),
            )
            .await?;
        self.client.unit_from_response(response).await
    }

    pub async fn get_object(&self, name: &str) -> Result<Vec<u8>, CommandError> {
        let response = self
            .authorized_request(
                Method::GET,
                &format!("api/store/objects/{name}"),
                None,
                None,
            )
            .await?;
        self.client.bytes_from_response(response).await
    }

    pub async fn delete_object(&self, name: &str) -> Result<(), CommandError> {
        let response = self
            .authorized_request(
                Method::DELETE,
                &format!("api/store/objects/{name}"),
                None,
                None,
            )
            .await?;
        if response.status() == StatusCode::NOT_FOUND || response.status().is_success() {
            Ok(())
        } else {
            Err(self.client.response_error(response).await)
        }
    }

    async fn establish_session(&self, session: AccountSession) -> Result<(), CommandError> {
        self.repository.save(&session)?;
        *self.session.lock().await = Some(session);
        self.ensure_account_provider()?;
        Ok(())
    }

    async fn authorized_request(
        &self,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
    ) -> Result<Response, CommandError> {
        let mut guard = self.session.lock().await;
        let current = guard.as_mut().ok_or_else(not_logged_in)?;
        let mut response = self
            .client
            .authorized(
                method.clone(),
                path,
                &current.access_token,
                body.clone(),
                content_type,
            )
            .await?;
        if response.status() != StatusCode::UNAUTHORIZED {
            return Ok(response);
        }
        drop(response);
        let refreshed = match self.client.refresh(&current.refresh_token).await {
            Ok(tokens) => AccountSession::from(tokens),
            Err(error) => {
                self.repository.clear()?;
                *guard = None;
                return Err(error);
            }
        };
        self.repository.save(&refreshed)?;
        *current = refreshed;
        response = self
            .client
            .authorized(method, path, &current.access_token, body, content_type)
            .await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            drop(response);
            self.repository.clear()?;
            *guard = None;
            return Err(not_logged_in());
        }
        Ok(response)
    }

    async fn logout_remote(&self) -> Result<(), CommandError> {
        let mut guard = self.session.lock().await;
        let Some(current) = guard.as_mut() else {
            return Ok(());
        };
        let mut response = self.send_logout(current).await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            drop(response);
            let refreshed = match self.client.refresh(&current.refresh_token).await {
                Ok(tokens) => AccountSession::from(tokens),
                Err(error) if error.code == "ACCOUNT_NOT_LOGGED_IN" => return Ok(()),
                Err(error) => return Err(error),
            };
            self.repository.save(&refreshed)?;
            *current = refreshed;
            response = self.send_logout(current).await?;
        }
        self.client.unit_from_response(response).await
    }

    async fn send_logout(&self, session: &AccountSession) -> Result<Response, CommandError> {
        let body = serde_json::to_vec(&serde_json::json!({
            "refreshToken": session.refresh_token,
        }))
        .map_err(|_| CommandError::new("ACCOUNT_FAILED", "无法构造退出请求"))?;
        self.client
            .authorized(
                Method::POST,
                "api/auth/logout",
                &session.access_token,
                Some(body),
                Some("application/json"),
            )
            .await
    }

    fn ensure_account_provider(&self) -> Result<(), CommandError> {
        self.sync_repository
            .ensure_account_provider(ACCOUNT_PROVIDER_NAME)
    }

    async fn clear_local_session(&self) -> Result<(), CommandError> {
        self.repository.clear()?;
        *self.session.lock().await = None;
        self.sync_repository.delete_account_providers()?;
        Ok(())
    }
}

fn not_logged_in() -> CommandError {
    CommandError::new("ACCOUNT_NOT_LOGGED_IN", "请先登录 eizhu 账号")
}
