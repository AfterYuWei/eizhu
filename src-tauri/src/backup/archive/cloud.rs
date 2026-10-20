use std::collections::HashMap;

use tokio::task::JoinSet;

use crate::error::CommandError;

use super::{
    model::{BackupStatus, BackupVersion, BackupVersionInfo, CloudVersionInfo},
    provider::{object_name, CloudProvider},
    repository::ProviderRow,
    service::ArchiveService,
};

impl ArchiveService {
    fn provider(&self, row: ProviderRow) -> Result<CloudProvider, CommandError> {
        CloudProvider::new(
            row.meta.id,
            row.config,
            self.inner.repository.clone(),
            self.inner.account.clone(),
            self.inner.user,
        )
    }

    pub async fn status(&self) -> Result<BackupStatus, CommandError> {
        let mut status = self.local_status()?;
        status.cloud_latest = self.cloud_latest().await;
        Ok(status)
    }

    pub async fn cloud_latest(&self) -> HashMap<String, BackupVersionInfo> {
        let Ok(rows) = self.inner.repository.list_providers(true) else {
            return HashMap::new();
        };
        let mut tasks = JoinSet::new();
        for row in rows {
            let state = self.clone();
            tasks.spawn(async move {
                let id = row.meta.id.clone();
                let mut provider = state.provider(row).ok()?;
                let index =
                    tokio::time::timeout(std::time::Duration::from_secs(15), provider.read_index())
                        .await
                        .ok()?
                        .ok()?;
                index.latest().map(|latest| {
                    (
                        id,
                        BackupVersionInfo {
                            version: latest.version,
                            hash: latest.hash.clone(),
                            size: latest.size,
                            created_at: latest.created_at.clone(),
                        },
                    )
                })
            });
        }
        let mut output = HashMap::new();
        while let Some(result) = tasks.join_next().await {
            if let Ok(Some((id, version))) = result {
                output.insert(id, version);
            }
        }
        output
    }

    pub(super) async fn push_latest_cancellable(
        &self,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<(), CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        self.push_latest_inner(cancel).await
    }

    async fn push_latest_inner(
        &self,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<(), CommandError> {
        let state = self.clone();
        tokio::task::spawn_blocking(move || {
            state.create_version_inner(super::service::ORIGIN_MANUAL)
        })
        .await
        .map_err(join_error)??;
        let Some(latest) = self.inner.repository.latest_version()? else {
            return Ok(());
        };
        let rows = self.inner.repository.list_providers(true)?;
        let mut tasks = JoinSet::new();
        for row in rows {
            let state = self.clone();
            let version = latest.clone();
            let cancel = cancel.clone();
            tasks.spawn(async move {
                let id = row.meta.id.clone();
                let mut provider = state.provider(row)?;
                let result = tokio::select! {
                    _ = cancel.cancelled() => Err(CommandError::new("BACKUP_STOPPED", "备份任务已暂停，版本保留以便恢复后重试")),
                    result = state.push_version(&mut provider, &version) => result,
                };
                if let Err(error) = &result {
                    state.inner.repository.log_event(
                        &id,
                        "push",
                        version.version,
                        false,
                        &error.message,
                    );
                }
                result
            });
        }
        let mut first_error = None;
        while let Some(result) = tasks.join_next().await {
            match result {
                Ok(Err(error)) if first_error.is_none() => first_error = Some(error),
                Err(error) if first_error.is_none() => {
                    first_error = Some(CommandError::new(
                        "SYNC_FAILED",
                        format!("推送任务异常结束: {error}"),
                    ));
                }
                _ => {}
            }
        }
        if first_error.is_none() {
            self.inner.repository.touch_last_sync()?;
        }
        if !cancel.is_cancelled() {
            tokio::select! {
                _ = cancel.cancelled() => {},
                result = self.enforce_retention_with_cloud() => result?,
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        Ok(())
    }

    async fn push_version(
        &self,
        provider: &mut CloudProvider,
        version: &BackupVersion,
    ) -> Result<(), CommandError> {
        if version.synced_to.iter().any(|id| id == provider.id()) {
            return Ok(());
        }
        let path = version.file_path.clone();
        let bytes = tokio::task::spawn_blocking(move || std::fs::read(path))
            .await
            .map_err(join_error)?
            .map_err(|error| {
                CommandError::new("SYNC_FAILED", format!("打开版本文件失败: {error}"))
            })?;
        let object = object_name(version.version, &version.hash)?;
        provider.put_object(&object, bytes).await?;
        let mut index = provider.read_index().await?;
        index.device_id.clone_from(&self.inner.device_id);
        index.add(CloudVersionInfo {
            version: version.version,
            hash: version.hash.clone(),
            size: version.size,
            object,
            created_at: version.created_at.clone(),
        });
        provider.write_index(&index).await?;
        self.inner
            .repository
            .mark_synced(&version.id, provider.id())?;
        self.inner
            .repository
            .log_event(provider.id(), "push", version.version, true, "");
        Ok(())
    }

    pub async fn cloud_versions(&self, id: &str) -> Result<serde_json::Value, CommandError> {
        let row = self.inner.repository.get_provider(id)?;
        if row.config.provider_type == "account" {
            let versions: serde_json::Value = self
                .inner
                .account
                .json_for(
                    self.inner.user,
                    reqwest::Method::GET,
                    "api/backup/v1/objects",
                    None,
                )
                .await?;
            let versions=versions.as_array().ok_or_else(||CommandError::new("SYNC_FAILED","云端备份目录无效"))?.iter().filter(|v|v["name"].as_str().is_some_and(|name|name.ends_with(".eizhubackup"))).map(|v|serde_json::json!({"object":v["name"],"size":v["size"],"createdAt":v["created_at"]})).collect::<Vec<_>>();
            return Ok(serde_json::json!(versions));
        }
        let index = self.provider(row)?.read_index().await?;
        Ok(serde_json::json!(index
            .versions
            .into_iter()
            .map(|v| serde_json::json!({"object":v.object,"size":v.size,"createdAt":v.created_at}))
            .collect::<Vec<_>>()))
    }
    pub async fn preview_cloud(
        &self,
        id: &str,
        object: &str,
        password: Option<String>,
    ) -> Result<serde_json::Value, CommandError> {
        if object.is_empty()
            || object.len() > 200
            || !object
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        {
            return Err(CommandError::new("INVALID_OBJECT_NAME", "备份对象名称无效"));
        }
        let _operation = self.inner.operation.try_enter()?;
        let row = self.inner.repository.get_provider(id)?;
        let provider_name = row.meta.name.clone();
        let bytes = if row.config.provider_type == "account" {
            self.inner
                .account
                .backup_object(
                    self.inner.user,
                    reqwest::Method::GET,
                    &format!("api/backup/v1/objects/{object}"),
                    None,
                    false,
                )
                .await?
        } else {
            self.provider(row)?.get_object(object).await?
        };
        let password = zeroize::Zeroizing::new(
            password.unwrap_or(
                self.inner
                    .repository
                    .load_settings()?
                    .backup_password
                    .clone(),
            ),
        );
        let backup = self.inner.backup.clone();
        let path = self
            .inner
            .backup_dir
            .join(format!("download-{}", uuid::Uuid::new_v4()));
        let mut preview = tokio::task::spawn_blocking(move || {
            super::service::write_private_file(&path, &bytes).map_err(CommandError::database)?;
            let result = backup.prepare_restore(
                path.to_str()
                    .ok_or_else(|| CommandError::new("INVALID_PATH", "备份路径无效"))?,
                &password,
                None,
            );
            let _ = std::fs::remove_file(path);
            result
        })
        .await
        .map_err(join_error)??;
        preview["source"] =
            serde_json::json!({"kind":"cloud","providerName":provider_name,"object":object});
        Ok(preview)
    }

    pub async fn test_provider(&self, id: &str) -> Result<(), CommandError> {
        let row = self.inner.repository.get_provider(id)?;
        let mut provider = self.provider(row)?;
        tokio::time::timeout(std::time::Duration::from_secs(30), provider.ping())
            .await
            .map_err(|_| CommandError::new("TEST_FAILED", "连接测试超时"))?
            .map_err(|error| CommandError::new("TEST_FAILED", error.message))
    }

    async fn delete_from_clouds(&self, version: &BackupVersion) -> Result<(), CommandError> {
        let settings = self.inner.repository.load_settings()?;
        if settings.cloud_retention != "mirror_local" {
            return Ok(());
        }
        self.inner.repository.enqueue_cloud_cleanup(version)?;
        let _ = self
            .retry_cloud_cleanup_inner(&tokio_util::sync::CancellationToken::new())
            .await;
        Ok(())
    }

    pub(super) async fn retry_cloud_cleanup(
        &self,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<(), CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        self.retry_cloud_cleanup_inner(cancel).await
    }
    async fn retry_cloud_cleanup_inner(
        &self,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<(), CommandError> {
        for (row, version, hash) in self.inner.repository.cloud_cleanup()? {
            let id = row.meta.id.clone();
            let mut provider = self.provider(row)?;
            let result = tokio::select! {
                _=cancel.cancelled()=>return Ok(()),
                result=async {
                    provider.delete_object(&object_name(version,&hash)?).await?;
                    let mut index=provider.read_index().await?;
                    index.remove(version);provider.write_index(&index).await?;
                    self.inner.repository.finish_cloud_cleanup(&id,version)
                }=>result,
            };
            self.inner.repository.log_event(
                &id,
                "delete",
                version,
                result.is_ok(),
                result
                    .as_ref()
                    .err()
                    .map(|e| e.message.as_str())
                    .unwrap_or(""),
            );
        }
        Ok(())
    }

    pub async fn delete_version_with_cloud(
        &self,
        id: &str,
        force: bool,
    ) -> Result<(), CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        let version = self
            .inner
            .repository
            .get_version(id)
            .map_err(|error| CommandError::new("DELETE_FAILED", error.message))?;
        if !force && version.synced_to.is_empty() {
            return Err(CommandError::new(
                "DELETE_FAILED",
                "该版本尚未同步到任何云端，删除后将无法恢复（可用 force 强制删除）",
            ));
        }
        self.delete_from_clouds(&version).await?;
        self.delete_version(id, force)
    }

    async fn enforce_retention_with_cloud(&self) -> Result<(), CommandError> {
        let settings = self.inner.repository.load_settings()?;
        let keep = usize::try_from(settings.local_keep_versions).unwrap_or(usize::MAX);
        if settings.local_keep_versions <= 0 {
            return Ok(());
        }
        let versions = self.inner.repository.list_versions()?;
        if versions.len() <= keep {
            return Ok(());
        }
        for version in &versions[keep..] {
            self.delete_from_clouds(version).await?;
            self.delete_version(&version.id, true)?;
        }
        Ok(())
    }
}

fn join_error(error: tokio::task::JoinError) -> CommandError {
    CommandError::new("SYNC_FAILED", format!("后台任务异常结束: {error}"))
}
