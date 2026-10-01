use super::SyncService;
use std::time::Duration;
impl SyncService {
    pub fn start(&self) {
        if self.inner.user <= 0 {
            return;
        }
        let state = self.clone();
        let worker = tauri::async_runtime::spawn(async move {
            let mut retry = 1u64;
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut last_pull = std::time::Instant::now() - Duration::from_secs(60);
            loop {
                tokio::select! {
                    _ = state.inner.stop.cancelled() => break,
                    _ = state.inner.wake.notified() => {},
                    _ = tick.tick() => {
                        let pending = state.local(|r| {
                            let status = r.status()?;
                            Ok(status.pending_count > 0 && status.initialized && status.unlocked && r.has_work()?)
                        }).await.unwrap_or(false);
                        if !pending && last_pull.elapsed() < Duration::from_secs(60) { continue; }
                    }
                }
                state.emit_async().await;
                if state
                    .inner
                    .blocked
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    continue;
                }
                if state
                    .inner
                    .paused
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    continue;
                }
                match state.sync_once().await {
                    Ok(()) => {
                        retry = 1;
                        last_pull = std::time::Instant::now();
                    }
                    Err(error) => {
                        let status = if error.retryable { "offline" } else { "error" };
                        let message = error.message.clone();
                        let _ = state.local(move |r| r.set_status(status, &message)).await;
                        state.emit_async().await;
                        let transient = error.retryable;
                        if !transient {
                            state
                                .inner
                                .blocked
                                .store(true, std::sync::atomic::Ordering::Release);
                            continue;
                        }
                        let delay = retry;
                        retry = (retry * 2).min(60);
                        let mut random = [0u8; 1];
                        let _ = getrandom::fill(&mut random);
                        let delay = Duration::from_millis(
                            (delay * 1000 + u64::from(random[0]) * 4).min(60000),
                        );
                        tokio::select! {_ = state.inner.stop.cancelled()=>break,_ = state.inner.wake.notified()=>{},_ = tokio::time::sleep(delay)=>{}}
                    }
                }
            }
        });
        let state = self.clone();
        let events = tauri::async_runtime::spawn(async move {
            loop {
                if state.inner.stop.is_cancelled() {
                    break;
                }
                if state
                    .inner
                    .paused
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    tokio::select! {_ = state.inner.stop.cancelled()=>break,_ = tokio::time::sleep(Duration::from_secs(1))=>{}}
                    continue;
                }
                let response = tokio::select! {_ = state.inner.stop.cancelled()=>break,result=state.inner.account.response_for(state.inner.user,"api/sync/v2/events")=>result};
                if response
                    .as_ref()
                    .is_err_and(|e| matches!(e.code, "ACCOUNT_NOT_LOGGED_IN" | "ACCOUNT_DISABLED"))
                    || response
                        .as_ref()
                        .is_ok_and(|r| matches!(r.status().as_u16(), 401 | 403))
                {
                    tokio::select! {_ = state.inner.stop.cancelled()=>break,_=state.inner.resume.notified()=>{}}
                    continue;
                }
                if let Ok(mut response) = response {
                    if response.status().is_success() {
                        state.notify_change();
                        let mut buffered = Vec::new();
                        loop {
                            let chunk = tokio::select! {_ = state.inner.stop.cancelled()=>return,chunk=response.chunk()=>chunk};
                            if state
                                .inner
                                .paused
                                .load(std::sync::atomic::Ordering::Acquire)
                            {
                                break;
                            }
                            match chunk {
                                Ok(Some(bytes)) => {
                                    buffered.extend_from_slice(&bytes);
                                    if buffered.len() > 65536 {
                                        break;
                                    }
                                    while let Some(end) =
                                        buffered.windows(2).position(|w| w == b"\n\n")
                                    {
                                        let event = buffered.drain(..end + 2).collect::<Vec<_>>();
                                        if event.starts_with(b"event:change")
                                            || event.starts_with(b"event: change")
                                            || event.starts_with(b"event:ready")
                                            || event.starts_with(b"event: ready")
                                        {
                                            state.notify_change();
                                        }
                                    }
                                }
                                _ => break,
                            }
                        }
                    }
                }
                tokio::select! {_ = state.inner.stop.cancelled()=>break,_ = tokio::time::sleep(Duration::from_secs(5))=>{}}
            }
        });
        if let Ok(mut handles) = self.inner.runtime.lock() {
            handles.push(worker);
            handles.push(events);
        }
    }
    pub async fn stop(&self) {
        self.inner.stop.cancel();
        let handles = self
            .inner
            .runtime
            .lock()
            .map(|mut h| std::mem::take(&mut *h))
            .unwrap_or_default();
        for handle in handles {
            handle.abort();
            let _ = handle.await;
        }
        loop {
            let idle = self.inner.quiescent.notified();
            let count = self.inner.blocking.lock().map(|count| *count).unwrap_or(0);
            if count == 0 {
                break;
            }
            idle.await;
        }
    }
}
