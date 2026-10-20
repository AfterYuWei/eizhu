//! Transactional, device-encrypted change capture and additive backup migration.
use super::StorageError;
use rusqlite::Connection;
pub(super) fn migrate(connection: &Connection) -> Result<(), StorageError> {
    connection.execute_batch(r###"CREATE TABLE IF NOT EXISTS backup_versions AS SELECT * FROM sync_versions WHERE 0;
CREATE UNIQUE INDEX IF NOT EXISTS backup_versions_id ON backup_versions(id);
CREATE UNIQUE INDEX IF NOT EXISTS backup_versions_number ON backup_versions(version);
CREATE TABLE IF NOT EXISTS backup_targets AS SELECT * FROM sync_providers WHERE 0;
CREATE UNIQUE INDEX IF NOT EXISTS backup_targets_id ON backup_targets(id);
CREATE TABLE IF NOT EXISTS backup_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS backup_state (id INTEGER PRIMARY KEY,next_version INTEGER NOT NULL DEFAULT 1,last_sync_at TEXT,status TEXT NOT NULL DEFAULT 'idle',conflict_json TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS backup_events AS SELECT * FROM sync_events WHERE 0;
CREATE UNIQUE INDEX IF NOT EXISTS backup_events_id ON backup_events(id);
CREATE TABLE IF NOT EXISTS feature_migrations (name TEXT PRIMARY KEY);
INSERT OR IGNORE INTO backup_versions(id,version,hash,size,file_path,origin,synced_to,created_at) SELECT id,version,hash,size,file_path,origin,synced_to,created_at FROM sync_versions WHERE NOT EXISTS(SELECT 1 FROM feature_migrations WHERE name='backup_split');
INSERT OR IGNORE INTO backup_targets SELECT * FROM sync_providers WHERE type != 'account' AND NOT EXISTS(SELECT 1 FROM feature_migrations WHERE name='backup_split');
INSERT OR IGNORE INTO backup_state SELECT * FROM sync_state;
INSERT OR IGNORE INTO backup_settings SELECT CASE WHEN key='sync_password' THEN 'backup_password' ELSE key END,value FROM sync_settings WHERE NOT EXISTS(SELECT 1 FROM feature_migrations WHERE name='backup_split');
INSERT OR IGNORE INTO backup_events SELECT * FROM sync_events WHERE NOT EXISTS(SELECT 1 FROM feature_migrations WHERE name='backup_split');
INSERT OR IGNORE INTO feature_migrations VALUES('backup_split');
CREATE TABLE IF NOT EXISTS realtime_state (id INTEGER PRIMARY KEY CHECK(id=1),user_id INTEGER,next_generation INTEGER NOT NULL DEFAULT 0,cursor INTEGER NOT NULL DEFAULT 0,epoch INTEGER NOT NULL DEFAULT 1,initialized INTEGER NOT NULL DEFAULT 0,wrapped_key TEXT,local_key TEXT,password TEXT,last_confirmed TEXT,last_error TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending_setup');
INSERT OR IGNORE INTO realtime_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS realtime_items(item_type TEXT NOT NULL,item_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,generation INTEGER NOT NULL DEFAULT 0,remote_payload TEXT,PRIMARY KEY(item_type,item_id));
CREATE TABLE IF NOT EXISTS realtime_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,item_type TEXT NOT NULL,item_id TEXT NOT NULL,generation INTEGER NOT NULL,deleted INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS realtime_outbox_item ON realtime_outbox(item_type,item_id,generation);
CREATE TABLE IF NOT EXISTS realtime_requests(request_id TEXT PRIMARY KEY,body TEXT NOT NULL,queue_ids TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS realtime_conflicts(item_type TEXT NOT NULL,item_id TEXT NOT NULL,remote TEXT NOT NULL,reason TEXT NOT NULL DEFAULT 'concurrent_edit',PRIMARY KEY(item_type,item_id));
CREATE TABLE IF NOT EXISTS backup_identity(id INTEGER PRIMARY KEY CHECK(id=1),device_id TEXT NOT NULL,space_id TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS realtime_groups_insert AFTER INSERT ON groups WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('group',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'group',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'name',NEW.name,'parent_id',NEW.parent_id,'icon',NEW.icon,'sort_order',NEW.sort_order,'created_at',NEW.created_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_groups_update AFTER UPDATE ON groups WHEN eizhu_capture_enabled()=1 AND (OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name OR OLD.parent_id IS NOT NEW.parent_id OR OLD.icon IS NOT NEW.icon OR OLD.sort_order IS NOT NEW.sort_order) BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('group',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'group',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'name',NEW.name,'parent_id',NEW.parent_id,'icon',NEW.icon,'sort_order',NEW.sort_order,'created_at',NEW.created_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_groups_delete AFTER DELETE ON groups WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('group',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'group',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1),1,eizhu_encrypt_change(json_object('id',OLD.id,'name',OLD.name,'parent_id',OLD.parent_id,'icon',OLD.icon,'sort_order',OLD.sort_order,'created_at',OLD.created_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_vault_insert AFTER INSERT ON vault WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('vault',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'vault',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'type',NEW.type,'data',NEW.data,'fingerprint',NEW.fingerprint,'name',NEW.name,'username',NEW.username,'remark',NEW.remark,'created_at',NEW.created_at,'updated_at',NEW.updated_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_vault_update AFTER UPDATE ON vault WHEN eizhu_capture_enabled()=1 AND (OLD.id IS NOT NEW.id OR OLD.type IS NOT NEW.type OR OLD.data IS NOT NEW.data OR OLD.fingerprint IS NOT NEW.fingerprint OR OLD.name IS NOT NEW.name OR OLD.username IS NOT NEW.username OR OLD.remark IS NOT NEW.remark) BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('vault',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'vault',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'type',NEW.type,'data',NEW.data,'fingerprint',NEW.fingerprint,'name',NEW.name,'username',NEW.username,'remark',NEW.remark,'created_at',NEW.created_at,'updated_at',NEW.updated_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_vault_delete AFTER DELETE ON vault WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('vault',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'vault',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1),1,eizhu_encrypt_change(json_object('id',OLD.id,'type',OLD.type,'data',OLD.data,'fingerprint',OLD.fingerprint,'name',OLD.name,'username',OLD.username,'remark',OLD.remark,'created_at',OLD.created_at,'updated_at',OLD.updated_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_profiles_insert AFTER INSERT ON profiles WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('profile',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'profile',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'name',NEW.name,'host',NEW.host,'port',NEW.port,'username',NEW.username,'auth_type',NEW.auth_type,'icon',NEW.icon,'vault_id',NEW.vault_id,'group_id',NEW.group_id,'tags',NEW.tags,'options',json_remove(NEW.options,'$.host_key_fingerprint'),'note',NEW.note,'sort_order',NEW.sort_order,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'inline_credential',NEW.inline_credential,'proxy_credential',NEW.proxy_credential)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_profiles_update AFTER UPDATE ON profiles WHEN eizhu_capture_enabled()=1 AND (OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name OR OLD.host IS NOT NEW.host OR OLD.port IS NOT NEW.port OR OLD.username IS NOT NEW.username OR OLD.auth_type IS NOT NEW.auth_type OR OLD.icon IS NOT NEW.icon OR OLD.vault_id IS NOT NEW.vault_id OR OLD.group_id IS NOT NEW.group_id OR OLD.tags IS NOT NEW.tags OR json_remove(OLD.options,'$.host_key_fingerprint') IS NOT json_remove(NEW.options,'$.host_key_fingerprint') OR OLD.note IS NOT NEW.note OR OLD.sort_order IS NOT NEW.sort_order OR OLD.inline_credential IS NOT NEW.inline_credential OR OLD.proxy_credential IS NOT NEW.proxy_credential) BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('profile',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'profile',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'name',NEW.name,'host',NEW.host,'port',NEW.port,'username',NEW.username,'auth_type',NEW.auth_type,'icon',NEW.icon,'vault_id',NEW.vault_id,'group_id',NEW.group_id,'tags',NEW.tags,'options',json_remove(NEW.options,'$.host_key_fingerprint'),'note',NEW.note,'sort_order',NEW.sort_order,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'inline_credential',NEW.inline_credential,'proxy_credential',NEW.proxy_credential)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_profiles_delete AFTER DELETE ON profiles WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('profile',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'profile',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1),1,eizhu_encrypt_change(json_object('id',OLD.id,'name',OLD.name,'host',OLD.host,'port',OLD.port,'username',OLD.username,'auth_type',OLD.auth_type,'icon',OLD.icon,'vault_id',OLD.vault_id,'group_id',OLD.group_id,'tags',OLD.tags,'options',json_remove(OLD.options,'$.host_key_fingerprint'),'note',OLD.note,'sort_order',OLD.sort_order,'created_at',OLD.created_at,'updated_at',OLD.updated_at,'inline_credential',OLD.inline_credential,'proxy_credential',OLD.proxy_credential)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_snippets_insert AFTER INSERT ON snippets WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('snippet',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'snippet',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'name',NEW.name,'content',NEW.content,'description',NEW.description,'tags',NEW.tags,'is_global',NEW.is_global,'created_at',NEW.created_at,'updated_at',NEW.updated_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_snippets_update AFTER UPDATE ON snippets WHEN eizhu_capture_enabled()=1 AND (OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name OR OLD.content IS NOT NEW.content OR OLD.description IS NOT NEW.description OR OLD.tags IS NOT NEW.tags OR OLD.is_global IS NOT NEW.is_global) BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('snippet',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'snippet',NEW.id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object('id',NEW.id,'name',NEW.name,'content',NEW.content,'description',NEW.description,'tags',NEW.tags,'is_global',NEW.is_global,'created_at',NEW.created_at,'updated_at',NEW.updated_at)));
END;
CREATE TRIGGER IF NOT EXISTS realtime_snippets_delete AFTER DELETE ON snippets WHEN eizhu_capture_enabled()=1 BEGIN
UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1;
INSERT INTO realtime_items(item_type,item_id,generation) VALUES('snippet',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1)) ON CONFLICT(item_type,item_id) DO UPDATE SET generation=excluded.generation;
INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),'snippet',OLD.id,(SELECT next_generation FROM realtime_state WHERE id=1),1,eizhu_encrypt_change(json_object('id',OLD.id,'name',OLD.name,'content',OLD.content,'description',OLD.description,'tags',OLD.tags,'is_global',OLD.is_global,'created_at',OLD.created_at,'updated_at',OLD.updated_at)));
END;
"###)?;
    let has_base = connection
        .prepare("PRAGMA table_info(realtime_outbox)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == "base_revision");
    if !has_base {
        connection.execute_batch(
            "ALTER TABLE realtime_outbox ADD COLUMN base_revision INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    let has_password_revision = connection
        .prepare("PRAGMA table_info(backup_versions)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == "password_revision");
    if !has_password_revision {
        connection.execute_batch(
            "ALTER TABLE backup_versions ADD COLUMN password_revision INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    connection.execute_batch("CREATE TABLE IF NOT EXISTS backup_cloud_cleanup(provider_id TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,config TEXT NOT NULL,PRIMARY KEY(provider_id,version));")?;
    connection.execute_batch("CREATE TRIGGER IF NOT EXISTS realtime_outbox_base AFTER INSERT ON realtime_outbox BEGIN UPDATE realtime_outbox SET base_revision=COALESCE((SELECT revision FROM realtime_items WHERE item_type=NEW.item_type AND item_id=NEW.item_id),0) WHERE id=NEW.id; END;")?;
    Ok(())
}
