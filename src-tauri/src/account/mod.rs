//! eizhu 账号登录态与账号云存储访问。

mod client;
mod model;
mod repository;
mod service;

pub(crate) use model::{AccountStatus, AccountUser};
pub(crate) use service::AccountService;
