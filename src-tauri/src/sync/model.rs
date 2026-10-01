use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    pub item_type: String,
    pub item_id: String,
    pub base_revision: i64,
    pub revision: i64,
    pub generation: i64,
    pub deleted: bool,
    pub payload: String,
    #[serde(default = "default_key_version")]
    pub key_version: i64,
    #[serde(default)]
    pub epoch: Option<i64>,
}

fn default_key_version() -> i64 {
    1
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Push {
    pub request_id: String,
    pub device_id: String,
    pub epoch: i64,
    #[serde(default)]
    pub replace: bool,
    pub expected_seq: Option<i64>,
    pub items: Vec<Item>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Batch {
    pub request_id: String,
    pub seq: i64,
    pub epoch: i64,
    pub items: Vec<Item>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Changes {
    pub batches: Vec<Batch>,
    pub cursor: i64,
    pub until: i64,
    pub has_more: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ItemStatus {
    pub item_type: String,
    pub item_id: String,
    pub generation: i64,
    pub status: String,
    pub deleted: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStatus {
    pub status: String,
    pub pending_count: i64,
    pub conflict_count: i64,
    pub cursor: i64,
    pub initialized: bool,
    pub unlocked: bool,
    pub last_confirmed: Option<String>,
    pub last_error: String,
    pub items: Vec<ItemStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Conflict {
    pub item_type: String,
    pub item_id: String,
    pub reason: String,
    pub remote_revision: i64,
    pub local_deleted: bool,
    pub remote_deleted: bool,
    pub name: String,
    pub local: serde_json::Value,
    pub remote: serde_json::Value,
}
