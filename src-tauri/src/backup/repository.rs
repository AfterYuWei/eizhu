//! Transactional persistence for the complete backup aggregate.

use rusqlite::{params, Transaction};

use crate::{
    error::CommandError,
    infrastructure::database::Database,
    vault::{decode_plaintext, encode_plaintext, Encryptor},
};

use super::{
    error::BackupError,
    model::{
        BackupGroup, BackupImportResult, BackupPayload, BackupProfile, BackupSnippet, BackupStats,
        BackupVaultItem,
    },
};

const STRATEGY_SKIP: &str = "skip";
const STRATEGY_OVERWRITE: &str = "overwrite";

#[derive(Clone)]
pub(super) struct BackupRepository {
    pub(super) database: Database,
    pub(super) encryptor: Encryptor,
}

impl BackupRepository {
    pub(super) fn new(database: Database, encryptor: Encryptor) -> Self {
        Self {
            database,
            encryptor,
        }
    }

    pub(super) fn export_payload(&self) -> Result<BackupPayload, CommandError> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction().map_err(CommandError::database)?;
        let payload = BackupPayload {
            groups: export_groups(&transaction)?,
            vault: export_vault(&transaction, &self.encryptor)?,
            profiles: export_profiles(&transaction, &self.encryptor)?,
            snippets: export_snippets(&transaction)?,
        };
        transaction.commit().map_err(CommandError::database)?;
        Ok(payload)
    }

    pub(super) fn conflicts(&self, payload: &BackupPayload) -> Result<BackupStats, CommandError> {
        let connection = self.database.connect()?;
        let count = |table: &str, ids: Vec<&str>| -> Result<usize, CommandError> {
            let mut total = 0;
            for id in ids {
                let query = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)");
                let exists: bool = connection
                    .query_row(&query, [id], |row| row.get(0))
                    .map_err(CommandError::database)?;
                total += usize::from(exists);
            }
            Ok(total)
        };
        Ok(BackupStats {
            groups: count(
                "groups",
                payload.groups.iter().map(|item| item.id.as_str()).collect(),
            )?,
            vault: count(
                "vault",
                payload.vault.iter().map(|item| item.id.as_str()).collect(),
            )?,
            profiles: count(
                "profiles",
                payload
                    .profiles
                    .iter()
                    .map(|item| item.id.as_str())
                    .collect(),
            )?,
            snippets: count(
                "snippets",
                payload
                    .snippets
                    .iter()
                    .map(|item| item.id.as_str())
                    .collect(),
            )?,
        })
    }

    pub(super) fn import_payload(
        &self,
        payload: &BackupPayload,
        strategy: &str,
        group_order: &[usize],
        expected_generation: Option<i64>,
    ) -> Result<BackupImportResult, CommandError> {
        let mut connection = self
            .database
            .connect()
            .map_err(|error| CommandError::new("IMPORT_FAILED", error.to_string()))?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| CommandError::new("IMPORT_FAILED", error.to_string()))?;
        if let Some(expected) = expected_generation {
            let current: i64 = transaction
                .query_row(
                    "SELECT next_generation FROM realtime_state WHERE id=1",
                    [],
                    |r| r.get(0),
                )
                .map_err(CommandError::database)?;
            if current != expected {
                return Err(CommandError::new(
                    "PREVIEW_CHANGED",
                    "本地数据已变化，请重新预览",
                ));
            }
        }
        // A device-protected safety snapshot participates in the same transaction.
        let before = BackupPayload {
            groups: export_groups(&transaction)?,
            vault: export_vault(&transaction, &self.encryptor)?,
            profiles: export_profiles(&transaction, &self.encryptor)?,
            snippets: export_snippets(&transaction)?,
        };
        let plaintext = zeroize::Zeroizing::new(
            serde_json::to_string(&before).map_err(CommandError::database)?,
        );
        let encrypted = self
            .encryptor
            .encrypt(&plaintext)
            .map_err(CommandError::database)?;
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS backup_safety(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").map_err(CommandError::database)?;
        transaction
            .execute(
                "INSERT INTO backup_safety(id,payload) VALUES(?1,?2)",
                params![uuid::Uuid::new_v4().to_string(), encrypted],
            )
            .map_err(CommandError::database)?;
        if strategy == "replace" {
            transaction.execute_batch("DELETE FROM profiles;DELETE FROM snippets;UPDATE groups SET parent_id=NULL;DELETE FROM groups;DELETE FROM vault;").map_err(CommandError::database)?;
        }
        let mut result = BackupImportResult {
            imported: BackupStats::default(),
            skipped: BackupStats::default(),
            snapshot: None,
            snapshot_error: String::new(),
        };
        for &index in group_order {
            add_result(
                &mut result,
                Resource::Group,
                import_group(&transaction, &payload.groups[index], strategy).map_err(|error| {
                    CommandError::new(
                        "IMPORT_FAILED",
                        format!("import group {}: {error}", payload.groups[index].id),
                    )
                })?,
            );
        }
        for item in &payload.vault {
            add_result(
                &mut result,
                Resource::Vault,
                import_vault(&transaction, item, strategy, &self.encryptor).map_err(|error| {
                    CommandError::new(
                        "IMPORT_FAILED",
                        format!("import vault {}: {error}", item.id),
                    )
                })?,
            );
        }
        for item in &payload.profiles {
            add_result(
                &mut result,
                Resource::Profile,
                import_profile(&transaction, item, strategy, &self.encryptor).map_err(|error| {
                    CommandError::new(
                        "IMPORT_FAILED",
                        format!("import profile {}: {error}", item.id),
                    )
                })?,
            );
        }
        for item in &payload.snippets {
            add_result(
                &mut result,
                Resource::Snippet,
                import_snippet(&transaction, item, strategy).map_err(|error| {
                    CommandError::new(
                        "IMPORT_FAILED",
                        format!("import snippet {}: {error}", item.id),
                    )
                })?,
            );
        }
        validate_links(&transaction)?;
        normalize_vault_usernames(&transaction).map_err(|error| {
            CommandError::new(
                "IMPORT_FAILED",
                format!("normalize vault usernames: {error}"),
            )
        })?;
        transaction
            .commit()
            .map_err(|error| CommandError::new("IMPORT_FAILED", error.to_string()))?;
        Ok(result)
    }
}

#[derive(Clone, Copy)]
enum ImportAction {
    Skipped,
    Imported,
}

#[derive(Clone, Copy)]
enum Resource {
    Group,
    Vault,
    Profile,
    Snippet,
}

fn add_result(result: &mut BackupImportResult, resource: Resource, action: ImportAction) {
    let target = match action {
        ImportAction::Skipped => &mut result.skipped,
        ImportAction::Imported => &mut result.imported,
    };
    match resource {
        Resource::Group => target.groups += 1,
        Resource::Vault => target.vault += 1,
        Resource::Profile => target.profiles += 1,
        Resource::Snippet => target.snippets += 1,
    }
}

fn validate_links(transaction: &Transaction<'_>) -> Result<(), CommandError> {
    use std::collections::{HashMap, HashSet};
    let mut groups = transaction
        .prepare("SELECT id,COALESCE(parent_id,'') FROM groups")
        .map_err(CommandError::database)?;
    let groups = groups
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(CommandError::database)?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(CommandError::database)?;
    let mut profiles = transaction
        .prepare("SELECT id,group_id,vault_id,options FROM profiles")
        .map_err(CommandError::database)?;
    let profiles = profiles
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(CommandError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(CommandError::database)?;
    let profile_ids = profiles
        .iter()
        .map(|p| p.0.as_str())
        .collect::<HashSet<_>>();
    let mut jumps = HashMap::new();
    for (id, group, vault, options) in &profiles {
        if !group.is_empty() && !groups.contains_key(group) {
            return Err(CommandError::new(
                "IMPORT_FAILED",
                "备份包含缺失的服务器分组",
            ));
        }
        if !vault.is_empty() {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM vault WHERE id=?1)",
                    [vault],
                    |r| r.get(0),
                )
                .map_err(CommandError::database)?;
            if !exists {
                return Err(CommandError::new("IMPORT_FAILED", "备份包含缺失的凭据引用"));
            }
        }
        let value: serde_json::Value = serde_json::from_str(options)
            .map_err(|_| CommandError::new("IMPORT_FAILED", "备份中的连接选项无效"))?;
        if value["proxy"]["type"] == "jump" {
            let target = value["proxy"]["jump_profile_id"]
                .as_str()
                .unwrap_or_default();
            if !profile_ids.contains(target) {
                return Err(CommandError::new(
                    "IMPORT_FAILED",
                    "备份包含缺失的跳板服务器",
                ));
            }
            jumps.insert(id.clone(), target.to_owned());
        }
    }
    for edges in [&groups, &jumps] {
        for id in edges.keys() {
            let mut seen = HashSet::new();
            let mut next = id.as_str();
            while !next.is_empty() {
                if !seen.insert(next) {
                    return Err(CommandError::new("IMPORT_FAILED", "备份形成循环引用"));
                }
                next = edges.get(next).map(String::as_str).unwrap_or_default();
            }
        }
    }
    Ok(())
}

fn export_groups(transaction: &Transaction<'_>) -> Result<Vec<BackupGroup>, CommandError> {
    let mut statement = transaction
        .prepare(
            "SELECT id,name,parent_id,icon,sort_order,created_at \
             FROM groups ORDER BY sort_order,name",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok(BackupGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(CommandError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(CommandError::database)
}

fn export_vault(
    transaction: &Transaction<'_>,
    encryptor: &Encryptor,
) -> Result<Vec<BackupVaultItem>, CommandError> {
    let mut statement = transaction
        .prepare(
            "SELECT id,type,data,name,COALESCE(username,''),COALESCE(remark,''),\
             COALESCE(fingerprint,''),created_at,updated_at FROM vault ORDER BY created_at",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(CommandError::database)?;
    let mut output = Vec::new();
    for row in rows {
        let (id, entry_type, data, name, username, remark, fingerprint, created_at, updated_at) =
            row.map_err(CommandError::database)?;
        let plaintext = zeroize::Zeroizing::new(encryptor.decrypt(&data).map_err(|error| {
            CommandError::new("EXPORT_FAILED", format!("decrypt vault {id}: {error}"))
        })?);
        output.push(BackupVaultItem {
            id,
            name,
            username: normalize_vault_username(&entry_type, &username),
            remark,
            fingerprint,
            credential: Some(decode_plaintext(&plaintext, &entry_type)),
            updated_at: updated_at.unwrap_or_else(|| created_at.clone()),
            created_at,
            entry_type,
        });
    }
    Ok(output)
}

fn export_profiles(
    transaction: &Transaction<'_>,
    encryptor: &Encryptor,
) -> Result<Vec<BackupProfile>, CommandError> {
    let mut statement = transaction
        .prepare(
            "SELECT id,name,host,port,username,auth_type,COALESCE(icon,''),\
             COALESCE(vault_id,''),COALESCE(inline_credential,''),\
             COALESCE(proxy_credential,''),COALESCE(group_id,''),COALESCE(tags,'[]'),\
             COALESCE(options,'{}'),COALESCE(note,''),COALESCE(sort_order,0),created_at,updated_at \
             FROM profiles ORDER BY sort_order,name",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, i64>(14)?,
                row.get::<_, String>(15)?,
                row.get::<_, String>(16)?,
            ))
        })
        .map_err(CommandError::database)?;
    let mut output = Vec::new();
    for row in rows {
        let (
            id,
            name,
            host,
            port,
            username,
            auth_type,
            icon,
            vault_id,
            inline,
            proxy,
            group_id,
            tags,
            options,
            note,
            sort_order,
            created_at,
            updated_at,
        ) = row.map_err(CommandError::database)?;
        let inline_credential = if inline.is_empty() {
            None
        } else {
            let raw = zeroize::Zeroizing::new(encryptor.decrypt(&inline).map_err(|error| {
                CommandError::new(
                    "EXPORT_FAILED",
                    format!("decode inline credential for profile {id}: {error}"),
                )
            })?);
            Some(serde_json::from_str(&raw).map_err(|error| {
                CommandError::new(
                    "EXPORT_FAILED",
                    format!("decode inline credential for profile {id}: {error}"),
                )
            })?)
        };
        let proxy_password = if proxy.is_empty() {
            String::new()
        } else {
            encryptor.decrypt(&proxy).map_err(|error| {
                CommandError::new(
                    "EXPORT_FAILED",
                    format!("decode proxy credential for profile {id}: {error}"),
                )
            })?
        };
        output.push(BackupProfile {
            id,
            name,
            host,
            port,
            username,
            auth_type,
            icon,
            vault_id,
            inline_credential,
            proxy_password,
            group_id,
            tags: serde_json::from_str(&tags).unwrap_or_default(),
            options,
            note,
            sort_order,
            created_at,
            updated_at,
        });
    }
    Ok(output)
}

fn export_snippets(transaction: &Transaction<'_>) -> Result<Vec<BackupSnippet>, CommandError> {
    let mut statement = transaction
        .prepare(
            "SELECT id,name,content,COALESCE(description,''),COALESCE(tags,'[]'),\
             is_global,created_at,updated_at FROM snippets ORDER BY name",
        )
        .map_err(CommandError::database)?;
    let rows = statement
        .query_map([], |row| {
            let tags: String = row.get(4)?;
            Ok(BackupSnippet {
                id: row.get(0)?,
                name: row.get(1)?,
                content: row.get(2)?,
                description: row.get(3)?,
                tags: serde_json::from_str(&tags).unwrap_or_default(),
                is_global: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(CommandError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(CommandError::database)
}

fn import_group(
    transaction: &Transaction<'_>,
    item: &BackupGroup,
    strategy: &str,
) -> Result<ImportAction, BackupError> {
    if strategy == STRATEGY_SKIP && exists(transaction, "groups", &item.id)? {
        return Ok(ImportAction::Skipped);
    }
    let sql = if strategy == STRATEGY_OVERWRITE {
        "INSERT INTO groups (id,name,parent_id,icon,sort_order,created_at) \
         VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,parent_id=excluded.parent_id,icon=excluded.icon,sort_order=excluded.sort_order"
    } else {
        "INSERT INTO groups (id,name,parent_id,icon,sort_order,created_at) \
         VALUES (?1,?2,?3,?4,?5,?6)"
    };
    let parent_id = (!item.parent_id.is_empty()).then_some(item.parent_id.as_str());
    transaction
        .execute(
            sql,
            params![
                item.id,
                item.name,
                parent_id,
                item.icon,
                item.sort_order,
                item.created_at
            ],
        )
        .map_err(|error| BackupError::Repository(error.to_string()))?;
    Ok(ImportAction::Imported)
}

fn import_vault(
    transaction: &Transaction<'_>,
    item: &BackupVaultItem,
    strategy: &str,
    encryptor: &Encryptor,
) -> Result<ImportAction, BackupError> {
    if strategy == STRATEGY_SKIP && exists(transaction, "vault", &item.id)? {
        return Ok(ImportAction::Skipped);
    }
    let credential = item.credential.as_ref().ok_or_else(|| {
        BackupError::Repository(format!("vault item {} has no credential", item.id))
    })?;
    let (plaintext, fingerprint) = encode_plaintext(credential, &item.entry_type)?;
    let plaintext = zeroize::Zeroizing::new(plaintext);
    let encrypted = encryptor
        .encrypt(&plaintext)
        .map_err(|error| BackupError::Repository(error.to_string()))?;
    let sql = if strategy == STRATEGY_OVERWRITE {
        "INSERT OR REPLACE INTO vault \
         (id,type,data,fingerprint,name,username,remark,created_at,updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
    } else {
        "INSERT INTO vault (id,type,data,fingerprint,name,username,remark,created_at,updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
    };
    transaction
        .execute(
            sql,
            params![
                item.id,
                item.entry_type,
                encrypted,
                fingerprint,
                item.name,
                normalize_vault_username(&item.entry_type, &item.username),
                item.remark,
                item.created_at,
                item.updated_at,
            ],
        )
        .map_err(|error| BackupError::Repository(error.to_string()))?;
    Ok(ImportAction::Imported)
}

fn import_profile(
    transaction: &Transaction<'_>,
    item: &BackupProfile,
    strategy: &str,
    encryptor: &Encryptor,
) -> Result<ImportAction, BackupError> {
    if strategy == STRATEGY_SKIP && exists(transaction, "profiles", &item.id)? {
        return Ok(ImportAction::Skipped);
    }
    let inline = match item.inline_credential.as_ref() {
        Some(credential) => {
            let raw = zeroize::Zeroizing::new(
                serde_json::to_string(credential)
                    .map_err(|error| BackupError::Repository(error.to_string()))?,
            );
            if raw.as_str() == "{}" {
                String::new()
            } else {
                encryptor
                    .encrypt(&raw)
                    .map_err(|error| BackupError::Repository(error.to_string()))?
            }
        }
        None => String::new(),
    };
    let proxy = if item.proxy_password.is_empty() {
        String::new()
    } else {
        encryptor
            .encrypt(&item.proxy_password)
            .map_err(|error| BackupError::Repository(error.to_string()))?
    };
    let tags = serde_json::to_string(&item.tags)
        .map_err(|error| BackupError::Repository(error.to_string()))?;
    let sql = if strategy == STRATEGY_OVERWRITE {
        "INSERT OR REPLACE INTO profiles \
         (id,name,host,port,username,auth_type,icon,vault_id,inline_credential,\
          proxy_credential,group_id,tags,options,note,sort_order,created_at,updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)"
    } else {
        "INSERT INTO profiles \
         (id,name,host,port,username,auth_type,icon,vault_id,inline_credential,\
          proxy_credential,group_id,tags,options,note,sort_order,created_at,updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)"
    };
    transaction
        .execute(
            sql,
            params![
                item.id,
                item.name,
                item.host,
                item.port,
                item.username,
                item.auth_type,
                item.icon,
                item.vault_id,
                inline,
                proxy,
                item.group_id,
                tags,
                item.options,
                item.note,
                item.sort_order,
                item.created_at,
                item.updated_at,
            ],
        )
        .map_err(|error| BackupError::Repository(error.to_string()))?;
    Ok(ImportAction::Imported)
}

fn import_snippet(
    transaction: &Transaction<'_>,
    item: &BackupSnippet,
    strategy: &str,
) -> Result<ImportAction, BackupError> {
    if strategy == STRATEGY_SKIP && exists(transaction, "snippets", &item.id)? {
        return Ok(ImportAction::Skipped);
    }
    let tags = serde_json::to_string(&item.tags)
        .map_err(|error| BackupError::Repository(error.to_string()))?;
    let sql = if strategy == STRATEGY_OVERWRITE {
        "INSERT OR REPLACE INTO snippets \
         (id,name,content,description,tags,is_global,created_at,updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
    } else {
        "INSERT INTO snippets (id,name,content,description,tags,is_global,created_at,updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"
    };
    transaction
        .execute(
            sql,
            params![
                item.id,
                item.name,
                item.content,
                item.description,
                tags,
                item.is_global,
                item.created_at,
                item.updated_at,
            ],
        )
        .map_err(|error| BackupError::Repository(error.to_string()))?;
    Ok(ImportAction::Imported)
}

fn exists(transaction: &Transaction<'_>, table: &str, id: &str) -> Result<bool, BackupError> {
    let query = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)");
    transaction
        .query_row(&query, [id], |row| row.get(0))
        .map_err(|error| BackupError::Repository(error.to_string()))
}

fn normalize_vault_usernames(transaction: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    transaction.execute_batch(
        "UPDATE vault SET username='' WHERE type!='password' AND username!='';
         UPDATE vault SET username=TRIM(username) WHERE type='password';
         UPDATE vault SET username=(
             SELECT MIN(TRIM(p.username)) FROM profiles p
             WHERE p.auth_type='vault' AND p.vault_id=vault.id AND TRIM(p.username)!=''
         ) WHERE type='password' AND TRIM(username)='' AND (
             SELECT COUNT(DISTINCT TRIM(p.username)) FROM profiles p
             WHERE p.auth_type='vault' AND p.vault_id=vault.id AND TRIM(p.username)!=''
         )=1;
         UPDATE profiles SET username=(
             SELECT v.username FROM vault v WHERE v.id=profiles.vault_id
         ), updated_at=CURRENT_TIMESTAMP
         WHERE auth_type='vault' AND EXISTS(
             SELECT 1 FROM vault v WHERE v.id=profiles.vault_id AND v.type='password'
             AND TRIM(v.username)!='' AND profiles.username!=v.username
         );",
    )
}

fn normalize_vault_username(entry_type: &str, username: &str) -> String {
    if entry_type == "password" {
        username.trim().to_owned()
    } else {
        String::new()
    }
}
