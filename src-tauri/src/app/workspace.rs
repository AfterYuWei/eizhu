//! Account-isolated composition and tracked service lifetime.
use crate::{
    account::AccountService,
    audit::AuditRepository,
    backup::{
        archive::{ArchiveRepository, ArchiveService},
        BackupService,
    },
    error::CommandError,
    group::GroupService,
    infrastructure::database::Database,
    local_state::LocalStateService,
    profile::ProfileService,
    sftp::SftpService,
    snippet::SnippetService,
    ssh::{SshService, TunnelRepository, TunnelService},
    sync::SyncService,
    vault::{Encryptor, VaultService},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, RwLock,
    },
};
use tauri::Emitter;

pub(crate) struct Workspace {
    pub id: String,
    pub generation: u64,
    pub user: i64,
    pub audit: AuditRepository,
    pub vault: VaultService,
    pub profile: ProfileService,
    pub groups: GroupService,
    pub snippets: SnippetService,
    pub local_state: LocalStateService,
    pub backup: BackupService,
    pub archive: ArchiveService,
    pub sync: SyncService,
    pub sessions: SshService,
    pub tunnels: TunnelService,
    pub sftp: SftpService,
}
#[derive(Clone)]
pub(crate) struct WorkspaceManager {
    local_backup: BackupService,
    root: PathBuf,
    local_database: Database,
    local_encryptor: Encryptor,
    account: AccountService,
    app: tauri::AppHandle,
    active: Arc<RwLock<Arc<Workspace>>>,
    generation: Arc<AtomicU64>,
    switching: Arc<AtomicBool>,
    switch: Arc<tokio::sync::Mutex<()>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceStatus {
    pub id: String,
    pub generation: u64,
    pub user_id: i64,
}
impl WorkspaceManager {
    pub fn new(
        root: PathBuf,
        database: Database,
        encryptor: Encryptor,
        account: AccountService,
        app: tauri::AppHandle,
    ) -> Result<Self, CommandError> {
        let generation = Arc::new(AtomicU64::new(1));
        let workspace = Self::build(
            &root,
            "local".into(),
            1,
            0,
            database.clone(),
            encryptor.clone(),
            &account,
            &app,
            generation.clone(),
        )?;
        Ok(Self {
            local_backup: workspace.backup.clone(),
            root,
            local_database: database,
            local_encryptor: encryptor,
            account,
            app,
            active: Arc::new(RwLock::new(Arc::new(workspace))),
            generation,
            switching: Arc::new(AtomicBool::new(false)),
            switch: Arc::new(tokio::sync::Mutex::new(())),
        })
    }
    #[allow(clippy::too_many_arguments)]
    fn build(
        root: &std::path::Path,
        id: String,
        generation: u64,
        user: i64,
        database: Database,
        encryptor: Encryptor,
        account: &AccountService,
        app: &tauri::AppHandle,
        current: Arc<AtomicU64>,
    ) -> Result<Workspace, CommandError> {
        let audit = AuditRepository::new(database.clone());
        let vault = VaultService::new(database.clone(), encryptor.clone(), audit.clone());
        let profile =
            ProfileService::initialize(database.clone(), encryptor.clone(), vault.clone())?;
        let groups = GroupService::new(database.clone());
        let backup = BackupService::new(
            database.clone(),
            encryptor.clone(),
            audit.clone(),
            groups.clone(),
            profile.clone(),
            vault.clone(),
        );
        let archive_repository = ArchiveRepository::new(database.clone(), encryptor.clone());
        let device = archive_repository.identity()?.0;
        if user > 0 {
            archive_repository.ensure_account_provider("账号完整备份")?;
        }
        let archive = ArchiveService::initialize(
            archive_repository,
            backup.clone(),
            root.join("backups"),
            account.clone(),
            user,
        )?;
        let handle = app.clone();
        let cursor = current.clone();
        let emit = Arc::new(move |status: serde_json::Value| {
            if cursor.load(Ordering::Acquire) == generation {
                let _ = handle.emit(
                    "eizhu-sync-message",
                    serde_json::json!({"workspaceGeneration":generation,"status":status}),
                );
            }
        });
        let sync = SyncService::new(
            database.clone(),
            encryptor.clone(),
            account.clone(),
            user,
            device,
            emit,
        );
        let events = Arc::new(super::TauriEventSink::for_workspace(
            app.clone(),
            generation,
            current,
        ));
        let sessions = SshService::new(profile.clone(), audit.clone(), events.clone());
        let tunnels = TunnelService::new(
            profile.clone(),
            TunnelRepository::new(database.clone(), encryptor.clone()),
            events.clone(),
            sessions.authentication(),
        );
        let sftp = SftpService::new(
            profile.clone(),
            audit.clone(),
            events,
            crate::sftp::TransferRepository::new(database.clone(), encryptor.clone())?,
        )?;
        let runtime = tauri::async_runtime::handle();
        archive.start_scheduler(runtime.inner())?;
        sync.start();
        Ok(Workspace {
            id,
            generation,
            user,
            audit,
            vault,
            profile,
            groups,
            local_state: LocalStateService::new(database.clone(), encryptor),
            snippets: SnippetService::new(database),
            backup,
            archive,
            sync,
            sessions,
            tunnels,
            sftp,
        })
    }
    pub fn current(&self, expected: Option<u64>) -> Result<Arc<Workspace>, CommandError> {
        if self.switching.load(Ordering::Acquire) {
            return Err(CommandError::new("WORKSPACE_SWITCHING", "正在切换数据空间"));
        }
        let active = self
            .active
            .read()
            .map_err(|_| CommandError::new("WORKSPACE_BUSY", "数据空间不可用"))?
            .clone();
        if expected.is_some_and(|value| value != active.generation) {
            return Err(CommandError::new(
                "WORKSPACE_CHANGED",
                "数据空间已切换，请重试",
            ));
        }
        Ok(active)
    }
    pub fn status(&self) -> Result<WorkspaceStatus, CommandError> {
        let active = self.current(None)?;
        Ok(WorkspaceStatus {
            id: active.id.clone(),
            generation: active.generation,
            user_id: active.user,
        })
    }
    pub async fn activate_account(&self) -> Result<(), CommandError> {
        let status = self.account.status().await?;
        let user = status
            .user
            .ok_or_else(|| CommandError::new("ACCOUNT_NOT_LOGGED_IN", "请先登录"))?;
        let id = if user.id > 0 {
            user.id
        } else {
            self.account.me().await?.id
        };
        self.activate(id).await
    }
    pub async fn activate(&self, user: i64) -> Result<(), CommandError> {
        let _lock = self.switch.lock().await;
        let old = self.current(None)?;
        if old.user == user {
            old.sync.retry_now();
            return Ok(());
        }
        self.switching.store(true, Ordering::Release);
        let next = self.generation.load(Ordering::Acquire) + 1;
        let result = (|| {
            let (id, root, database, encryptor) = if user <= 0 {
                (
                    "local".to_owned(),
                    self.root.clone(),
                    self.local_database.clone(),
                    self.local_encryptor.clone(),
                )
            } else {
                let id = hex::encode(Sha256::digest(format!(
                    "{}:{user}",
                    self.account.server_identity()
                )));
                let root = self.root.join("spaces").join(&id);
                let database = Database::initialize(root.join("eizhu.db"))?;
                #[cfg(desktop)]
                let encryptor =
                    Encryptor::load_or_create(root.join("key")).map_err(CommandError::database)?;
                #[cfg(mobile)]
                let encryptor =
                    crate::infrastructure::platform::master_key_store::load_or_create_scoped(
                        &self.app,
                        &database,
                        &root.join("key"),
                        &id,
                    )?;
                (id, root, database, encryptor)
            };
            Self::build(
                &root,
                id,
                next,
                user,
                database,
                encryptor,
                &self.account,
                &self.app,
                self.generation.clone(),
            )
        })();
        match result {
            Ok(workspace) => {
                old.sync.stop().await;
                old.archive.stop_scheduler().await;
                old.tunnels.shutdown().await;
                old.sessions.shutdown().await;
                old.sftp.shutdown().await;
                self.generation.store(next, Ordering::Release);
                *self
                    .active
                    .write()
                    .map_err(|_| CommandError::new("WORKSPACE_BUSY", "数据空间不可用"))? =
                    Arc::new(workspace);
                self.switching.store(false, Ordering::Release);
                let _ = self.app.emit("eizhu-workspace-changed", self.status()?);
                Ok(())
            }
            Err(error) => {
                self.switching.store(false, Ordering::Release);
                Err(error)
            }
        }
    }
    pub async fn import_local(&self, expected: Option<u64>) -> Result<(), CommandError> {
        let workspace = self.current(expected)?;
        if workspace.user <= 0 {
            return Err(CommandError::new(
                "ACCOUNT_NOT_LOGGED_IN",
                "请切换至账号空间",
            ));
        }
        let local = self.local_backup.clone();
        let owned = workspace.clone();
        tokio::task::spawn_blocking(move || {
            let raw = zeroize::Zeroizing::new(local.export_bytes("plain", "")?);
            owned.backup.import_bytes(&raw, "", "overwrite").map(|_| ())
        })
        .await
        .map_err(CommandError::database)??;
        workspace.sync.retry_now();
        workspace.archive.notify_change();
        Ok(())
    }
    #[cfg(desktop)]
    pub async fn shutdown(&self) {
        if let Ok(active) = self.current(None) {
            active.sync.stop().await;
            active.archive.stop_scheduler().await;
            active.tunnels.shutdown().await;
            active.sessions.shutdown().await;
            active.sftp.shutdown().await;
            active.archive.shutdown_backup().await;
        }
    }
}
