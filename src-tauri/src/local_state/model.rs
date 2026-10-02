use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryEntry {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default = "one")]
    pub count: u64,
    pub last_at: i64,
}

fn one() -> u64 {
    1
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct HistorySettings {
    pub enabled: bool,
    pub max_entries: usize,
    pub retention_days: u32,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            max_entries: 500,
            retention_days: 30,
        }
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LocalStateKey {
    HistorySettings,
    TerminalLayout,
    Shortcuts,
}

impl LocalStateKey {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::HistorySettings => "history_settings",
            Self::TerminalLayout => "terminal_layout",
            Self::Shortcuts => "shortcuts",
        }
    }
}
