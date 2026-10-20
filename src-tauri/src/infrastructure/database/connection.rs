//! SQLite connection factory.

use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
    time::Duration,
};

use rusqlite::Connection;

use crate::infrastructure::database::{migration, StorageError};

#[derive(Clone)]
pub struct Database {
    path: Arc<PathBuf>,
    capture: Arc<RwLock<Option<Arc<CaptureFn>>>>,
}

type CaptureFn = dyn Fn(&str) -> Result<String, String> + Send + Sync;

impl Database {
    pub fn initialize(path: PathBuf) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let database = Self {
            path: Arc::new(path),
            capture: Arc::new(RwLock::new(None)),
        };
        migration::migrate(&database.connect()?)?;
        Ok(database)
    }

    pub fn configure_capture(
        &self,
        capture: impl Fn(&str) -> Result<String, String> + Send + Sync + 'static,
    ) {
        *self.capture.write().expect("database capture lock") = Some(Arc::new(capture));
    }

    pub fn connect(&self) -> Result<Connection, StorageError> {
        let connection = Connection::open(self.path.as_ref())?;
        use rusqlite::functions::FunctionFlags;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        };
        let flags = FunctionFlags::SQLITE_UTF8;
        let capture = self.capture.clone();
        connection.create_scalar_function("eizhu_encrypt_change", 1, flags, move |ctx| {
            let raw = zeroize::Zeroizing::new(ctx.get::<String>(0)?);
            let callback = capture.read().map_err(|_| rusqlite::Error::InvalidQuery)?;
            let encrypted =
                callback.as_ref().ok_or(rusqlite::Error::InvalidQuery)?(&raw).map_err(|e| {
                    rusqlite::Error::UserFunctionError(Box::new(std::io::Error::other(e)))
                })?;
            Ok(encrypted)
        })?;
        let enabled = Arc::new(AtomicBool::new(true));
        let flag = enabled.clone();
        let configured = self.capture.clone();
        connection.create_scalar_function("eizhu_capture_enabled", -1, flags, move |ctx| {
            if !ctx.is_empty() {
                flag.store(ctx.get::<i64>(0)? != 0, Ordering::Relaxed);
            }
            Ok(i64::from(
                flag.load(Ordering::Relaxed)
                    && configured
                        .read()
                        .map_err(|_| rusqlite::Error::InvalidQuery)?
                        .is_some(),
            ))
        })?;
        let batch = Arc::new(Mutex::new(uuid::Uuid::new_v4().to_string()));
        let current = batch.clone();
        connection.create_scalar_function("eizhu_batch", 0, flags, move |_| {
            Ok(current
                .lock()
                .map_err(|_| rusqlite::Error::InvalidQuery)?
                .clone())
        })?;
        connection.commit_hook(Some(move || {
            if let Ok(mut id) = batch.lock() {
                *id = uuid::Uuid::new_v4().to_string();
            }
            false
        }));
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(connection)
    }
}
