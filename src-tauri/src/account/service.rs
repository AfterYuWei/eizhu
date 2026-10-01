use std::sync::Arc;

use reqwest::{Method, Response, StatusCode};
use tokio::sync::Mutex;

use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};

use super::{
    client::AccountClient,
    model::{AccountSession, AccountStatus, AccountUser},
    repository::AccountRepository,
};

#[derive(Clone)]
pub(crate) struct AccountService {
    client: AccountClient,
    repository: AccountRepository,
    session: Arc<Mutex<Option<AccountSession>>>,
}

impl AccountService {
    pub fn initialize(database: Database, encryptor: Encryptor) -> Result<Self, CommandError> {
        let repository = AccountRepository::new(database, encryptor);
        let session = repository.load()?;
        let service = Self {
            client: AccountClient::new()?,
            repository,
            session: Arc::new(Mutex::new(session)),
        };
        Ok(service)
    }

    #[cfg(test)]
    pub(crate) fn with_server(
        database: Database,
        encryptor: Encryptor,
        url: &str,
    ) -> Result<Self, CommandError> {
        let repository = AccountRepository::new(database, encryptor);
        Ok(Self {
            client: AccountClient::with_base_url(url)?,
            repository,
            session: Arc::new(Mutex::new(None)),
        })
    }
    pub fn initialize_metadata(
        database: Database,
        encryptor: Encryptor,
        legacy: Database,
    ) -> Result<Self, CommandError> {
        let marker: bool = database
            .connect()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM feature_migrations WHERE name='account_metadata')",
                [],
                |r| r.get(0),
            )
            .map_err(CommandError::database)?;
        if !marker {
            let old = AccountRepository::new(legacy, encryptor.clone());
            if let Some(session) = old.load()? {
                AccountRepository::new(database.clone(), encryptor.clone()).save(&session)?;
            }
            database
                .connect()?
                .execute(
                    "INSERT INTO feature_migrations(name) VALUES('account_metadata')",
                    [],
                )
                .map_err(CommandError::database)?;
        }
        Self::initialize(database, encryptor)
    }
    pub async fn status(&self) -> Result<AccountStatus, CommandError> {
        let user = self.session.lock().await.as_ref().map(AccountSession::user);
        Ok(AccountStatus {
            logged_in: user.is_some(),
            sync_enabled: user.is_some(),
            user,
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
        let expected = self
            .session
            .lock()
            .await
            .as_ref()
            .ok_or_else(not_logged_in)?
            .user_id;
        let response = self
            .authorized_scoped(Some(expected), Method::GET, "api/auth/me", None, None)
            .await?;
        let me = self.client.me_from_response(response).await?;
        let mut session = self.session.lock().await;
        let current = session.as_mut().ok_or_else(not_logged_in)?;
        if current.user_id != expected || (expected > 0 && me.id != expected) {
            return Err(CommandError::new(
                "ACCOUNT_CHANGED",
                "账号已切换，请重新刷新",
            ));
        }
        current.user_id = me.id;
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
        if !enabled {
            return Err(CommandError::new(
                "SYNC_ALWAYS_ON",
                "账号空间会自动同步；离线修改将保留在本地",
            ));
        }
        self.status().await
    }

    pub(crate) async fn json_for<T: serde::de::DeserializeOwned>(
        &self,
        user_id: i64,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T, CommandError> {
        if self.session.lock().await.as_ref().map(|s| s.user_id) != Some(user_id) {
            return Err(not_logged_in());
        }
        let bytes = body
            .map(|value| serde_json::to_vec(&value))
            .transpose()
            .map_err(CommandError::database)?;
        let response = self
            .authorized_scoped(Some(user_id), method, path, bytes, Some("application/json"))
            .await?;
        self.client.decode(response).await
    }

    pub(crate) async fn backup_object(
        &self,
        user: i64,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
        json: bool,
    ) -> Result<Vec<u8>, CommandError> {
        let response = self
            .authorized_scoped(
                Some(user),
                method,
                path,
                body,
                Some(if json {
                    "application/json"
                } else {
                    "application/octet-stream"
                }),
            )
            .await?;
        if !response.status().is_success() {
            return Err(self.client.response_error(response).await);
        }
        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|_| CommandError::new("ACCOUNT_UNAVAILABLE", "备份网络请求失败"))
    }

    pub(crate) async fn response_for(
        &self,
        user_id: i64,
        path: &str,
    ) -> Result<Response, CommandError> {
        if self.session.lock().await.as_ref().map(|s| s.user_id) != Some(user_id) {
            return Err(not_logged_in());
        }
        self.authorized_scoped(Some(user_id), Method::GET, path, None, None)
            .await
    }

    pub(crate) fn server_identity(&self) -> String {
        self.client.server_identity()
    }

    async fn establish_session(&self, session: AccountSession) -> Result<(), CommandError> {
        self.repository.save(&session)?;
        *self.session.lock().await = Some(session);
        Ok(())
    }

    async fn authorized_scoped(
        &self,
        user: Option<i64>,
        method: Method,
        path: &str,
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
    ) -> Result<Response, CommandError> {
        let mut guard = self.session.lock().await;
        let current = guard.as_mut().ok_or_else(not_logged_in)?;
        if user.is_some_and(|user| user != current.user_id) {
            return Err(not_logged_in());
        }
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

    async fn clear_local_session(&self) -> Result<(), CommandError> {
        self.repository.clear()?;
        *self.session.lock().await = None;
        Ok(())
    }
}

fn not_logged_in() -> CommandError {
    CommandError::new("ACCOUNT_NOT_LOGGED_IN", "请先登录 eizhu 账号")
}
