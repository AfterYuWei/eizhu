use tokio::sync::oneshot;

#[derive(Default)]
pub(super) struct TransitionGate {
    pending: Option<(String, oneshot::Sender<bool>)>,
}
impl TransitionGate {
    pub fn is_pending(&self) -> bool {
        self.pending.is_some()
    }
    pub fn begin(&mut self) -> Result<(String, oneshot::Receiver<bool>), String> {
        if self.pending.is_some() {
            return Err("正在等待编辑器确认，请完成当前操作".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending = Some((id.clone(), sender));
        Ok((id, receiver))
    }
    pub fn take(&mut self, id: &str) -> Result<oneshot::Sender<bool>, String> {
        if self
            .pending
            .as_ref()
            .is_none_or(|(current, _)| current != id)
        {
            return Err("编辑器确认请求已失效".into());
        }
        Ok(self.pending.take().expect("validated pending transition").1)
    }
    pub fn cancel(&mut self) {
        if let Some((_, sender)) = self.pending.take() {
            let _ = sender.send(false);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn confirmation_is_serialized_and_bound_to_the_request() {
        let mut gate = TransitionGate::default();
        let (id, waiting) = gate.begin().unwrap();
        assert!(gate.begin().is_err());
        assert!(gate.take("stale").is_err());
        gate.take(&id).unwrap().send(true).unwrap();
        assert!(waiting.await.unwrap());
        let (_, waiting) = gate.begin().unwrap();
        gate.cancel();
        assert!(!waiting.await.unwrap());
        assert!(gate.take(&id).is_err());
    }
}
