use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreRequest<'a> {
    pub namespace: &'a str,
    pub value: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResponse {
    pub value: Option<String>,
}

#[derive(Serialize)]
pub struct LoadRequest<'a> {
    pub namespace: &'a str,
}
