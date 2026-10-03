//! Shared, request-bound interactive authentication for terminals and tunnels.
use super::transport::AuthenticationRequest;
use crate::error::CommandError;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;
struct Pending {
    count: usize,
    sender: oneshot::Sender<Zeroizing<Vec<String>>>,
}
struct PendingGuard<F: Fn(Value)> {
    emit: F,
    id: String,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
}
impl<F: Fn(Value)> Drop for PendingGuard<F> {
    fn drop(&mut self) {
        self.pending.lock().expect("auth requests").remove(&self.id);
        (self.emit)(json!({"request_id": self.id, "closed": true}));
    }
}
#[derive(Clone, Default)]
pub(crate) struct AuthenticationCoordinator {
    pending: Arc<Mutex<HashMap<String, Pending>>>,
}
impl AuthenticationCoordinator {
    pub(super) async fn request(
        &self,
        request: AuthenticationRequest,
        cancel: &CancellationToken,
        emit: impl Fn(Value) + Send,
    ) -> Result<Vec<String>, String> {
        if request.prompts.len() > 32 {
            return Err("认证提示超过上限".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().expect("auth requests");
            if pending.len() >= 32 {
                return Err("待处理认证请求超过上限".into());
            }
            pending.insert(
                id.clone(),
                Pending {
                    count: request.prompts.len(),
                    sender,
                },
            );
        }
        let guard = PendingGuard {
            emit,
            id: id.clone(),
            pending: self.pending.clone(),
        };
        (guard.emit)(
            json!({"request_id":id, "profile_id":request.profile_id, "name":request.name, "instructions":request.instructions, "prompts":request.prompts.into_iter().map(|p| json!({"prompt":p.prompt,"echo":p.echo})).collect::<Vec<_>>() }),
        );
        let response = tokio::select! {
            _ = cancel.cancelled() => Err("用户取消了交互式认证".into()),
            result = receiver => result.map(|values| values.to_vec()).map_err(|_| "认证请求已结束".into()),
        };
        self.pending.lock().expect("auth requests").remove(&id);
        response
    }
    pub(crate) fn respond(&self, id: &str, responses: Vec<String>) -> Result<(), CommandError> {
        let responses = Zeroizing::new(responses);
        if responses.len() > 32 || responses.iter().map(|v| v.len()).sum::<usize>() > 65536 {
            return Err(CommandError::new("VALIDATION", "认证响应超过上限"));
        }
        let mut pending = self.pending.lock().expect("auth requests");
        let request = pending
            .get(id)
            .ok_or_else(|| CommandError::new("AUTH_REQUEST_NOT_FOUND", "认证请求已结束"))?;
        if responses.len() != request.count {
            return Err(CommandError::new("VALIDATION", "认证响应数量不匹配"));
        }
        pending
            .remove(id)
            .expect("request exists")
            .sender
            .send(responses)
            .map_err(|_| CommandError::new("AUTH_REQUEST_NOT_FOUND", "认证请求已结束"))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn replies_are_bound_to_the_request_and_cancellation_removes_pending_authentication() {
        let coordinator = AuthenticationCoordinator::default();
        let cancel = CancellationToken::new();
        let (sent, mut received) = tokio::sync::mpsc::unbounded_channel();
        let clone = coordinator.clone();
        let token = cancel.clone();
        let job = tokio::spawn(async move {
            clone
                .request(
                    AuthenticationRequest {
                        profile_id: "p".into(),
                        name: "MFA".into(),
                        instructions: "".into(),
                        prompts: vec![super::super::transport::AuthenticationPrompt {
                            prompt: "code".into(),
                            echo: false,
                        }],
                    },
                    &token,
                    |payload| {
                        sent.send(payload).unwrap();
                    },
                )
                .await
        });
        let payload = received.recv().await.unwrap();
        let id = payload["request_id"].as_str().unwrap();
        assert!(coordinator.respond("other", vec!["secret".into()]).is_err());
        assert!(coordinator.respond(id, vec![]).is_err());
        coordinator.respond(id, vec!["secret".into()]).unwrap();
        assert_eq!(job.await.unwrap().unwrap(), ["secret"]);
        assert!(coordinator.respond(id, vec!["again".into()]).is_err());
        let clone = coordinator.clone();
        let token = cancel.clone();
        let (sent, mut received) = tokio::sync::mpsc::unbounded_channel();
        let job = tokio::spawn(async move {
            clone
                .request(
                    AuthenticationRequest {
                        profile_id: "p".into(),
                        name: "".into(),
                        instructions: "".into(),
                        prompts: vec![],
                    },
                    &token,
                    |payload| {
                        sent.send(payload).unwrap();
                    },
                )
                .await
        });
        received.recv().await.unwrap();
        cancel.cancel();
        assert!(job.await.unwrap().is_err());
        assert!(coordinator.pending.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn dropping_a_connection_future_removes_and_closes_its_prompt() {
        let coordinator = AuthenticationCoordinator::default();
        let clone = coordinator.clone();
        let (sent, mut received) = tokio::sync::mpsc::unbounded_channel();
        let job = tokio::spawn(async move {
            clone
                .request(
                    AuthenticationRequest {
                        profile_id: "p".into(),
                        name: "".into(),
                        instructions: "".into(),
                        prompts: vec![],
                    },
                    &CancellationToken::new(),
                    |payload| {
                        let _ = sent.send(payload);
                    },
                )
                .await
        });
        let request = received.recv().await.unwrap();
        job.abort();
        assert!(job.await.unwrap_err().is_cancelled());
        let closed = received.recv().await.unwrap();
        assert_eq!(closed["request_id"], request["request_id"]);
        assert_eq!(closed["closed"], true);
        assert!(coordinator.pending.lock().unwrap().is_empty());
    }
}
